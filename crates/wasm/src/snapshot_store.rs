//! E3-T12d durable **resume-snapshot** IndexedDB backend (wasm32 only). Persists a whole-machine
//! resume blob (the [`wasm_vm_core::resume`] container) across a tab reload so a booted guest resumes
//! instead of cold-booting. A resume blob is large (tens of MiB for a booted Alpine); this module
//! streams it as fixed-size chunks into batched, strict-durability transactions so a second whole-blob
//! copy is never held on either the save or the load side.
//!
//! Schema (see [`wasm_vm_storage::snapmeta`]): DB name `snapshot_store_name(base_binding)` (namespaced
//! per base image, exactly like the overlay store), version `SNAPSHOT_DB_VERSION`. Object stores:
//! `chunks` (key = chunk index as a number — chunk indices are far below 2^53 for any real snapshot,
//! so f64 is exact) and `meta` (the single [`SnapshotMeta`] record under key 0).
//!
//! **Commit contract.** `meta` is written LAST, after every chunk's strict transaction has committed,
//! so a normally published meta record means all chunks are present and match its digest. A tab that
//! dies mid-save leaves chunks but no new meta; the load side either reads no meta or detects the old
//! meta's missing/mismatched chunks and cold-boots (never resumes a half-published store). The corrupt
//! marker path may deliberately preserve an old meta digest while clearing chunks; load treats that
//! state as an explicit corrupt marker, and a later import must match the preserved digest to recover.
//! Before writing the new chunk set, `save` CLEARS the old chunks so a smaller new snapshot can't leave
//! stale trailing chunks from a larger prior one that would fail reassembly's exact-length check.
//!
//! Mirrors [`crate::idb_store`] deliberately — same `await_request`/`await_transaction` helpers, same
//! `rw_strict` durability, same global-scope factory lookup and versionchange auto-close.

use js_sys::{Array, Uint8Array};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{IdbDatabase, IdbObjectStore, IdbRequest, IdbTransaction};

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use wasm_vm_storage::{
    SNAPSHOT_CHUNK, SNAPSHOT_DB_VERSION, SnapshotMeta, reassemble, snapshot_store_name,
};

const CHUNKS: &str = "chunks";
const META: &str = "meta";
const META_KEY: f64 = 0.0;
/// Chunks written per strict `readwrite` transaction — bounds the per-transaction size (16 MiB at the
/// 1 MiB `SNAPSHOT_CHUNK`) so a single txn is never the whole multi-tens-of-MiB blob.
const CHUNKS_PER_TXN: usize = 16;

/// A handle to the opened snapshot database. `Clone` (the `IdbDatabase` is a cheap JS handle) so the
/// async persist/restore drivers can clone it and `await` without holding a `RefCell` borrow.
#[derive(Clone)]
pub struct SnapshotStore {
    db: IdbDatabase,
    base_binding: [u8; 32],
}

impl SnapshotStore {
    /// Close this IndexedDB connection so a `deleteDatabase` (reset) can proceed without blocking.
    /// Idempotent; the store must not be used for I/O afterward. (Reset-disk wiring is a follow-up;
    /// present now so the store closes symmetrically with `idb_store`.)
    #[allow(dead_code)]
    pub fn close(&self) {
        self.db.close();
    }

    /// Open (creating/upgrading) the snapshot DB for the base identified by `base_binding`. Creates the
    /// `chunks` + `meta` object stores on first use / version upgrade.
    pub async fn open(base_binding: &[u8; 32]) -> Result<SnapshotStore, JsValue> {
        let global = js_sys::global();
        let factory = if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
            scope.indexed_db()
        } else if let Some(win) = global.dyn_ref::<web_sys::Window>() {
            win.indexed_db()
        } else {
            return Err(JsValue::from_str("no global for IndexedDB"));
        }?
        .ok_or_else(|| JsValue::from_str("IndexedDB unavailable"))?;

        let name = snapshot_store_name(base_binding);
        let req = factory.open_with_u32(&name, SNAPSHOT_DB_VERSION)?;

