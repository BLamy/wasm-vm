//! E3-T10: classify an IndexedDB/OPFS write failure so the boundary can react correctly.
//!
//! A `QuotaExceededError` (the origin ran out of storage) is fundamentally different from any
//! other transaction failure: the dirty blocks are NOT lost — they stay pending in the
//! `PersistQueue` (we never `mark_persisted` on failure), so freeing space and retrying, or
//! flipping the disk read-only, keeps the filesystem consistent. This module is pure string
//! classification with no `web-sys`, so it is unit-tested natively.

/// The kind of a durable-store write failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageError {
    /// The origin's storage quota is exhausted (`QuotaExceededError`, or a Chrome/Firefox
    /// variant). Recoverable: free space or continue read-only; the pending writes are intact.
    QuotaExceeded,
    /// Any other durable-store failure (corruption, transaction abort, backend I/O).
    Other,
}

impl StorageError {
    /// Classify from a DOMException `.name` (or a message that embeds it). Quota exhaustion
    /// surfaces as `QuotaExceededError` on all engines; some also use the legacy numeric code 22
    /// or an `NS_ERROR_DOM_QUOTA_REACHED` (Firefox) / `kQuotaExceeded` spelling.
    pub fn classify(name_or_message: &str) -> StorageError {
        let s = name_or_message;
        let quota = s.contains("QuotaExceeded")
            || s.contains("QUOTA_REACHED")
            || s.contains("QuotaExceededError")
            || s.contains("kQuota")
            // Firefox worker IDB sometimes reports the bare message:
            || s.to_ascii_lowercase().contains("not enough space")
            || s.to_ascii_lowercase().contains("maximum size");
        if quota {
            StorageError::QuotaExceeded
        } else {
            StorageError::Other
        }
    }

    pub fn is_quota(self) -> bool {
        matches!(self, StorageError::QuotaExceeded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quota_names_across_engines_classify_as_quota() {
        for n in [
            "QuotaExceededError",
            "QuotaExceededError: The current transaction exceeded its quota limitations.",
            "NS_ERROR_DOM_QUOTA_REACHED",
            "kQuotaExceededError",
            "The serialized value is too large (maximum size...).",
            "There is not enough space to complete the operation.",
        ] {
            assert_eq!(
                StorageError::classify(n),
                StorageError::QuotaExceeded,
                "{n:?} should classify as quota"
            );
        }
    }

    #[test]
    fn other_failures_are_not_quota() {
        for n in [
            "IndexedDB transaction failed",
            "AbortError",
            "UnknownError: internal error",
            "InvalidStateError",
            "",
        ] {
            assert_eq!(
                StorageError::classify(n),
                StorageError::Other,
                "{n:?} should NOT classify as quota"
            );
            assert!(!StorageError::classify(n).is_quota());
        }
    }
}
