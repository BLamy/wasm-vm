//! E3.5-T01: OCI layer application with whiteout semantics — the pure core the importer shares
//! between the native CLI and the browser. Given the ordered layers of an OCI image (each a list
//! of [`Entry`] parsed from its tar), fold them into a flattened rootfs [`Tree`], honoring the
//! OCI whiteout conventions:
//!   * `.wh.<name>`  — delete `<name>` (and its subtree) from the layers below.
//!   * `.wh..wh..opq` in a directory — the directory is *opaque*: drop everything the lower
//!     layers put in it, then apply this layer's own entries.
//!
//! This module is `no_std + alloc` (no tar/gzip/std here) so it is unit-tested natively and can
//! run in wasm; the CLI/browser feed it entries after decompressing + parsing the layer tars.
//!
//! **Path safety is enforced here** (the tar-escape attack surface): a component of `..`, an
//! absolute path, or an empty path is rejected — a hostile layer can never materialize a file
//! outside the root.

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;

/// The OCI whiteout marker prefix and the opaque-directory marker (spec §whiteouts).
pub const WHITEOUT_PREFIX: &str = ".wh.";
pub const OPAQUE_MARKER: &str = ".wh..wh..opq";

/// One entry from a layer's tar, already classified. `path` is the tar member path (the CLI
/// strips a leading `./`). Whiteouts are recognized by the caller OR here via [`classify`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    File {
        path: String,
        mode: u32,
        data: Vec<u8>,
    },
    Dir {
        path: String,
        mode: u32,
    },
    Symlink {
        path: String,
        target: String,
    },
    /// Hardlink to an already-applied path (tar `LinkType`). Preserved as a link to the target file
    /// (not copied), so hardlink-heavy images (busybox) don't explode in size.
    Hardlink {
        path: String,
        target: String,
    },
}

/// A node in the flattened rootfs tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    File {
        mode: u32,
        data: Vec<u8>,
    },
    Dir {
        mode: u32,
    },
    Symlink {
        target: String,
    },
    /// A hardlink to another path's file content — preserved as a link (NOT a copy) so images that
    /// hardlink heavily (busybox: ~400 applets → one binary) stay their real size instead of
    /// exploding ~400×. `target` is the ultimate FILE path (hardlink chains are collapsed at apply).
    Hardlink {
        target: String,
    },
}

/// The flattened rootfs: a path → node map (paths are normalized, no leading slash, `/`-separated).
pub type Tree = BTreeMap<String, Node>;

/// Why a layer entry was rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OciError {
    /// A path component is `..`, the path is absolute, or empty — a containment-escape attempt.
    UnsafePath(String),
    /// A hardlink names a target that hasn't been applied yet.
    DanglingHardlink { path: String, target: String },
    /// An entry's path descends through a SYMLINK ancestor already in the tree — the classic
    /// tar symlink-traversal escape (a layer creates `evil -> /etc` then `evil/passwd`). Rejected
    /// so the writer can never follow the symlink out of the root (critic CRITICAL).
    SymlinkTraversal { path: String, via: String },
}

/// Normalize + safety-check a tar path: strip a leading `./`, reject absolute paths, empty paths,
/// and any `..`/`.` component. Returns the clean `a/b/c` form.
pub fn safe_path(raw: &str) -> Result<String, OciError> {
    let p = raw.strip_prefix("./").unwrap_or(raw);
    let p = p.strip_suffix('/').unwrap_or(p);
    if p.is_empty() || p.starts_with('/') {
        return Err(OciError::UnsafePath(String::from(raw)));
    }
    for comp in p.split('/') {
        if comp.is_empty() || comp == ".." || comp == "." {
            return Err(OciError::UnsafePath(String::from(raw)));
        }
    }
    Ok(String::from(p))
}

/// Split a normalized path into `(parent_dir, basename)`. `"a/b/c" → ("a/b", "c")`;
/// `"c" → ("", "c")`.
fn split_parent(path: &str) -> (&str, &str) {
    match path.rfind('/') {
        Some(i) => (&path[..i], &path[i + 1..]),
        None => ("", path),
    }
}

/// Whether `path` is `dir` itself or lies underneath it (`dir/…`). `dir == ""` matches everything.
fn under(path: &str, dir: &str) -> bool {
    if dir.is_empty() {
        return true;
    }
    path == dir
        || (path.len() > dir.len() && path.starts_with(dir) && path.as_bytes()[dir.len()] == b'/')
}

/// Classify a raw tar member path into an ordinary path or a whiteout. Returns:
///   * `Ok(None)` — an ordinary entry at the (safe) returned path? No: see the two whiteout forms.
///
/// The two whiteout shapes, given a member `dir/name`:
///   * `name == ".wh..wh..opq"` → opaque whiteout of `dir`.
///   * `name` starts with `.wh.` → delete `dir/<name-without-prefix>`.
pub enum Classified {
    Ordinary,
    Opaque { dir: String },
    Delete { target: String },
}

pub fn classify(raw: &str) -> Result<Classified, OciError> {
    let path = safe_path(raw)?;
    let (parent, name) = split_parent(&path);
    if name == OPAQUE_MARKER {
        return Ok(Classified::Opaque {
            dir: String::from(parent),
        });
    }
    if let Some(base) = name.strip_prefix(WHITEOUT_PREFIX) {
        let target = if parent.is_empty() {
            String::from(base)
        } else {
            let mut t = String::from(parent);
            t.push('/');
            t.push_str(base);
            t
        };
        return Ok(Classified::Delete { target });
    }
    Ok(Classified::Ordinary)
}