        // Create object stores on upgrade. The DB version is constant (SNAPSHOT_DB_VERSION), so
        // onupgradeneeded fires only for a brand-new DB where neither store exists yet — create both.
        let upgrade = Closure::<dyn FnMut(web_sys::IdbVersionChangeEvent)>::new(
            move |e: web_sys::IdbVersionChangeEvent| {
                if let Some(t) = e.target()
                    && let Ok(r) = t.dyn_into::<web_sys::IdbOpenDbRequest>()
                    && let Ok(db) = r.result().and_then(|v| v.dyn_into::<IdbDatabase>())
                {
                    let _ = db.create_object_store(CHUNKS);
                    let _ = db.create_object_store(META);
                }
            },
        );
        req.set_onupgradeneeded(Some(upgrade.as_ref().unchecked_ref()));
        upgrade.forget();

        let db_val = await_request(req.unchecked_ref()).await?;
        let db: IdbDatabase = db_val.dyn_into()?;
        // Close this connection when ANOTHER context requests a versionchange (i.e. deleteDatabase for
        // a reset) — otherwise our open handle blocks the delete indefinitely (mirrors idb_store).
        let db_for_vc = db.clone();
        let on_vc = Closure::<dyn FnMut(web_sys::Event)>::new(move |_e| {
            db_for_vc.close();
        });
        db.set_onversionchange(Some(on_vc.as_ref().unchecked_ref()));
        on_vc.forget();
        Ok(SnapshotStore {
            db,
            base_binding: *base_binding,
        })
    }

    /// The stored meta record bytes (`None` if no snapshot is persisted / a brand-new DB).
    pub async fn read_meta(&self) -> Result<Option<Vec<u8>>, JsValue> {
        let txn = self.db.transaction_with_str(META)?;
        let store = txn.object_store(META)?;
        let got = await_request(&store.get(&JsValue::from_f64(META_KEY))?).await?;
        if got.is_undefined() || got.is_null() {
            Ok(None)
        } else {
            Ok(Some(Uint8Array::new(&got).to_vec()))
        }
    }

    /// A strict-durability `readwrite` transaction on `store` — its `complete` event fires only once the
    /// data is flushed to disk, not merely handed to the OS cache. Called via `js_sys` reflection
    /// because web-sys gates the typed `IdbTransactionOptions` behind `web_sys_unstable_apis` (a
    /// project-wide build flag we avoid); `db.transaction(store, "readwrite", { durability: "strict" })`
    /// is the stable equivalent (mirrors idb_store::rw_strict).
    fn rw_strict(&self, store: &str) -> Result<IdbTransaction, JsValue> {
        let opts = js_sys::Object::new();
        js_sys::Reflect::set(&opts, &"durability".into(), &JsValue::from_str("strict"))?;
        let txn_fn = js_sys::Reflect::get(&self.db, &"transaction".into())?
            .dyn_into::<js_sys::Function>()?;
        let args = js_sys::Array::of3(
            &JsValue::from_str(store),
            &JsValue::from_str("readwrite"),
            &opts,
        );
        js_sys::Reflect::apply(&txn_fn, &self.db, &args)?.dyn_into::<IdbTransaction>()
    }

    /// Clear the chunk object store while leaving the meta commit marker untouched. `mark_corrupt`
    /// uses this to invalidate the currently published chunks without throwing away the digest of a
    /// previously valid snapshot, so a later re-import can prove it is restoring that exact payload.
    async fn clear_chunks(&self) -> Result<(), JsValue> {
        let txn = self.rw_strict(CHUNKS)?;
        txn.object_store(CHUNKS)?.clear()?;
        await_transaction(&txn).await
    }

    /// Persist `blob` as the resume snapshot for `base_binding`. Order matters for crash safety:
    /// 1. CLEAR the old chunks (strict txn) so a smaller new snapshot leaves no stale trailing chunk.
    /// 2. Write the chunks in batched strict `readwrite` transactions (`CHUNKS_PER_TXN` per txn).
    /// 3. Write the meta record LAST — it is the commit marker (meta present ⇒ all chunks present).
    ///
    /// Only chunk slices of `blob` are copied into JS (via `Uint8Array::from`); no second whole-blob
    /// copy is ever held. On a `QuotaExceededError` the underlying transaction rejects with that name.
    pub async fn save(&self, blob: &[u8], base_binding: &[u8; 32]) -> Result<(), JsValue> {
        if *base_binding != self.base_binding {
            return Err(JsValue::from_str("foreign_image"));
        }
        let digest: [u8; 32] = Sha256::digest(blob).into();
        let meta = SnapshotMeta::new(blob.len() as u64, *base_binding, digest);

        // 1. Drop any prior chunk set first — a shorter new snapshot must not inherit stale trailing
        //    chunks that reassembly's exact-count/length check would then trip on.
        self.clear_chunks().await?;

        // 2. Stream the blob as 1 MiB chunks, batching CHUNKS_PER_TXN puts per strict transaction so a
        //    single txn is bounded rather than the whole blob.
        let mut batch_start: Option<IdbTransaction> = None;
        let mut store: Option<IdbObjectStore> = None;
        let mut in_batch = 0usize;
        for (index, chunk) in blob.chunks(SNAPSHOT_CHUNK).enumerate() {
            if batch_start.is_none() {
                let txn = self.rw_strict(CHUNKS)?;
                store = Some(txn.object_store(CHUNKS)?);
                batch_start = Some(txn);
                in_batch = 0;
            }
            let arr = Uint8Array::from(chunk);
            store
                .as_ref()
                .unwrap()
                .put_with_key(&arr, &JsValue::from_f64(index as f64))?;
            in_batch += 1;
            if in_batch == CHUNKS_PER_TXN {
                // Commit this batch (strict complete = durably flushed) before opening the next.
                await_transaction(batch_start.as_ref().unwrap()).await?;
                batch_start = None;
                store = None;
            }
        }
        // Flush a partial trailing batch.
        if let Some(txn) = batch_start.as_ref() {
            await_transaction(txn).await?;
        }

        // 3. The commit marker: meta present ⇒ every chunk above committed.
        self.write_meta(&meta.to_bytes()).await
    }

    /// Invalidate the stored snapshot after an externally supplied blob fails framing or content
    /// validation. If a previously valid snapshot exists, preserve its length + digest in `meta` but
    /// clear its chunks; the next load then returns a typed corrupt marker, while a later import can
    /// restore the old snapshot only if its complete payload matches that digest. With no usable prior
    /// record, write a zero-length marker. The live machine and overlay are never mutated.
    pub async fn mark_corrupt(&self, base_binding: &[u8; 32]) -> Result<(), JsValue> {
        if *base_binding != self.base_binding {
            return Err(JsValue::from_str("foreign_image"));
        }
        let prior = self
            .read_meta()
            .await?
            .and_then(|bytes| SnapshotMeta::from_bytes(&bytes).ok())
            .filter(|meta| meta.base_binding == self.base_binding && meta.total_len > 0);
        self.clear_chunks().await?;
        if prior.is_none() {
            let empty_digest: [u8; 32] = Sha256::digest([]).into();
            self.write_meta(&SnapshotMeta::new(0, self.base_binding, empty_digest).to_bytes())
                .await?;
        }
        Ok(())
    }

    /// Write (or replace) the meta record (strict durability). The snapshot's commit marker.
    async fn write_meta(&self, bytes: &[u8]) -> Result<(), JsValue> {
        let txn = self.rw_strict(META)?;
        let store = txn.object_store(META)?;
        let arr = Uint8Array::from(bytes);
        store.put_with_key(&arr, &JsValue::from_f64(META_KEY))?;
        await_transaction(&txn).await
    }

    /// Reassemble the persisted snapshot blob, or `Ok(None)` if none is stored (no meta record). A
    /// malformed meta, a torn/half-published chunk set, a base mismatch, or a payload digest mismatch
    /// is returned as `Some(Vec::new())`: an explicit corrupt marker that the JS boundary maps to a
    /// typed cold boot instead of treating a storage fault as an API error. Produces exactly one
    /// `Vec` of `total_len` bytes — the chunk map is consumed as it is copied out.
    pub async fn load(&self) -> Result<Option<Vec<u8>>, JsValue> {
        let Some(meta_bytes) = self.read_meta().await? else {
            return Ok(None);
        };
        let Ok(meta) = SnapshotMeta::from_bytes(&meta_bytes) else {
            return Ok(Some(Vec::new()));
        };
        if meta.base_binding != self.base_binding {
            return Ok(Some(Vec::new()));
        }

        let txn = self.db.transaction_with_str(CHUNKS)?;
        let store = txn.object_store(CHUNKS)?;
        let keys: Array = await_request(&store.get_all_keys()?).await?.into();
        let vals: Array = await_request(&store.get_all()?).await?.into();
        let mut map: BTreeMap<u64, Vec<u8>> = BTreeMap::new();
        for i in 0..keys.length() {
            let k = keys.get(i).as_f64().unwrap_or(-1.0);
            if k < 0.0 {
                continue;
            }
            map.insert(k as u64, Uint8Array::new(&vals.get(i)).to_vec());
        }
        // A torn/short/missing chunk is a storage-integrity fault → cold boot. Return an explicit
        // empty marker so the restore decision sees `corrupt` and no caller can accidentally resume.
        let Ok(blob) = reassemble(&meta, map) else {
            return Ok(Some(Vec::new()));
        };
        let digest: [u8; 32] = Sha256::digest(&blob).into();
        if digest != meta.blob_sha256 {
            return Ok(Some(Vec::new()));
        }
        Ok(Some(blob))
    }

    /// Clear both stores — discard a foreign/stale snapshot so the next boot cold-boots cleanly.
    /// (The discard-on-foreign/stale UI wiring is a follow-up; present now as the store primitive.)
    #[allow(dead_code)]
    pub async fn clear(&self) -> Result<(), JsValue> {
        self.clear_chunks().await?;
        let txn = self.rw_strict(META)?;
        txn.object_store(META)?.clear()?;
        await_transaction(&txn).await
    }
}

