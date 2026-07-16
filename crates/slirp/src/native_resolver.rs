//! `NativeResolver` — the native-harness [`Resolver`] backed by the OS resolver (E3-T15). This is the
//! `resolve` half of the DNS forwarder when running natively (tests + the native CLI); the browser
//! build uses a DoH resolver over `fetch` instead. A bounded blocking `getaddrinfo` call retains the
//! OS resolver's authoritative `EAI_NONAME` result, so a real NXDOMAIN reaches the guest as NXDOMAIN
//! instead of being collapsed into SERVFAIL. Only IPv4 addresses are retained.
//!
//! CAVEAT: `getaddrinfo` runs on Tokio's blocking threadpool. Our `timeout` returns `Failed` on
//! schedule, but it
//! only DROPS the future — the underlying getaddrinfo thread stays pinned until the OS resolver
//! returns. The production service deliberately serializes and caps requests, so a black-holed host
//! resolver can pin at most one lookup thread per VM rather than an unbounded number.

use std::collections::BTreeSet;
use std::ffi::CString;
use std::net::Ipv4Addr;
use std::ptr;
use std::time::Duration;

use crate::resolver::{Resolution, Resolver};

/// The default resolve timeout — a name that won't resolve must fail (→ SERVFAIL) within this, so the
/// guest's `wget`/`nslookup` fails fast instead of hanging (the T15 charter).
pub const DEFAULT_RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);

/// Resolves guest DNS queries via the host OS resolver (tokio `lookup_host`).
#[derive(Debug, Clone)]
pub struct NativeResolver {
    timeout: Duration,
}

impl Default for NativeResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeResolver {
    pub fn new() -> Self {
        NativeResolver {
            timeout: DEFAULT_RESOLVE_TIMEOUT,
        }
    }

    /// Set the resolve timeout (e.g. a short one in tests).
    pub fn with_timeout(mut self, t: Duration) -> Self {
        self.timeout = t;
        self
    }
}

impl Resolver for NativeResolver {
    fn resolve(&self, name: &str) -> impl std::future::Future<Output = Resolution> + Send {
        let name = name.to_owned();
        let timeout = self.timeout;
        async move {
            let lookup = tokio::task::spawn_blocking(move || lookup_ipv4(&name));
            match tokio::time::timeout(timeout, lookup).await {
                Ok(Ok(HostLookup::Resolved(ips))) => Resolution::Resolved { ips, ttl_secs: 60 },
                Ok(Ok(HostLookup::NxDomain)) => Resolution::NxDomain,
                Ok(Ok(HostLookup::Failed)) | Ok(Err(_)) | Err(_) => Resolution::Failed,
            }
        }
    }
}

enum HostLookup {
    Resolved(Vec<Ipv4Addr>),
    NxDomain,
    Failed,
}

fn lookup_ipv4(name: &str) -> HostLookup {
    if !valid_dns_name(name) {
        return HostLookup::Failed;
    }
    let Ok(name) = CString::new(name) else {
        return HostLookup::Failed;
    };
    // SAFETY: `hints` is initialized before use; `result` is owned by getaddrinfo on success and
    // freed exactly once after walking its linked list. Every sockaddr is checked for AF_INET and a
    // sufficient length before casting to sockaddr_in.
    unsafe {
        let mut hints: libc::addrinfo = std::mem::zeroed();
        hints.ai_family = libc::AF_INET;
        hints.ai_socktype = libc::SOCK_STREAM;
        let mut result: *mut libc::addrinfo = ptr::null_mut();
        let rc = libc::getaddrinfo(name.as_ptr(), ptr::null(), &hints, &mut result);
        if rc == libc::EAI_NONAME {
            return HostLookup::NxDomain;
        }
        if rc != 0 || result.is_null() {
            return HostLookup::Failed;
        }

        let mut ips = BTreeSet::new();
        let mut cursor = result;
        while !cursor.is_null() {
            let info = &*cursor;
            if info.ai_family == libc::AF_INET
                && !info.ai_addr.is_null()
                && (info.ai_addrlen as usize) >= std::mem::size_of::<libc::sockaddr_in>()
            {
                let address = &*(info.ai_addr.cast::<libc::sockaddr_in>());
                ips.insert(Ipv4Addr::from(address.sin_addr.s_addr.to_ne_bytes()));
            }
            cursor = info.ai_next;
        }
        libc::freeaddrinfo(result);
        HostLookup::Resolved(ips.into_iter().collect())
    }
}

fn valid_dns_name(name: &str) -> bool {
    let name = name.strip_suffix('.').unwrap_or(name);
    !name.is_empty()
        && name.len() <= 253
        && name.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

#[cfg(test)]
mod tests;
