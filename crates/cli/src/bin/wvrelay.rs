//! `wvrelay` — the deployable ws-proxy relay server (E3-net slice 2c).
//!
//! The relay owns the real sockets so the browser guest (which has none) can reach the network: the
//! browser [`WsConnector`](wasm_vm_slirp::WsConnector) (slice 2b) tunnels each guest TCP flow to this
//! server as ws-proxy streams, and the server dials the real destination. The protocol + per-connection
//! bridge live in `wasm_vm_slirp::ws_proxy` (proven over a real WebSocket in its `ws_adapter_tests`);
//! this binary is the thin runnable wrapper: parse a bind address, listen, and `serve_ws` forever.
//!
//! Plaintext `ws://` only — TLS terminates at the ingress (a reverse proxy / the browser's `wss://`
//! terminator), never here. A non-loopback bind is refused unless short-lived HMAC authentication
//! and an exact Origin allowlist are configured.

use std::collections::{BTreeMap, BTreeSet};
use std::net::SocketAddr;

use tokio::net::TcpListener;

/// The default bind address when neither an argument nor `$WVRELAY_ADDR` is given. Loopback (not
/// `0.0.0.0`) so a bare `wvrelay` never accidentally exposes an unauthenticated relay to the network;
/// a deploy opts into a public bind explicitly.
const DEFAULT_ADDR: &str = "127.0.0.1:8080";

/// Resolve the bind address: `argv[1]` wins, else `$WVRELAY_ADDR`, else [`DEFAULT_ADDR`]. A provided
/// value that doesn't parse is a hard error (returned, not silently defaulted) — a deploy typo must
/// fail loudly rather than bind somewhere unexpected. Pure, so it is unit-tested below.
fn resolve_addr(arg: Option<&str>, env: Option<&str>) -> Result<SocketAddr, String> {
    let src = arg.or(env).unwrap_or(DEFAULT_ADDR);
    src.parse::<SocketAddr>()
        .map_err(|e| format!("invalid bind address {src:?}: {e}"))
}

/// Parse `source=target` entries separated by commas. Exact rewrites keep the normal relay closed to
/// surprises: no wildcard/suffix matching, and an unset/empty value means no rewrites.
fn parse_host_map(value: Option<&str>) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    let Some(value) = value.filter(|v| !v.trim().is_empty()) else {
        return Ok(out);
    };
    for entry in value.split(',') {
        let (source, target) = entry
            .split_once('=')
            .ok_or_else(|| format!("invalid host map entry {entry:?}; expected source=target"))?;
        let source = source.trim();
        let target = target.trim();
        if source.is_empty() || target.is_empty() {
            return Err(format!(
                "invalid host map entry {entry:?}; source and target must be non-empty"
            ));
        }
        if out.insert(source.to_string(), target.to_string()).is_some() {
            return Err(format!("duplicate host map source {source:?}"));
        }
    }
    Ok(out)
}

fn parse_origins(value: Option<&str>) -> Result<BTreeSet<String>, String> {
    let mut origins = BTreeSet::new();
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Ok(origins);
    };
    for origin in value.split(',').map(str::trim) {
        if origin.is_empty() || !(origin.starts_with("https://") || origin.starts_with("http://")) {
            return Err(format!("invalid allowed origin {origin:?}"));
        }
        origins.insert(origin.to_owned());
    }
    Ok(origins)
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if std::env::args().nth(1).as_deref() == Some("issue-token") {
        issue_token_command();
        return;
    }
    // argv[1] is the optional bind address; $WVRELAY_ADDR is the env fallback (for container deploys).
    let arg = std::env::args().nth(1);
    let env = std::env::var("WVRELAY_ADDR").ok();
    let addr = match resolve_addr(arg.as_deref(), env.as_deref()) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("wvrelay: {e}");
            std::process::exit(2);
        }
    };
    let host_map = match parse_host_map(std::env::var("WVRELAY_HOST_MAP").ok().as_deref()) {
        Ok(map) => map,
        Err(e) => {
            eprintln!("wvrelay: {e}");
            std::process::exit(2);
        }
    };
    let hmac_secret = std::env::var("WVRELAY_HMAC_SECRET").ok();
    let allowed_origins =
        match parse_origins(std::env::var("WVRELAY_ALLOWED_ORIGINS").ok().as_deref()) {
            Ok(origins) => origins,
            Err(error) => {
                eprintln!("wvrelay: {error}");
                std::process::exit(2);
            }
        };
    if !addr.ip().is_loopback()
        && (hmac_secret.as_deref().is_none_or(str::is_empty) || allowed_origins.is_empty())
    {
        eprintln!(
            "wvrelay: a non-loopback bind requires WVRELAY_HMAC_SECRET and WVRELAY_ALLOWED_ORIGINS"
        );
        std::process::exit(2);
    }
    if hmac_secret.is_some() == allowed_origins.is_empty() {
        eprintln!(
            "wvrelay: WVRELAY_HMAC_SECRET and WVRELAY_ALLOWED_ORIGINS must be configured together"
        );
        std::process::exit(2);
    }

    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("wvrelay: cannot bind {addr}: {e}");
            std::process::exit(1);
        }
    };

    // Announce the ACTUAL bound address (so a `:0` ephemeral bind is discoverable) on stdout, then
    // flush — a supervisor or the smoke test waits for this line to know the relay is ready.
    let local = listener.local_addr().unwrap_or(addr);
    println!("wvrelay listening on ws://{local}");
    use std::io::Write;
    let _ = std::io::stdout().flush();

    match hmac_secret {
        Some(secret) => {
            println!(
                "wvrelay security enabled for {} origin(s)",
                allowed_origins.len()
            );
            wasm_vm_slirp::ws_proxy::serve_ws_secure(
                listener,
                secret.into_bytes(),
                allowed_origins,
                host_map,
            )
            .await;
        }
        None => {
            println!("wvrelay loopback development mode (authentication disabled)");
            wasm_vm_slirp::ws_proxy::serve_ws_with_host_map(listener, Vec::new(), host_map).await;
        }
    }
}

