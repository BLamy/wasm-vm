//! Security primitives for the public relay fallback (E3-T19).
//!
//! Tokens are deliberately carried in the binary `HELLO`, never in the WebSocket URL, and bind a
//! random id to one browser Origin for at most fifteen minutes. Destination classification runs on
//! every address returned by DNS immediately before connect, preventing a public hostname from
//! rebinding into a protected network.

use sha2::{Digest, Sha256};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

pub const MAX_TOKEN_LIFETIME_SECS: u64 = 15 * 60;
const TOKEN_VERSION: &str = "v1";
const HMAC_BLOCK_BYTES: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayToken {
    pub expiry_unix_secs: u64,
    pub origin: String,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayTokenError {
    Malformed,
    InvalidSignature,
    Expired,
    LifetimeTooLong,
    WrongOrigin,
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
}
