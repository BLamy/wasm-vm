//! Security primitives for the public relay fallback (E3-T19).
//!
//! Tokens are deliberately carried in the binary `HELLO`, never in the WebSocket URL, and bind a
//! random id to one browser Origin for at most fifteen minutes. Destination classification runs on
//! every address returned by DNS immediately before connect, preventing a public hostname from
//! rebinding into a protected network.

use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::str::FromStr;
use std::sync::{Arc, Mutex};

pub const MAX_TOKEN_LIFETIME_SECS: u64 = 15 * 60;
const TOKEN_VERSION: &str = "v1";
const HMAC_BLOCK_BYTES: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayToken {
    pub expiry_unix_secs: u64,
    pub origin: String,
    pub id: String,
}

/// An operator-supplied network that the public relay must never dial, in addition to the
/// built-in loopback/private/link-local/metadata families.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtectedNetwork {
    network: IpAddr,
    prefix_len: u8,
}

impl ProtectedNetwork {
    pub fn contains(self, candidate: IpAddr) -> bool {
        match (self.network, candidate) {
            (IpAddr::V4(network), IpAddr::V4(candidate)) => {
                let prefix = self.prefix_len.min(32);
                let mask = if prefix == 0 {
                    0
                } else {
                    u32::MAX << (32 - prefix)
                };
                u32::from(network) & mask == u32::from(candidate) & mask
            }
            (IpAddr::V6(network), IpAddr::V6(candidate)) => {
                let prefix = self.prefix_len.min(128);
                let mask = if prefix == 0 {
                    0
                } else {
                    u128::MAX << (128 - prefix)
                };
                u128::from(network) & mask == u128::from(candidate) & mask
            }
            _ => false,
        }
    }
}