/// Await an `IdbRequest`, resolving to its `.result` on `success` or rejecting on `error`
/// (mirrors idb_store::await_request).
async fn await_request(req: &IdbRequest) -> Result<JsValue, JsValue> {
    let req = req.clone();
    let promise = js_sys::Promise::new(&mut |resolve, reject| {
        let reject2 = reject.clone();
        let r_ok = req.clone();
        let onsuccess = Closure::<dyn FnMut(web_sys::Event)>::new(move |_e| match r_ok.result() {
            Ok(v) => {
                let _ = resolve.call1(&JsValue::NULL, &v);
            }
            Err(e) => {
                let _ = reject.call1(&JsValue::NULL, &e);
            }
        });
        let r_err = req.clone();
        let onerror = Closure::<dyn FnMut(web_sys::Event)>::new(move |_e| {
            let e = r_err
                .error()
                .ok()
                .flatten()
                .map(JsValue::from)
                .unwrap_or_else(|| JsValue::from_str("IndexedDB request error"));
            let _ = reject2.call1(&JsValue::NULL, &e);
        });
        req.set_onsuccess(Some(onsuccess.as_ref().unchecked_ref()));
        req.set_onerror(Some(onerror.as_ref().unchecked_ref()));
        onsuccess.forget();
        onerror.forget();
    });
    JsFuture::from(promise).await
}

