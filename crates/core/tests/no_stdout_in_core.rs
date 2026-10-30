//! Audit production modules. Recorded test output is permitted inside test-only code.
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use syn::visit::Visit;

fn required_test(meta: &syn::Meta) -> bool {
    match meta {
        syn::Meta::Path(path) => path.is_ident("test"),
        syn::Meta::List(list) if list.path.is_ident("all") || list.path.is_ident("any") => {
            use syn::parse::Parser;
            let values = syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated
                .parse2(list.tokens.clone())
                .unwrap();
            if list.path.is_ident("all") {
                values.iter().any(required_test)
            } else {
                !values.is_empty() && values.iter().all(required_test)
            }
        }
        _ => false,
    }
}
fn test_only(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|a| {
        a.path().is_ident("test")
            || a.path().is_ident("cfg")
                && a.parse_args::<syn::Meta>().is_ok_and(|m| required_test(&m))
    })
}
fn stdout_macro(tokens: proc_macro2::TokenStream) -> bool {
    let mut prior = false;
    for token in tokens {
        match token {
            proc_macro2::TokenTree::Group(group) => {
                if stdout_macro(group.stream()) {
                    return true;
                }
                prior = false;
            }
            proc_macro2::TokenTree::Ident(name) => {
                prior = ["print", "println", "eprint", "eprintln"]
                    .iter()
                    .any(|n| name == n)
            }
            proc_macro2::TokenTree::Punct(p) if p.as_char() == '!' && prior => return true,
            _ => prior = false,
        }
    }
    false
}
fn nondeterministic_tokens(tokens: proc_macro2::TokenStream) -> bool {
    tokens.into_iter().any(|token| match token {
        proc_macro2::TokenTree::Group(group) => nondeterministic_tokens(group.stream()),
        proc_macro2::TokenTree::Ident(name) => [
            "HashMap",
            "HashSet",
            "SystemTime",
            "Instant",
            "thread_rng",
            "rand",
        ]
        .iter()
        .any(|n| name == n),
        _ => false,
    })
}
struct Audit {
    file: PathBuf,
    directory: PathBuf,
    seen: BTreeSet<PathBuf>,
    offenders: BTreeSet<String>,
}
impl Audit {
    fn file(&mut self, file: PathBuf, directory: PathBuf) {
        if !self.seen.insert(file.clone()) {
            return;
        }
        let parsed = syn::parse_file(
            &std::fs::read_to_string(&file)
                .unwrap_or_else(|error| panic!("audit source {}: {error}", file.display())),
        )
        .unwrap();
        let old_file = std::mem::replace(&mut self.file, file);
        let old_directory = std::mem::replace(&mut self.directory, directory);
        self.visit_file(&parsed);
        self.file = old_file;
        self.directory = old_directory;
    }
}
impl<'ast> Visit<'ast> for Audit {
    fn visit_path(&mut self, path: &'ast syn::Path) {
        let parts = path
            .segments
            .iter()
            .map(|s| s.ident.to_string())
            .collect::<Vec<_>>();
        if parts.iter().any(|p| {
            [
                "HashMap",
                "HashSet",
                "SystemTime",
                "Instant",
                "thread_rng",
                "rand",
            ]
            .contains(&p.as_str())
        }) || parts.windows(2).any(|p| p == ["std", "time"])
        {
            self.offenders.insert(format!(
                "{}: nondeterministic path {}",
                self.file.display(),
                parts.join("::")
            ));
        }
        syn::visit::visit_path(self, path);
    }
    fn visit_item_fn(&mut self, item: &'ast syn::ItemFn) {
        if !test_only(&item.attrs) {
            syn::visit::visit_item_fn(self, item);
        }
    }
    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        if !test_only(&item.attrs) {
            syn::visit::visit_item_impl(self, item);
        }
    }
    fn visit_item_mod(&mut self, item: &'ast syn::ItemMod) {
        if test_only(&item.attrs) {
            return;
        }
        let directory = self.directory.join(item.ident.to_string());
        if let Some((_, items)) = &item.content {
            let old = std::mem::replace(&mut self.directory, directory);
            for item in items {
                self.visit_item(item);
            }
            self.directory = old;
        } else {
            let explicit = item.attrs.iter().find_map(|a| {
                if a.path().is_ident("path")
                    && let syn::Meta::NameValue(v) = &a.meta
                    && let syn::Expr::Lit(v) = &v.value
                    && let syn::Lit::Str(s) = &v.lit
                {
                    Some(s.value())
                } else {
                    None
                }
            });
            let file = explicit
                .map(|p| {
                    // An external module's #[path] is relative to its source file, while an
                    // inline module can have a nested module directory.
                    let beside_source = self.file.parent().unwrap().join(&p);
                    if beside_source.exists() {
                        beside_source
                    } else {
                        self.directory.join(p)
                    }
                })
                .unwrap_or_else(|| {
                    let flat = self.directory.join(format!("{}.rs", item.ident));
                    if flat.exists() {
                        flat
                    } else {
                        directory.join("mod.rs")
                    }
                });
            self.file(file, directory);
        }
    }
    fn visit_macro(&mut self, item: &'ast syn::Macro) {
        let name = item.path.segments.last().unwrap().ident.to_string();
        if nondeterministic_tokens(item.tokens.clone()) {
            self.offenders.insert(format!(
                "{}: nondeterministic macro {name}!",
                self.file.display()
            ));
        }
        if ["print", "println", "eprint", "eprintln"].contains(&name.as_str())
            || stdout_macro(item.tokens.clone())
        {
            self.offenders
                .insert(format!("{}: {name}!", self.file.display()));
        }
        if name == "include"
            && let Ok(file) = syn::parse2::<syn::LitStr>(item.tokens.clone())
        {
            self.file(
                self.file.parent().unwrap().join(file.value()),
                self.directory.clone(),
            );
        }
    }
}
#[test]
fn core_has_no_stdout_macros() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut audit = Audit {
        file: PathBuf::new(),
        directory: source.clone(),
        seen: BTreeSet::new(),
        offenders: BTreeSet::new(),
    };
    audit.file(source.join("lib.rs"), source);
    assert!(
        audit.offenders.is_empty(),
        "Production core must use log: {:?}",
        audit.offenders
    );
}
#[test]
fn test_output_does_not_hide_a_later_runtime_macro() {
    let file = syn::parse_file("#[cfg(test)] mod tests { fn report() { eprintln!(\"record\"); } } fn runtime() { println!(\"bad\"); }").unwrap();
    let mut audit = Audit {
        file: PathBuf::from("fixture.rs"),
        directory: PathBuf::new(),
        seen: BTreeSet::new(),
        offenders: BTreeSet::new(),
    };
    audit.visit_file(&file);
    assert_eq!(
        audit.offenders,
        BTreeSet::from(["fixture.rs: println!".to_owned()])
    );
}
#[test]
fn test_only_clock_does_not_hide_a_runtime_or_macro_clock() {
    let file = syn::parse_file("#[cfg(test)] mod test { fn clock() { std::time::Instant::now(); } } #[cfg(any(test, feature=\"runtime\"))] mod enabled { fn clock() { std::time::Instant::now(); clock_macro!(std::time::Instant); } }").unwrap();
    let mut audit = Audit {
        file: PathBuf::from("fixture.rs"),
        directory: PathBuf::new(),
        seen: BTreeSet::new(),
        offenders: BTreeSet::new(),
    };
    audit.visit_file(&file);
    assert_eq!(
        audit.offenders,
        BTreeSet::from([
            "fixture.rs: nondeterministic path std::time::Instant::now".to_owned(),
            "fixture.rs: nondeterministic macro clock_macro!".to_owned()
        ])
    );
}
