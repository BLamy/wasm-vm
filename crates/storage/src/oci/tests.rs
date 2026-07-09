//! E3.5-T01 OCI whiteout applier tests — the adversarial charter: whiteouts, opaque dirs,
//! file⇄dir replacement, and the tar-escape attack surface.
use super::*;
use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

/// Apply a sequence of layers, each `(ordered_raw_paths, entries_by_path)`, to an empty tree.
fn build(layers: Vec<(Vec<&str>, Vec<Entry>)>) -> Tree {
    let mut tree = Tree::new();
    for (raw, entries) in layers {
        let raws: Vec<String> = raw.iter().map(|s| s.to_string()).collect();
        let by_path = entries;
        apply_layer(&mut tree, &raws, |p| {
            let clean = safe_path(p)?;
            Ok(by_path.iter().find(|e| entry_path(e) == clean).cloned())
        })
        .unwrap();
    }
    tree
}

fn entry_path(e: &Entry) -> String {
    match e {
        Entry::File { path, .. }
        | Entry::Dir { path, .. }
        | Entry::Symlink { path, .. }
        | Entry::Hardlink { path, .. } => safe_path(path).unwrap(),
    }
}

fn file(path: &str, data: &[u8]) -> Entry {
    Entry::File {
        path: path.to_string(),
        mode: 0o644,
        data: data.to_vec(),
    }
}
fn dir(path: &str) -> Entry {
    Entry::Dir {
        path: path.to_string(),
        mode: 0o755,
    }
}
fn hardlink(path: &str, target: &str) -> Entry {
    Entry::Hardlink {
        path: path.to_string(),
        target: target.to_string(),
    }
}

#[test]
fn hardlink_survives_whiteout_of_its_target() {
    // layer1: a=v1, b→a ; layer2: whiteout a. `b` must KEEP v1 — correct overlayfs (the link retains
    // the content it was made against). The path-reference model regressed this to a dangling link
    // that aborted the whole unpack (critic MAJOR).
    let t = build(vec![
        (vec!["a", "b"], vec![file("a", b"v1"), hardlink("b", "a")]),
        (vec![".wh.a"], vec![]),
    ]);
    assert!(!t.contains_key("a"), "the target was whiteouted away");
    assert_eq!(
        t.get("b"),
        Some(&Node::File {
            mode: 0o644,
            data: b"v1".to_vec()
        }),
        "the hardlink retains its content — no dangling reference"
    );
}

#[test]
fn hardlink_keeps_old_content_when_target_is_overridden() {
    // layer1: a=v1, b→a ; layer2: a=v2. Correct merged view: a=v2, b=v1 (overlayfs copy-up gives the
    // new `a` a fresh inode; `b` still points at the old content). The path-reference model gave `b`
    // the WRONG (new) content (critic MAJOR).
    let t = build(vec![
        (vec!["a", "b"], vec![file("a", b"v1"), hardlink("b", "a")]),
        (vec!["a"], vec![file("a", b"v2")]),
    ]);
    assert_eq!(
        t.get("a"),
        Some(&Node::File {
            mode: 0o644,
            data: b"v2".to_vec()
        })
    );
    assert_eq!(
        t.get("b"),
        Some(&Node::File {
            mode: 0o644,
            data: b"v1".to_vec()
        }),
        "the hardlink keeps the content it was made against, not the later override"
    );
}

#[test]
fn later_layer_overrides_earlier_file() {
    let t = build(vec![
        (vec!["etc/motd"], vec![file("etc/motd", b"v1")]),
        (vec!["etc/motd"], vec![file("etc/motd", b"v2")]),
    ]);
    assert_eq!(
        t.get("etc/motd"),
        Some(&Node::File {
            mode: 0o644,
            data: b"v2".to_vec()
        })
    );
}

#[test]
fn whiteout_deletes_a_lower_file_and_is_not_materialized() {
    let t = build(vec![
        (
            vec!["etc/keep", "etc/gone"],
            vec![file("etc/keep", b"k"), file("etc/gone", b"g")],
        ),
        // Upper layer whiteouts etc/gone via etc/.wh.gone.
        (vec!["etc/.wh.gone"], vec![]),
    ]);
    assert!(t.contains_key("etc/keep"));
    assert!(
        !t.contains_key("etc/gone"),
        "whiteout removed the lower file"
    );
    assert!(
        !t.contains_key("etc/.wh.gone"),
        "the .wh. marker is never materialized"
    );
}

#[test]
fn whiteout_of_a_directory_removes_the_whole_subtree() {
    let t = build(vec![
        (
            vec!["var/log", "var/log/a", "var/log/sub", "var/log/sub/b"],
            vec![
                dir("var/log"),
                file("var/log/a", b"a"),
                dir("var/log/sub"),
                file("var/log/sub/b", b"b"),
            ],
        ),
        (vec!["var/.wh.log"], vec![]),
    ]);
    assert!(
        t.keys().all(|k| !k.starts_with("var/log")),
        "entire var/log subtree gone: {t:?}"
    );
}

#[test]
fn opaque_directory_drops_lower_contents_but_keeps_this_layers() {
    let t = build(vec![
        (
            vec!["app", "app/old1", "app/old2"],
            vec![dir("app"), file("app/old1", b"1"), file("app/old2", b"2")],
        ),
        // Opaque app + a fresh file: the two lower files vanish, new one stays, app dir stays.
        (
            vec!["app/.wh..wh..opq", "app/new"],
            vec![file("app/new", b"n")],
        ),
    ]);
    assert!(t.contains_key("app"), "the opaque dir itself remains");
    assert!(
        !t.contains_key("app/old1") && !t.contains_key("app/old2"),
        "lower contents dropped"
    );
    assert_eq!(
        t.get("app/new"),
        Some(&Node::File {
            mode: 0o644,
            data: b"n".to_vec()
        })
    );
}

