#![cfg(not(feature = "zicsr-stub"))]
#[path = "../../../tests/shared/e5_t22f_pmp.rs"]
mod fixture;

#[test]
fn su_guest_trace_parity() {
    fixture::su_guest_trace_parity();
}
#[test]
fn su_revision_revocation() {
    fixture::su_revision_revocation();
}
#[test]
fn su_snapshot_and_host_sequence() {
    fixture::su_snapshot_and_host_sequence();
}