/// Await an `IdbTransaction`, resolving on `complete` or rejecting on `error`/`abort`. On abort the
/// DOMException NAME (esp. `QuotaExceededError`) is surfaced so the boundary can classify quota
/// exhaustion vs a generic failure (mirrors idb_store::await_transaction).
async fn await_transaction(txn: &IdbTransaction) -> Result<(), JsValue> {
    let promise = js_sys::Promise::new(&mut |resolve, reject| {
        let oncomplete = Closure::<dyn FnMut(web_sys::Event)>::new(move |_e| {
            let _ = resolve.call0(&JsValue::NULL);
        });
        let txn_err = txn.clone();
        let onerror = Closure::<dyn FnMut(web_sys::Event)>::new(move |_e| {
            let name = txn_err
                .error()
                .map(|e| e.name())
                .unwrap_or_else(|| "IndexedDB transaction failed".to_string());
            let _ = reject.call1(&JsValue::NULL, &JsValue::from_str(&name));
        });
        txn.set_oncomplete(Some(oncomplete.as_ref().unchecked_ref()));
        txn.set_onerror(Some(onerror.as_ref().unchecked_ref()));
        txn.set_onabort(Some(onerror.as_ref().unchecked_ref()));
        oncomplete.forget();
        onerror.forget();
    });
    JsFuture::from(promise).await.map(|_| ())
}