/// The first ANCESTOR of `path` that is a symlink node in the tree, if any. A path may only
/// descend through real directories — descending through a symlink is a containment escape.
fn symlinked_ancestor(tree: &Tree, path: &str) -> Option<String> {
    let mut acc = String::new();
    for comp in path.split('/') {
        if acc.is_empty() {
            acc.push_str(comp);
        } else {
            acc.push('/');
            acc.push_str(comp);
        }
        if acc == path {
            break; // the leaf itself may legitimately BE a symlink; only ancestors matter
        }
        if matches!(tree.get(&acc), Some(Node::Symlink { .. })) {
            return Some(acc);
        }
    }
    None
}

/// Remove `target` and its entire subtree from the tree.
fn remove_subtree(tree: &mut Tree, target: &str) {
    let victims: Vec<String> = tree.keys().filter(|k| under(k, target)).cloned().collect();
    for k in victims {
        tree.remove(&k);
    }
}

/// Apply one already-*classified* layer to `tree`, in tar order. `raw_entries` is the layer's tar
/// members in order; `resolve` maps ordinary members to [`Entry`]s (the CLI does the tar reading).
/// Whiteouts are re-derived here from the raw path so the pure logic owns the semantics.
///
/// Order within a layer (matches overlayfs / `containerd`): each member is processed in sequence —
/// an opaque marker clears the lower layers' contents of its directory *at that point*, a delete
/// whiteout removes its target, and an ordinary entry inserts/replaces. A file replacing a
/// directory (or vice-versa) drops the old subtree first.
pub fn apply_layer<F>(tree: &mut Tree, raw_paths: &[String], mut resolve: F) -> Result<(), OciError>
where
    F: FnMut(&str) -> Result<Option<Entry>, OciError>,
{
    // Keys THIS layer adds — an opaque marker must only wipe LOWER-layer contents, never a file
    // this same layer already placed in the opaque dir (critic MAJOR: hostile tar order).
    let mut added: alloc::collections::BTreeSet<String> = alloc::collections::BTreeSet::new();
    for raw in raw_paths {
        match classify(raw)? {
            Classified::Opaque { dir } => {
                let victims: Vec<String> = tree
                    .keys()
                    .filter(|k| k.as_str() != dir && under(k, &dir) && !added.contains(*k))
                    .cloned()
                    .collect();
                for k in victims {
                    tree.remove(&k);
                }
            }
            Classified::Delete { target } => remove_subtree(tree, &target),
            Classified::Ordinary => {
                let Some(entry) = resolve(raw)? else { continue };
                let key = insert_entry(tree, entry)?;
                added.insert(key);
            }
        }
    }
    Ok(())
}

fn insert_entry(tree: &mut Tree, entry: Entry) -> Result<String, OciError> {
    // CRITICAL (critic 1a): no entry may descend through a symlink ancestor already in the tree
    // — that is the tar symlink-traversal escape. Checked for every path before insertion.
    let raw = match &entry {
        Entry::File { path, .. }
        | Entry::Dir { path, .. }
        | Entry::Symlink { path, .. }
        | Entry::Hardlink { path, .. } => safe_path(path)?,
    };
    if let Some(via) = symlinked_ancestor(tree, &raw) {
        return Err(OciError::SymlinkTraversal { path: raw, via });
    }
    match entry {
        Entry::Dir { path, mode } => {
            let path = safe_path(&path)?;
            // A dir replacing a file: just overwrite the node (no subtree to clear for a file).
            tree.insert(path.clone(), Node::Dir { mode });
            Ok(path)
        }
        Entry::File { path, mode, data } => {
            let path = safe_path(&path)?;
            // A file replacing a directory: drop the old subtree first.
            if matches!(tree.get(&path), Some(Node::Dir { .. })) {
                remove_subtree(tree, &path);
            }
            tree.insert(path.clone(), Node::File { mode, data });
            Ok(path)
        }
        Entry::Symlink { path, target } => {
            let path = safe_path(&path)?;
            if matches!(tree.get(&path), Some(Node::Dir { .. })) {
                remove_subtree(tree, &path);
            }
            tree.insert(path.clone(), Node::Symlink { target });
            Ok(path)
        }
        Entry::Hardlink { path, target } => {
            let path = safe_path(&path)?;
            let target = safe_path(&target)?;
            // The target must already be applied. Preserve the hardlink as a LINK to the ultimate
            // file (collapsing any hardlink chain) rather than copying its bytes — otherwise busybox's
            // ~400 applet hardlinks each become a full 1 MiB copy (~400 MiB bundle). A hardlink to a
            // symlink/dir (rare) falls back to cloning the node (no bloat concern).
            let node = match tree.get(&target) {
                Some(Node::File { .. }) => Node::Hardlink {
                    target: target.clone(),
                },
                Some(Node::Hardlink { target: ultimate }) => Node::Hardlink {
                    target: ultimate.clone(),
                },
                Some(other) => other.clone(),
                None => {
                    return Err(OciError::DanglingHardlink { path, target });
                }
            };
            tree.insert(path.clone(), node);
            Ok(path)
        }
    }
}

#[cfg(test)]
mod tests;
