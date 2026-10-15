# Omarchy application inventory

`catalog.json` accounts for every one of the 147 entries in the installed
Omarchy 4.0.2 release's upstream base list, plus the requested Node.js/npm tools.
Chromium and LibreOffice are required priority applications. The image builder
does not consume this discovery catalogue; it is not an installation manifest.

The existing image has 32 base entries. Another 97 have native RISC-V or
architecture-independent repository candidates (99 including Node.js/npm).
`nvim` maps to `neovim`, and `mise-bin` maps to the native `mise` package.
The existing Nerd Font package remains accounted for even though it is absent
from the captured public repositories. Repository precedence is core, extra,
unsupported, matching pacman's first-repository rule. An unrelated all-NUL `ntk`
record is retained as an explicit discovery failure; it supplies no candidate.

Five other entries have portable data/script recipes: the Neovim configuration,
Ruby `tobi-try`, iA Writer fonts, `ufw-docker`, and Yaru icons. Their sources and
runtime dependencies still need authentication and installation. Thirteen entries
require a source-port investigation: aether, asdcontrol, cliamp, herdr,
hyprland-preview-share-picker, localsend, omacalc, omacut, omawrite, pinta, ttfx,
tensaku, and tzupdate. Their pinned recipes currently declare x86/ARM targets.
That declaration is not proof of RISC-V incompatibility. In particular, portable
Go/Rust/C sources need separate build attempts, while LocalSend's Flutter and
Pinta's .NET runtimes need architecture validation. None is silently removed or
labelled incompatible. The upstream vendor server's HTTP 403 responses likewise
do not establish architecture support or incompatibility.

The exact upstream list, complete captured repository databases, package recipe
text, archive fetch hashes, `.PKGINFO`/`.BUILDINFO`, and the first 64 bytes of the
priority native executables are retained under `evidence/omarchy-app-catalog`.
Recipes are inert source material and are never executed by this checker. These
are discovery inputs, not trusted package signing keys. The executable headers
identify ELF64 little-endian RISC-V (machine 243). They do not prove a successful
launch. Detached signatures are downloaded but not yet authenticated here.

Run the portable inventory check:

```sh
python3 tools/image/check-omarchy-app-catalog.py
```

To also hash and reopen the downloaded priority archives, re-read `.PKGINFO`,
and compare the actual executable headers:

```sh
python3 tools/image/check-omarchy-app-catalog.py --archives target/omarchy-full/packages
```

Signed dependency-closed installation, normal desktop integration, actual app
execution, and a freshly published GPU/software warm release are separate ordered
tasks E5.5-T05b, E5.5-T05c, and E5.5-T05d. An unavailable prebuilt package or its
download size alone is never an exclusion criterion.