fn issue_token_command() {
    let mut args = std::env::args().skip(2);
    let origin = args.next().unwrap_or_else(|| {
        eprintln!("usage: wvrelay issue-token ORIGIN RANDOM_ID [TTL_SECONDS]");
        std::process::exit(2);
    });
    let id = args.next().unwrap_or_else(|| {
        eprintln!("usage: wvrelay issue-token ORIGIN RANDOM_ID [TTL_SECONDS]");
        std::process::exit(2);
    });
    let ttl = args
        .next()
        .as_deref()
        .unwrap_or("900")
        .parse::<u64>()
        .unwrap_or_else(|_| {
            eprintln!("wvrelay: TTL_SECONDS must be an integer no greater than 900");
            std::process::exit(2);
        });
    let secret = std::env::var("WVRELAY_HMAC_SECRET").unwrap_or_else(|_| {
        eprintln!("wvrelay: WVRELAY_HMAC_SECRET is required to issue a token");
        std::process::exit(2);
    });
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time predates Unix epoch")
        .as_secs();
    let token = wasm_vm_slirp::ws_proxy::issue_relay_token(
        secret.as_bytes(),
        now,
        now.saturating_add(ttl),
        &origin,
        &id,
    )
    .unwrap_or_else(|error| {
        eprintln!("wvrelay: refused token request: {error:?}");
        std::process::exit(2);
    });
    println!(
        "{}",
        String::from_utf8(token).expect("relay token is ASCII")
    );
}

#[cfg(test)]
mod tests {
    use super::{parse_host_map, parse_origins, resolve_addr};

    #[test]
    fn defaults_to_loopback_8080_when_nothing_given() {
        assert_eq!(
            resolve_addr(None, None).unwrap().to_string(),
            "127.0.0.1:8080"
        );
    }

    #[test]
    fn argument_wins_over_env() {
        assert_eq!(
            resolve_addr(Some("0.0.0.0:9000"), Some("127.0.0.1:1"))
                .unwrap()
                .to_string(),
            "0.0.0.0:9000"
        );
    }

    #[test]
    fn env_used_when_no_argument() {
        assert_eq!(
            resolve_addr(None, Some("127.0.0.1:7000"))
                .unwrap()
                .to_string(),
            "127.0.0.1:7000"
        );
    }

    #[test]
    fn a_bad_explicit_address_is_a_hard_error_not_a_silent_default() {
        assert!(resolve_addr(Some("not-an-addr"), None).is_err());
        // An unparseable env value is also an error — never silently fall back to the default.
        assert!(resolve_addr(None, Some("999.999.999.999:1")).is_err());
    }

    #[test]
    fn host_map_is_exact_and_rejects_ambiguous_entries() {
        let map = parse_host_map(Some("192.0.2.1=127.0.0.1,example.test=localhost")).unwrap();
        assert_eq!(map.get("192.0.2.1").map(String::as_str), Some("127.0.0.1"));
        assert_eq!(
            map.get("example.test").map(String::as_str),
            Some("localhost")
        );
        assert!(parse_host_map(Some("missing-equals")).is_err());
        assert!(parse_host_map(Some("a=b,a=c")).is_err());
        assert!(parse_host_map(Some("=target")).is_err());
    }

    #[test]
    fn origins_are_exact_and_require_http_schemes() {
        let origins = parse_origins(Some("https://vm.example,http://localhost:4321")).unwrap();
        assert!(origins.contains("https://vm.example"));
        assert!(origins.contains("http://localhost:4321"));
        assert!(parse_origins(Some("*.example.com")).is_err());
        assert!(parse_origins(Some("https://ok.example,")).is_err());
    }
}
