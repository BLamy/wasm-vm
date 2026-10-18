#[path = "disk_root/cases.rs"]
mod cases;

#[test]
fn snapshot_backends_require_durability_and_ownership() {
    cases::snapshot_backends_require_durability_and_ownership();
}

#[test]
fn golden_exact_generation() {
    cases::golden_exact_generation();
}
#[test]
fn private_forks_restore_in_reverse() {
    cases::private_forks_restore_in_reverse();
}
#[test]
fn identities_refuse_before_loading() {
    cases::identities_refuse_before_loading();
}
#[test]
fn payload_failure_cannot_publish_a_partial_disk() {
    cases::payload_failure_cannot_publish_a_partial_disk();
}
#[test]
fn schema_order_and_bounds() {
    cases::schema_order_and_bounds();
}
#[test]
fn deleting_child_pins_preserves_shared_ancestors() {
    cases::deleting_child_pins_preserves_shared_ancestors();
}
#[test]
fn seeded_interleavings_keep_owned_roots_stable() {
    cases::seeded_interleavings_keep_owned_roots_stable();
}
