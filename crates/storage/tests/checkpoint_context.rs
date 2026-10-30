#[path = "checkpoint_context/cases.rs"]
mod cases;
#[test]
fn exact_cursor_and_keys() {
    cases::exact_cursor_and_keys();
}
#[test]
fn refuse_shapes_versions_and_unrecorded_modes() {
    cases::refuse_shapes_versions_and_unrecorded_modes();
}
