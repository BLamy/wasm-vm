//! E9-T04: capture the actual COW backend; historical restore uses a new private seeded backend.
use super::*;

#[wasm_bindgen]
impl WasmLinux {
    /// Own a bounded disk delta after draining original disk work, without retiring instructions.
    /// The owner must keep execution paused and join this Promise before releasing storage. Each
    /// pass resolves actual pending fetch/durability work before retrying native quiescence.
    /// The exact u64 generation is encoded without crossing the legacy f64 generation API.
    #[wasm_bindgen(js_name = captureDiskDelta)]
    pub async fn capture_disk_delta(&self) -> Result<js_sys::Uint8Array, JsError> {
        for _ in 0..Machine::QUIESCE_MAX_PASSES {
            {
                let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
                if inner.checkpoint_disk.is_none() {
                    return Err(JsError::new("session_disk_unsupported"));
                }
                match inner.machine.quiesce() {
                    Ok(()) => {
                        if let Ok(delta) = inner
                            .checkpoint_disk
                            .as_ref()
                            .unwrap()
                            .snapshot_delta(inner.machine.overlay_generation())
                        {
                            return Ok(js_sys::Uint8Array::from(delta.to_bytes().as_slice()));
                        }
                    }
                    Err(resume::SnapshotError::NotQuiesced { .. }) => {}
                    Err(error) => {
                        return Err(JsError::new(&format!("session_disk_quiesce: {error:?}")));
                    }
                }
            }
            // Never hold the machine borrow across browser I/O. A quiesce pass can expose the next
            // original read or write in the ring, so repeat the barriers without executing the CPU.
            self.fetch_pending().await?;
            self.persist_pending().await?;
        }
        Err(JsError::new("session_disk_busy_or_budget"))
    }
}
