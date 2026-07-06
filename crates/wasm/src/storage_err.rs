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
        // Only signals that specifically mean "the origin ran out of storage" and are recoverable
        // by freeing space. Deliberately NOT "maximum size" — Chrome's oversized-VALUE error
        // ("serialized value is too large … maximum size is …") is a deterministic per-value limit
        // (DataCloneError family), which freeing space cannot fix (critic false-positive).
        let quota = s.contains("QuotaExceeded")           // QuotaExceededError (all modern engines)
            || s.contains("QUOTA_EXCEEDED")               // legacy WebKit constant QUOTA_EXCEEDED_ERR
            || s.contains("QUOTA_REACHED")                // Firefox NS_ERROR_DOM_QUOTA_REACHED
            || s.contains("kQuota")                       // Chromium internal spelling
            || s.to_ascii_lowercase().contains("not enough space"); // bare-message fallback
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
            "QUOTA_EXCEEDED_ERR: DOM Exception 22",
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

#[cfg(test)]
mod critic_e3t10_hostile {
    use super::*;

    /// CRITIC HOSTILE (claim 2, miss): legacy WebKit spelled the quota DOMException as
    /// "QUOTA_EXCEEDED_ERR: DOM Exception 22" (the constant name + numeric code 22, no
    /// "QuotaExceededError" camel-case anywhere). classify() misses it.
    #[test]
    fn legacy_webkit_quota_spelling_is_missed() {
        assert_eq!(
            StorageError::classify("QUOTA_EXCEEDED_ERR: DOM Exception 22"),
            StorageError::QuotaExceeded,
            "legacy WebKit quota spelling should classify as quota"
        );
    }

    /// CRITIC HOSTILE (claim 2, false positive): Chrome's oversized-value error — "The
    /// serialized value is too large (size=x bytes, maximum size is y bytes)." — is a
    /// DETERMINISTIC per-value limit (DataCloneError-family), not quota. classify() calls it
    /// quota via the "maximum size" substring, so "free space & retry" would loop forever
    /// (freeing space cannot fix an oversized value). Unreachable for 4 KiB blocks today, but
    /// the classifier is generic and the shipped test SUITE endorses the misclassification.
    #[test]
    fn oversized_value_error_is_not_quota() {
        assert_eq!(
            StorageError::classify(
                "The serialized value is too large (size=339 bytes, maximum size is 255 bytes)."
            ),
            StorageError::Other,
            "a per-value size limit is deterministic, not recoverable by freeing space"
        );
    }
}
