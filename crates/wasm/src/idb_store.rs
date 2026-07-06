//! E3-T05: the IndexedDB durable overlay store (wasm32 only). Persists the copy-on-write overlay's
//! 4 KiB blocks so guest writes survive a tab reload. IndexedDB is async + callback-based; this module
//! bridges it to the synchronous emulator via the shared [`PersistQueue`] — it loads blocks back on
//! reopen (into `WriteBackOverlay::from_loaded`/`with_shared_queue`) and drains the queue into batched
//! `readwrite` transactions whose `complete` event is the honest durability barrier.
//!
//! Schema: DB name `overlay_store_name(base_hash)` (namespaced per image), version `OVERLAY_DB_VERSION`.
//! Object stores: `blocks` (key = block index as a number — block indices are far below 2^53 for any
//! real image, so f64 is exact) and `meta` (the single [`OverlayMeta`] record under key 0).

use js_sys::{Array, Uint8Array};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{IdbDatabase, IdbObjectStore, IdbRequest, IdbTransaction};

use std::collections::BTreeMap;

use wasm_vm_storage::{OVERLAY_BLOCK, OVERLAY_DB_VERSION, overlay_store_name};

const BLOCKS: &str = "blocks";
const META: &str = "meta";
const META_KEY: f64 = 0.0;

/// A handle to the opened overlay database. `Clone` (the `IdbDatabase` is a cheap JS handle) so the
/// async persist pump can clone it out of the machine and `await` without holding a `RefCell` borrow.
#[derive(Clone)]
pub struct IdbStore {
    db: IdbDatabase,
}

impl IdbStore {
    /// Open (creating/upgrading) the overlay DB for the base identified by `base_binding`. Creates the
    /// `blocks` + `meta` object stores on first use / version upgrade.
    pub async fn open(base_binding: &[u8; 32]) -> Result<IdbStore, JsValue> {
        let global = js_sys::global();
        let factory = if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
            scope.indexed_db()
        } else if let Some(win) = global.dyn_ref::<web_sys::Window>() {
            win.indexed_db()
        } else {
            return Err(JsValue::from_str("no global for IndexedDB"));
        }?
        .ok_or_else(|| JsValue::from_str("IndexedDB unavailable"))?;

        let name = overlay_store_name(base_binding);
        let req = factory.open_with_u32(&name, OVERLAY_DB_VERSION)?;

        // Create object stores on upgrade. The DB version is constant (OVERLAY_DB_VERSION), so
        // onupgradeneeded fires only for a brand-new DB where neither store exists yet — create both.
        let upgrade = Closure::<dyn FnMut(web_sys::IdbVersionChangeEvent)>::new(
            move |e: web_sys::IdbVersionChangeEvent| {
                if let Some(t) = e.target()
                    && let Ok(r) = t.dyn_into::<web_sys::IdbOpenDbRequest>()
                    && let Ok(db) = r.result().and_then(|v| v.dyn_into::<IdbDatabase>())
                {
                    let _ = db.create_object_store(BLOCKS);
                    let _ = db.create_object_store(META);
                }
            },
        );
        req.set_onupgradeneeded(Some(upgrade.as_ref().unchecked_ref()));
        upgrade.forget();

        let db_val = await_request(req.unchecked_ref()).await?;
        let db: IdbDatabase = db_val.dyn_into()?;
        Ok(IdbStore { db })
    }

    /// The stored meta record bytes (`None` if this is a brand-new DB).
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

    /// A strict-durability `readwrite` transaction on `store` — the txn's `complete` event fires only
    /// once the data is flushed to disk, not merely handed to the OS cache (E3-T05: `durability:"strict"`
    /// on commit-critical transactions). Called via `js_sys` reflection because web-sys gates the typed
    /// `IdbTransactionOptions` behind `web_sys_unstable_apis` (a project-wide build flag we avoid);
    /// `db.transaction(store, "readwrite", { durability: "strict" })` is the stable equivalent.
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

    /// Write (or replace) the meta record (strict durability).
    pub async fn write_meta(&self, bytes: &[u8]) -> Result<(), JsValue> {
        let txn = self.rw_strict(META)?;
        let store = txn.object_store(META)?;
        let arr = Uint8Array::from(bytes);
        store.put_with_key(&arr, &JsValue::from_f64(META_KEY))?;
        await_transaction(&txn).await
    }

    /// Load every persisted 4 KiB block into a map (for `WriteBackOverlay::with_shared_queue` on reopen).
    /// A stored value of the wrong length is skipped (never a panic) — belt-and-suspenders.
    pub async fn load_blocks(&self) -> Result<BTreeMap<u64, [u8; OVERLAY_BLOCK]>, JsValue> {
        let txn = self.db.transaction_with_str(BLOCKS)?;
        let store = txn.object_store(BLOCKS)?;
        let keys: Array = await_request(&store.get_all_keys()?).await?.into();
        let vals: Array = await_request(&store.get_all()?).await?.into();
        let mut out = BTreeMap::new();
        for i in 0..keys.length() {
            let k = keys.get(i).as_f64().unwrap_or(-1.0);
            if k < 0.0 {
                continue;
            }
            let bytes = Uint8Array::new(&vals.get(i)).to_vec();
            if bytes.len() == OVERLAY_BLOCK {
                let mut b = [0u8; OVERLAY_BLOCK];
                b.copy_from_slice(&bytes);
                out.insert(k as u64, b);
            }
        }
        Ok(out)
    }

    /// Persist a batch of `(block, bytes)` in ONE strict-durability `readwrite` transaction; resolves
    /// only on the transaction's `complete` event — with `durability:strict` that is the honest
    /// durability barrier (data flushed to disk, E3-T05 commit contract).
    pub async fn persist(&self, batch: &[(u64, [u8; OVERLAY_BLOCK])]) -> Result<(), JsValue> {
        if batch.is_empty() {
            return Ok(());
        }
        let txn = self.rw_strict(BLOCKS)?;
        let store: IdbObjectStore = txn.object_store(BLOCKS)?;
        for (block, bytes) in batch {
            let arr = Uint8Array::from(&bytes[..]);
            store.put_with_key(&arr, &JsValue::from_f64(*block as f64))?;
        }
        await_transaction(&txn).await
    }
}

/// Await an `IdbRequest`, resolving to its `.result` on `success` or rejecting on `error`.
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

/// Await an `IdbTransaction`, resolving on `complete` or rejecting on `error`/`abort`.
async fn await_transaction(txn: &IdbTransaction) -> Result<(), JsValue> {
    let promise = js_sys::Promise::new(&mut |resolve, reject| {
        let oncomplete = Closure::<dyn FnMut(web_sys::Event)>::new(move |_e| {
            let _ = resolve.call0(&JsValue::NULL);
        });
        // E3-T10: surface the transaction's DOMException NAME (esp. QuotaExceededError) so the
        // boundary can classify quota exhaustion vs a generic failure. `txn.error()` holds it on
        // abort; fall back to a generic label.
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
