use wasm_vm_core::desktop_restore::{
    DesktopRestoreCommit, DesktopRestorePreparation, DisplaySize, ViewportDisposition,
};

fn main() {
    let _preparation = DesktopRestorePreparation {
        scanout: DisplaySize::new(1, 1),
        host_viewport: DisplaySize::new(1, 1),
        disposition: ViewportDisposition::Native,
    };
    let _commit = DesktopRestoreCommit { _private: () };
}