#[test]
fn file_replaces_directory_and_directory_replaces_file() {
    // Lower: a directory `x` with contents. Upper: a plain file `x` — the subtree must vanish.
    let t = build(vec![
        (vec!["x", "x/inner"], vec![dir("x"), file("x/inner", b"i")]),
        (vec!["x"], vec![file("x", b"nowfile")]),
    ]);
    assert_eq!(
        t.get("x"),
        Some(&Node::File {
            mode: 0o644,
            data: b"nowfile".to_vec()
        })
    );
    assert!(
        !t.contains_key("x/inner"),
        "old subtree cleared when a file replaced the dir"
    );

    // The reverse: a file replaced by a directory.
    let t2 = build(vec![
        (vec!["y"], vec![file("y", b"f")]),
        (vec!["y", "y/z"], vec![dir("y"), file("y/z", b"z")]),
    ]);
    assert_eq!(t2.get("y"), Some(&Node::Dir { mode: 0o755 }));
    assert_eq!(
        t2.get("y/z"),
        Some(&Node::File {
            mode: 0o644,
            data: b"z".to_vec()
        })
    );
}

#[test]
fn symlink_and_hardlink_apply() {
    let t = build(vec![(
        vec!["bin/sh", "bin/busybox", "bin/ln"],
        vec![
            file("bin/busybox", b"ELF"),
            Entry::Symlink {
                path: "bin/sh".to_string(),
                target: "busybox".to_string(),
            },
            Entry::Hardlink {
                path: "bin/ln".to_string(),
                target: "bin/busybox".to_string(),
            },
        ],
    )]);
    assert_eq!(
        t.get("bin/sh"),
        Some(&Node::Symlink {
            target: "busybox".to_string()
        })
    );
    // A hardlink resolves to the target's CONTENT at apply time (its own copy of the bytes) — correct
    // overlayfs semantics that survive a later whiteout/override of the target. (Identical bytes are
    // de-duped into real hardlinks at write time; see the cli write_tree test.)
    assert_eq!(
        t.get("bin/ln"),
        Some(&Node::File {
            mode: 0o644,
            data: b"ELF".to_vec()
        })
    );
}

#[test]
fn unsafe_paths_are_rejected() {
    for bad in ["../escape", "/abs", "a/../../b", "a/./b/../..", "..", ""] {
        assert!(
            matches!(safe_path(bad), Err(OciError::UnsafePath(_))),
            "{bad:?} must be rejected"
        );
    }
    for ok in ["a/b/c", "./rel", "trailing/"] {
        assert!(safe_path(ok).is_ok(), "{ok:?} should be accepted");
    }
    // A hostile layer entry with `..` fails the whole apply (no partial escape).
    let mut tree = Tree::new();
    let raws = vec!["../evil".to_string()];
    let r = apply_layer(&mut tree, &raws, |p| Ok(Some(file(p, b"x"))));
    assert!(matches!(r, Err(OciError::UnsafePath(_))));
    assert!(tree.is_empty(), "nothing materialized on an escape attempt");
}

#[test]
fn classify_recognizes_both_whiteout_forms() {
    assert!(
        matches!(classify("a/b/.wh.c").unwrap(), Classified::Delete { target } if target == "a/b/c")
    );
    assert!(
        matches!(classify(".wh.top").unwrap(), Classified::Delete { target } if target == "top")
    );
    assert!(
        matches!(classify("d/.wh..wh..opq").unwrap(), Classified::Opaque { dir } if dir == "d")
    );
    assert!(
        matches!(classify(".wh..wh..opq").unwrap(), Classified::Opaque { dir } if dir.is_empty())
    );
    assert!(matches!(
        classify("normal/file").unwrap(),
        Classified::Ordinary
    ));
}

// ── Critic-adopted (E3.5-T01): CRITICAL escape + MAJOR opaque-ordering, asserting the FIXES ──

/// Critic MAJOR 3a (fixed): an opaque marker AFTER a same-layer file, in hostile tar order, must
/// drop only LOWER-layer contents — the same layer's own file survives.
#[test]
fn opaque_after_same_layer_file_keeps_it() {
    let t = build(vec![
        (
            vec!["app", "app/old"],
            vec![dir("app"), file("app/old", b"o")],
        ),
        (
            vec!["app/new", "app/.wh..wh..opq"],
            vec![file("app/new", b"n")],
        ),
    ]);
    assert!(
        !t.contains_key("app/old"),
        "lower content dropped (correct)"
    );
    assert!(
        t.contains_key("app/new"),
        "same-layer file survives the opaque sweep (fixed)"
    );
}

/// Critic CRITICAL 1a (fixed): a path descending through a symlink ancestor is REJECTED by the
/// applier — the tar symlink-traversal escape seed can never enter the tree.
#[test]
fn descent_through_symlink_ancestor_is_rejected() {
    let mut tree = Tree::new();
    let raws = vec!["evil".to_string(), "evil/passwd".to_string()];
    let entries = alloc::vec![
        Entry::Symlink {
            path: "evil".to_string(),
            target: "/etc".to_string()
        },
        file("evil/passwd", b"x"),
    ];
    let r = apply_layer(&mut tree, &raws, |p| {
        let clean = safe_path(p)?;
        Ok(entries.iter().find(|e| entry_path(e) == clean).cloned())
    });
    assert!(
        matches!(r, Err(OciError::SymlinkTraversal { .. })),
        "got {r:?}"
    );
    // The symlink itself was placed, but nothing UNDER it.
    assert!(matches!(tree.get("evil"), Some(Node::Symlink { .. })));
    assert!(
        !tree.contains_key("evil/passwd"),
        "no path materialized under the symlink"
    );
}
