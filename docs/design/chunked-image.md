# Chunked disk-image format (E3-T01)

The base layer for Epic 3's lazy streaming, caching, and copy-on-write. A disk image is cut into
fixed-size chunks described by a hashed JSON manifest, so the browser can fetch and verify only the
blocks the guest touches instead of downloading a 400+ MB image up front. The core reader is
`crates/storage` (`ImageManifest`, `ChunkIndex`) — pure types + math + SHA-256, `no_std`, no
browser deps. The dev-grade splitter is `tools/chunk_image.py`.

## Manifest (JSON) — field-for-field with `ImageManifest`

```json
{
  "version": 1,
  "image_len": 17724416,
  "chunk_size": 131072,
  "layout": "split",
  "chunks": ["<sha256-hex chunk 0>", "<sha256-hex chunk 1>", "..."]
}
```

| field | type (`ImageManifest`) | meaning |
|---|---|---|
| `version` | `u32` | format version. Must equal `FORMAT_VERSION` (**1**); an unknown version is a hard error. |
| `image_len` | `u64` | total image length in bytes. |
| `chunk_size` | `u32` | fixed chunk size in bytes; a **power of two**. Every chunk is this size except the last. |
| `layout` | `Layout` (`"split"` \| `"blob"`) | how chunk bytes are stored (below). |
| `chunks` | `Vec<String>` | ordered lowercase-hex SHA-256 of each chunk. `chunks.len()` **must** equal `ceil(image_len / chunk_size)`. |

**Forward-compatibility:** unknown *fields* are ignored (a newer producer may add keys), so old
readers keep working across additive changes. An incompatible change bumps `version`; readers reject
a version they do not implement. (The reader uses serde's default "ignore unknown fields" — it does
**not** set `deny_unknown_fields`.)

## Chunking math (`ChunkIndex`)

- `chunk_count = ceil(image_len / chunk_size)` (0 for a 0-byte image).
- Byte `offset` lives in `(chunk = offset / chunk_size, intra = offset % chunk_size)`;
  `offset >= image_len` is an error (`OffsetOutOfRange`) — this covers every offset of a 0-byte image.
- `chunk_len(c) = chunk_size` for all but the last chunk; the last (**tail**) chunk is
  `image_len - (chunk_count-1) * chunk_size` — which is a *full* `chunk_size` when `image_len` is an
  exact multiple, and short otherwise.

### Worked example
`image_len = 10`, `chunk_size = 4` → `chunk_count = 3`, chunk lengths `[4, 4, 2]`.
Offset `9` → chunk `2`, intra `1` (the tail chunk's second byte). Offset `10` → `OffsetOutOfRange`.

## Layouts
- **`split`** — one immutable, content-addressed file per chunk: `chunks/{sha256}.bin`. Identical
  chunks dedupe for free; CDN/browser-cache friendly; no server-side Range needed. This is the
  default (`tools/chunk_image.py split`).
- **`blob`** — the chunks are contiguous in a single file, addressed by HTTP `Range:
  bytes=chunk*chunk_size-(chunk*chunk_size + chunk_len - 1)`. One artifact, needs a Range-capable
  server (T02). Both layouts share the same manifest and the same `chunk_size`/hash semantics.

## Chunk size — why 128 KiB
Start at **128 KiB** (`131072`, a power of two). It balances: request count / HTTP+cache overhead
(smaller chunks = more requests), read amplification (a guest 4 KiB read pulls a whole chunk;
bigger chunks waste more), and manifest size (`image_len / chunk_size` hashes × 64 hex bytes — a
512 MB image at 128 KiB is ~4096 chunks ≈ 256 KiB of manifest). It is **declared in the manifest**,
so it can be retuned per image without a format change — but measure (T03/T07 cache + backend
benchmarks) before changing the default.

## Integrity
Every chunk is verified before use: `ImageManifest::verify_chunk(i, bytes)` checks the byte length
(rejects a truncated / over-long chunk) then the SHA-256 against `chunks[i]`. A flipped byte →
`HashMismatch`; a short chunk → `TruncatedChunk` — always a typed error, never a panic. The manifest
itself is validated on parse (`from_json`): version, power-of-two chunk size, `chunks.len()` vs the
derived count, and 64-hex-char hashes.

## Verification
- `tools/chunk_image.py split IMAGE --out DIR` then `... verify DIR/manifest.json --image IMAGE`
  reassembles the chunks and confirms the whole-image SHA-256 round-trips (byte-identical). Verified
  on the 17 MB kernel `Image` (136 chunks) and applies identically to the Alpine rootfs.
- `crates/storage` unit tests + a proptest cover the offset math (offset 0, last byte, exact
  multiple, single-chunk, 1-byte, 0-byte), hostile manifest edits (wrong version, bad chunk size,
  wrong chunk count, malformed hex), and corruption (flipped byte, truncated chunk).