impl FromStr for ProtectedNetwork {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let (address, prefix) = value
            .trim()
            .split_once('/')
            .ok_or_else(|| format!("protected network {value:?} must be CIDR"))?;
        let network = address
            .parse::<IpAddr>()
            .map_err(|error| format!("invalid protected network {value:?}: {error}"))?;
        let prefix_len = prefix
            .parse::<u8>()
            .map_err(|_| format!("invalid protected-network prefix in {value:?}"))?;
        let maximum = if network.is_ipv4() { 32 } else { 128 };
        if prefix_len > maximum {
            return Err(format!(
                "protected-network prefix exceeds {maximum} in {value:?}"
            ));
        }
        Ok(Self {
            network,
            prefix_len,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayTokenError {
    Malformed,
    InvalidSignature,
    Expired,
    LifetimeTooLong,
    WrongOrigin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RelayLimits {
    pub max_concurrent_streams: usize,
    pub max_connects_per_minute: usize,
    pub max_bytes_per_token: u64,
}

impl Default for RelayLimits {
    fn default() -> Self {
        Self {
            max_concurrent_streams: 64,
            max_connects_per_minute: 120,
            max_bytes_per_token: 64 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayQuotaError {
    ConcurrentStreams,
    ConnectRate,
    ByteLimit,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RelayMetrics {
    pub sessions_authenticated: u64,
    pub rejected_authentication: u64,
    pub active_streams: u64,
    pub connects_accepted: u64,
    pub rejected_concurrency: u64,
    pub rejected_rate: u64,
    pub rejected_bytes: u64,
    pub bytes_accounted: u64,
}

#[derive(Debug, Default)]
struct RegistryState {
    tokens: HashMap<String, TokenUsage>,
    metrics: RelayMetrics,
}

#[derive(Debug, Clone, Default)]
pub struct RelayUsageRegistry(Arc<Mutex<RegistryState>>);

#[derive(Debug, Default)]
struct TokenUsage {
    expiry_unix_secs: u64,
    active_streams: usize,
    connect_times: VecDeque<u64>,
    bytes: u64,
}

impl RelayUsageRegistry {
    pub fn record_authentication(&self, accepted: bool) {
        let mut registry = self.0.lock().expect("relay usage registry poisoned");
        if accepted {
            registry.metrics.sessions_authenticated += 1;
        } else {
            registry.metrics.rejected_authentication += 1;
        }
    }

    pub fn reserve_stream(
        &self,
        token: &RelayToken,
        now_unix_secs: u64,
        limits: RelayLimits,
    ) -> Result<(), RelayQuotaError> {
        let mut registry = self.0.lock().expect("relay usage registry poisoned");
        registry
            .tokens
            .retain(|_, usage| usage.expiry_unix_secs > now_unix_secs);
        let outcome = {
            let usage = registry.tokens.entry(token.id.clone()).or_default();
            usage.expiry_unix_secs = token.expiry_unix_secs;
            while usage
                .connect_times
                .front()
                .is_some_and(|time| time.saturating_add(60) <= now_unix_secs)
            {
                usage.connect_times.pop_front();
            }
            if usage.active_streams >= limits.max_concurrent_streams {
                Err(RelayQuotaError::ConcurrentStreams)
            } else if usage.connect_times.len() >= limits.max_connects_per_minute {
                Err(RelayQuotaError::ConnectRate)
            } else {
                usage.active_streams += 1;
                usage.connect_times.push_back(now_unix_secs);
                Ok(())
            }
        };
        match outcome {
            Err(RelayQuotaError::ConcurrentStreams) => {
                registry.metrics.rejected_concurrency += 1;
                return Err(RelayQuotaError::ConcurrentStreams);
            }
            Err(RelayQuotaError::ConnectRate) => {
                registry.metrics.rejected_rate += 1;
                return Err(RelayQuotaError::ConnectRate);
            }
            Err(RelayQuotaError::ByteLimit) => unreachable!(),
            Ok(()) => {}
        }
        registry.metrics.active_streams += 1;
        registry.metrics.connects_accepted += 1;
        Ok(())
    }

    pub fn release_stream(&self, token_id: &str) {
        let mut registry = self.0.lock().expect("relay usage registry poisoned");
        let was_active = if let Some(usage) = registry.tokens.get_mut(token_id) {
            let was_active = usage.active_streams > 0;
            usage.active_streams = usage.active_streams.saturating_sub(1);
            was_active
        } else {
            false
        };
        if was_active {
            registry.metrics.active_streams = registry.metrics.active_streams.saturating_sub(1);
        }
    }

    pub fn record_bytes(
        &self,
        token_id: &str,
        count: usize,
        limits: RelayLimits,
    ) -> Result<(), RelayQuotaError> {
        let mut registry = self.0.lock().expect("relay usage registry poisoned");
        let accepted = if let Some(usage) = registry.tokens.get_mut(token_id) {
            match usage.bytes.checked_add(count as u64) {
                Some(next) if next <= limits.max_bytes_per_token => {
                    usage.bytes = next;
                    true
                }
                _ => false,
            }
        } else {
            false
        };
        if !accepted {
            registry.metrics.rejected_bytes += 1;
            return Err(RelayQuotaError::ByteLimit);
        }
        registry.metrics.bytes_accounted = registry
            .metrics
            .bytes_accounted
            .saturating_add(count as u64);
        Ok(())
    }

    /// Aggregate-only operational counters. They deliberately contain no token IDs, origins,
    /// destinations, tailnet state, or payload data and are therefore safe for metrics/log output.
    pub fn metrics(&self) -> RelayMetrics {
        self.0
            .lock()
            .expect("relay usage registry poisoned")
            .metrics
    }
}

/// Issue an opaque ASCII token suitable for the ws-proxy `HELLO`. The caller supplies the random
/// id so production can use its platform CSPRNG while deterministic tests can pin a value.
pub fn issue_relay_token(
    secret: &[u8],
    now_unix_secs: u64,
    expiry_unix_secs: u64,
    origin: &str,
    id: &str,
) -> Result<Vec<u8>, RelayTokenError> {
    validate_field(origin)?;
    validate_field(id)?;
    if secret.is_empty() || expiry_unix_secs <= now_unix_secs {
        return Err(RelayTokenError::Expired);
    }
    if expiry_unix_secs.saturating_sub(now_unix_secs) > MAX_TOKEN_LIFETIME_SECS {
        return Err(RelayTokenError::LifetimeTooLong);
    }
    let payload = format!("{TOKEN_VERSION}\n{expiry_unix_secs}\n{origin}\n{id}");
    let mac = hmac_sha256(secret, payload.as_bytes());
    Ok(format!("{payload}\n{}", hex(&mac)).into_bytes())
}

/// Verify signature, expiry, maximum lifetime, and the actual WebSocket Origin. `now` is injected
/// so expiry attacks remain deterministic in tests and recordings.
pub fn verify_relay_token(
    secret: &[u8],
    now_unix_secs: u64,
    actual_origin: &str,
    encoded: &[u8],
) -> Result<RelayToken, RelayTokenError> {
    if secret.is_empty() {
        return Err(RelayTokenError::InvalidSignature);
    }
    let text = std::str::from_utf8(encoded).map_err(|_| RelayTokenError::Malformed)?;
    let mut fields = text.split('\n');
    let version = fields.next().ok_or(RelayTokenError::Malformed)?;
    let expiry_text = fields.next().ok_or(RelayTokenError::Malformed)?;
    let origin = fields.next().ok_or(RelayTokenError::Malformed)?;
    let id = fields.next().ok_or(RelayTokenError::Malformed)?;
    let signature = fields.next().ok_or(RelayTokenError::Malformed)?;
    if fields.next().is_some() || version != TOKEN_VERSION || origin.is_empty() || id.is_empty() {
        return Err(RelayTokenError::Malformed);
    }
    let expiry_unix_secs = expiry_text
        .parse::<u64>()
        .map_err(|_| RelayTokenError::Malformed)?;
    let supplied = decode_hex_32(signature).ok_or(RelayTokenError::Malformed)?;
    let payload = format!("{version}\n{expiry_text}\n{origin}\n{id}");
    let expected = hmac_sha256(secret, payload.as_bytes());
    if !constant_time_eq(&supplied, &expected) {
        return Err(RelayTokenError::InvalidSignature);
    }
    if expiry_unix_secs <= now_unix_secs {
        return Err(RelayTokenError::Expired);
    }
    if expiry_unix_secs.saturating_sub(now_unix_secs) > MAX_TOKEN_LIFETIME_SECS {
        return Err(RelayTokenError::LifetimeTooLong);
    }
    if origin != actual_origin {
        return Err(RelayTokenError::WrongOrigin);
    }
    Ok(RelayToken {
        expiry_unix_secs,
        origin: origin.to_owned(),
        id: id.to_owned(),
    })
}

fn validate_field(value: &str) -> Result<(), RelayTokenError> {
    if value.is_empty() || value.contains(['\n', '\r']) {
        Err(RelayTokenError::Malformed)
    } else {
        Ok(())
    }
}

/// Public-relay default: only globally routable unicast addresses are eligible. Exact development
/// rewrites are applied after this decision by a separate, explicit allowlist.
pub fn destination_is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ipv4_is_public(ip),
        IpAddr::V6(ip) => ipv6_is_public(ip),
    }
}

/// A DNS result is allowed only when it is non-empty and every answer remains public. Rejecting
/// the complete mixed set is the resolver/connect boundary that defeats DNS rebinding retries.
pub fn destinations_are_public(addresses: &[IpAddr]) -> bool {
    !addresses.is_empty() && addresses.iter().copied().all(destination_is_public)
}

/// Apply both the built-in policy and operator-supplied protected CIDRs to the complete DNS answer.
pub fn destinations_are_allowed(addresses: &[IpAddr], protected: &[ProtectedNetwork]) -> bool {
    destinations_are_public(addresses)
        && addresses
            .iter()
            .all(|address| protected.iter().all(|network| !network.contains(*address)))
}

fn ipv4_is_public(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_broadcast()
        || octets[0] == 0
        || octets[0] >= 240
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113))
}

fn ipv6_is_public(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00 // RFC 4193 unique local
        || (segments[0] & 0xffc0) == 0xfe80 // link local
        || (segments[0] == 0x2001 && segments[1] == 0x0db8) // documentation
        || ip.to_ipv4_mapped().is_some_and(|v4| !ipv4_is_public(v4)))
}

fn hmac_sha256(secret: &[u8], message: &[u8]) -> [u8; 32] {
    let mut key = [0u8; HMAC_BLOCK_BYTES];
    if secret.len() > HMAC_BLOCK_BYTES {
        key[..32].copy_from_slice(&Sha256::digest(secret));
    } else {
        key[..secret.len()].copy_from_slice(secret);
    }
    let mut inner_pad = [0x36u8; HMAC_BLOCK_BYTES];
    let mut outer_pad = [0x5cu8; HMAC_BLOCK_BYTES];
    for index in 0..HMAC_BLOCK_BYTES {
        inner_pad[index] ^= key[index];
        outer_pad[index] ^= key[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    outer.finalize().into()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

fn decode_hex_32(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        out[index] = (hex_digit(pair[0])? << 4) | hex_digit(pair[1])?;
    }
    Some(out)
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 2_000_000_000;
    const ORIGIN: &str = "https://vm.example";

    #[test]
    fn issued_token_is_origin_bound_short_lived_and_tamper_evident() {
        let token = issue_relay_token(b"test secret", NOW, NOW + 300, ORIGIN, "random-1").unwrap();
        let verified = verify_relay_token(b"test secret", NOW, ORIGIN, &token).unwrap();
        assert_eq!(verified.id, "random-1");
        assert_eq!(verified.expiry_unix_secs, NOW + 300);
        assert_eq!(
            verify_relay_token(b"wrong", NOW, ORIGIN, &token),
            Err(RelayTokenError::InvalidSignature)
        );
        assert_eq!(
            verify_relay_token(b"test secret", NOW, "https://evil.example", &token),
            Err(RelayTokenError::WrongOrigin)
        );
        assert_eq!(
            verify_relay_token(b"test secret", NOW + 300, ORIGIN, &token),
            Err(RelayTokenError::Expired)
        );
        let mut tampered = token.clone();
        tampered[5] ^= 1;
        assert!(verify_relay_token(b"test secret", NOW, ORIGIN, &tampered).is_err());
    }

    #[test]
    fn issuer_and_verifier_reject_excessive_lifetime_and_malformed_fields() {
        assert_eq!(
            issue_relay_token(b"secret", NOW, NOW + 901, ORIGIN, "id"),
            Err(RelayTokenError::LifetimeTooLong)
        );
        assert_eq!(
            issue_relay_token(b"secret", NOW, NOW + 1, "https://ok\nevil", "id"),
            Err(RelayTokenError::Malformed)
        );
    }

    #[test]
    fn destination_policy_rejects_every_protected_family() {
        for denied in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "::1",
            "fe80::1",
            "fd00::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
        ] {
            assert!(!destination_is_public(denied.parse().unwrap()), "{denied}");
        }
        for allowed in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(destination_is_public(allowed.parse().unwrap()), "{allowed}");
        }
    }

    #[test]
    fn destination_policy_rejects_empty_and_mixed_dns_answers() {
        assert!(!destinations_are_public(&[]));
        assert!(destinations_are_public(&[
            "1.1.1.1".parse().unwrap(),
            "2606:4700:4700::1111".parse().unwrap(),
        ]));
        assert!(!destinations_are_public(&[
            "1.1.1.1".parse().unwrap(),
            "169.254.169.254".parse().unwrap(),
        ]));
    }

    #[test]
    fn operator_protected_cidrs_reject_matching_public_answers() {
        let protected = [
            "1.1.1.0/24".parse::<ProtectedNetwork>().unwrap(),
            "2606:4700::/32".parse::<ProtectedNetwork>().unwrap(),
        ];
        assert!(!destinations_are_allowed(
            &["1.1.1.1".parse().unwrap()],
            &protected,
        ));
        assert!(!destinations_are_allowed(
            &["2606:4700:4700::1111".parse().unwrap()],
            &protected,
        ));
        assert!(destinations_are_allowed(
            &["8.8.8.8".parse().unwrap()],
            &protected,
        ));
        assert!("1.1.1.1".parse::<ProtectedNetwork>().is_err());
        assert!("1.1.1.0/33".parse::<ProtectedNetwork>().is_err());
    }

    #[test]
    fn quotas_are_shared_by_token_id_and_release_only_concurrency() {
        let registry = RelayUsageRegistry::default();
        let token = RelayToken {
            expiry_unix_secs: NOW + 300,
            origin: ORIGIN.into(),
            id: "shared".into(),
        };
        let limits = RelayLimits {
            max_concurrent_streams: 1,
            max_connects_per_minute: 2,
            max_bytes_per_token: 5,
        };
        registry.reserve_stream(&token, NOW, limits).unwrap();
        assert_eq!(
            registry.reserve_stream(&token, NOW, limits),
            Err(RelayQuotaError::ConcurrentStreams)
        );
        registry.release_stream(&token.id);
        registry.reserve_stream(&token, NOW, limits).unwrap();
        registry.release_stream(&token.id);
        assert_eq!(
            registry.reserve_stream(&token, NOW, limits),
            Err(RelayQuotaError::ConnectRate)
        );
        registry.record_bytes(&token.id, 5, limits).unwrap();
        assert_eq!(
            registry.record_bytes(&token.id, 1, limits),
            Err(RelayQuotaError::ByteLimit)
        );
        assert_eq!(
            registry.metrics(),
            RelayMetrics {
                sessions_authenticated: 0,
                rejected_authentication: 0,
                active_streams: 0,
                connects_accepted: 2,
                rejected_concurrency: 1,
                rejected_rate: 1,
                rejected_bytes: 1,
                bytes_accounted: 5,
            }
        );
    }
}
