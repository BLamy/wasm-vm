use super::*;
use std::net::{IpAddr, Ipv4Addr};

fn key(proto: Proto, gp: u16, dst: u8, dp: u16) -> FlowKey {
    FlowKey {
        proto,
        guest_ip: IpAddr::V4(Ipv4Addr::new(10, 0, 2, 15)),
        guest_port: gp,
        dst_ip: IpAddr::V4(Ipv4Addr::new(93, 184, 216, dst)),
        dst_port: dp,
    }
}

#[test]
fn touch_creates_then_refreshes() {
    let mut t = FlowTable::new(16);
    let k = key(Proto::Tcp, 40000, 34, 443);
    let o = t.touch(k.clone(), 1000);
    assert!(o.created && o.evicted.is_none());
    assert_eq!(t.len(), 1);
    // A second touch refreshes — does NOT create or evict.
    let o2 = t.touch(k.clone(), 2000);
    assert!(!o2.created && o2.evicted.is_none());
    assert_eq!(t.len(), 1);
}

#[test]
fn udp_expires_at_30s_tcp_survives() {
    let mut t = FlowTable::new(16);
    let udp = key(Proto::Udp, 5353, 1, 53);
    let tcp = key(Proto::Tcp, 40001, 2, 443);
    t.touch(udp.clone(), 0);
    t.touch(tcp.clone(), 0);
    // At 30s the UDP flow is idle-expired; the TCP flow (2h idle) is not.
    let gone = t.sweep_expired(UDP_IDLE_MS);
    assert_eq!(gone, vec![udp.clone()]);
    assert!(t.contains(&tcp) && !t.contains(&udp));
    // TCP survives until 2h.
    assert!(t.sweep_expired(TCP_IDLE_MS - 1).is_empty());
    assert_eq!(t.sweep_expired(TCP_IDLE_MS), vec![tcp]);
    assert!(t.is_empty());
}

#[test]
fn refresh_keeps_a_flow_alive_past_its_timeout() {
    let mut t = FlowTable::new(16);
    let k = key(Proto::Udp, 5353, 1, 53);
    t.touch(k.clone(), 0);
    // Refresh just before expiry → the idle clock resets.
    t.touch(k.clone(), UDP_IDLE_MS - 1);
    assert!(
        t.sweep_expired(UDP_IDLE_MS).is_empty(),
        "refreshed flow must survive"
    );
    // But it expires 30s after the LAST activity.
    assert_eq!(t.sweep_expired(2 * UDP_IDLE_MS - 1), vec![k]);
}

#[test]
fn bound_evicts_least_recently_active() {
    let mut t = FlowTable::new(2);
    let a = key(Proto::Tcp, 1, 1, 80);
    let b = key(Proto::Tcp, 2, 2, 80);
    let c = key(Proto::Tcp, 3, 3, 80);
    t.touch(a.clone(), 100);
    t.touch(b.clone(), 200);
    // `a` is the least-recently-active; adding `c` (at capacity) evicts `a`.
    let o = t.touch(c.clone(), 300);
    assert!(o.created);
    assert_eq!(o.evicted, Some(a.clone()));
    assert_eq!(t.len(), 2);
    assert!(!t.contains(&a) && t.contains(&b) && t.contains(&c));
}

#[test]
fn refresh_updates_lru_order_for_eviction() {
    let mut t = FlowTable::new(2);
    let a = key(Proto::Tcp, 1, 1, 80);
    let b = key(Proto::Tcp, 2, 2, 80);
    let c = key(Proto::Tcp, 3, 3, 80);
    t.touch(a.clone(), 100);
    t.touch(b.clone(), 200);
    t.touch(a.clone(), 300); // `a` refreshed → now `b` is the LRU
    let o = t.touch(c.clone(), 400);
    assert_eq!(
        o.evicted,
        Some(b),
        "the refreshed flow `a` must survive; `b` evicted"
    );
    assert!(t.contains(&a) && t.contains(&c));
}

#[test]
fn remove_and_empty() {
    let mut t = FlowTable::new(4);
    let k = key(Proto::Tcp, 1, 1, 80);
    t.touch(k.clone(), 0);
    assert!(t.remove(&k));
    assert!(!t.remove(&k)); // idempotent
    assert!(t.is_empty());
}

#[test]
fn sweep_is_deterministic_and_only_expired() {
    let mut t = FlowTable::new(16);
    // Three UDP flows touched at staggered times; sweep at 40s expires only those idle ≥ 30s.
    let k0 = key(Proto::Udp, 1, 1, 53);
    let k1 = key(Proto::Udp, 2, 2, 53);
    let k2 = key(Proto::Udp, 3, 3, 53);
    t.touch(k0.clone(), 0); // idle 40s at t=40s → expired
    t.touch(k1.clone(), 5000); // idle 35s → expired
    t.touch(k2.clone(), 20_000); // idle 20s → survives
    let gone = t.sweep_expired(40_000);
    assert_eq!(gone, vec![k0, k1]); // BTreeMap order, deterministic
    assert!(t.contains(&k2) && t.len() == 1);
}
