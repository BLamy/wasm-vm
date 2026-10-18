//! Browser adapters over the shared session codec. No storage or VM mutation here.
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;
use wasm_vm_storage::disk_root;
use wasm_vm_storage::session::{SessionError, SessionManifest};
use wasm_vm_storage::session_publication;

#[wasm_bindgen(js_name = sessionValidateCheckpointContext)]
pub fn validate_checkpoint_context(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    wasm_vm_storage::checkpoint::CheckpointContext::from_bytes(bytes)
        .and_then(|context| context.to_bytes())
        .map_err(js_error)
}

#[wasm_bindgen(js_name = sessionCanonicalImage)]
pub fn canonical_image(text: &str) -> Result<Vec<u8>, JsError> {
    wasm_vm_storage::ImageManifest::from_json(text)
        .map(|image| image.to_json().into_bytes())
        .map_err(|error| JsError::new(&format!("session image: {error:?}")))
}

#[wasm_bindgen(js_name = sessionValidateDiskRoot)]
pub fn validate_disk_root(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    disk_root::DiskRoot::from_bytes(bytes)
        .and_then(|r| r.to_bytes())
        .map_err(js_error)
}

#[wasm_bindgen(js_name = sessionAdmitDiskRoot)]
pub fn admit_disk_root(bytes: &[u8], image: &str, generation: &str) -> Result<Vec<u8>, JsError> {
    disk_root::admit_json(bytes, image, generation).map_err(js_error)
}

#[wasm_bindgen(js_name = sessionDiskRootReferences)]
pub fn disk_root_references(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    disk_root::references_json(bytes).map_err(js_error)
}

fn js_error(error: SessionError) -> JsError {
    JsError::new(&format!("session metadata: {error:?}"))
}

#[wasm_bindgen(js_name = sessionValidateManifest)]
pub fn validate_manifest(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    SessionManifest::from_bytes(bytes)
        .and_then(|m| m.to_bytes())
        .map_err(js_error)
}

#[wasm_bindgen(js_name = sessionManifestReferences)]
pub fn manifest_references(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    session_publication::references_json(bytes).map_err(js_error)
}

#[wasm_bindgen(js_name = sessionEventReferences)]
pub fn event_references(manifest: &[u8], chunk: &[u8]) -> Result<Vec<u8>, JsError> {
    session_publication::event_references_json(manifest, chunk).map_err(js_error)
}

#[wasm_bindgen(js_name = sessionCheckAppend)]
pub fn check_append(previous: &[u8], candidate: &[u8]) -> Result<(), JsError> {
    let previous = SessionManifest::from_bytes(previous).map_err(js_error)?;
    let candidate = SessionManifest::from_bytes(candidate).map_err(js_error)?;
    session_publication::check_append(&previous, &candidate).map_err(js_error)
}

/// Incremental session-object hashing lives beside metadata, independently of the VM bundle.
#[wasm_bindgen]
pub struct SessionSha256(Option<Sha256>);

impl Default for SessionSha256 {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl SessionSha256 {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self(Some(Sha256::new()))
    }

    pub fn update(&mut self, bytes: &[u8]) -> Result<(), JsError> {
        self.0
            .as_mut()
            .ok_or_else(|| JsError::new("session SHA-256 already finished"))?
            .update(bytes);
        Ok(())
    }

    pub fn finish(&mut self) -> Result<String, JsError> {
        let hash = self
            .0
            .take()
            .ok_or_else(|| JsError::new("session SHA-256 already finished"))?;
        Ok(format!("{:x}", hash.finalize()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn independently_known_incremental_digest() {
        let mut hash = SessionSha256::default();
        hash.update(b"a").unwrap();
        hash.update(b"bc").unwrap();
        assert_eq!(
            hash.finish().unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
