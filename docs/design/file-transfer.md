# Bounded host/guest file transfer

Status: **accepted for protocol version 1**
Task: E3-T21a
Security boundary: one VM session, one reserved slirp endpoint, two fixed guest directories

## Decision

Use a small guest agent over a **reserved slirp control endpoint**. The endpoint speaks only the
versioned WVFT framing protocol below. It is not a general TCP forwarder; its grammar has no URL,
host path, guest command, MIME handler, or executable callback.

### Alternatives considered

| Mechanism | Advantages | Rejected costs and capabilities |
|---|---|---|
| virtio-9p / virtio-fs | Familiar mounted filesystem; applications need no transfer client | Grants a broad filesystem-shaped capability, adds a large pathname/symlink/cache/coherency attack surface, and virtio-fs assumes host facilities that do not map cleanly to a browser. |
| Sideload block device | Reuses the block stack and is efficient for immutable bulk input | Is naturally one-way, requires image construction and mount lifecycle, makes cancellation and individual-file download awkward, and risks confusing block flush with destination-file durability. |
| Guest agent over slirp | Small bidirectional protocol, streams without whole-file buffering, and reuses the existing browser/native transport boundary | Requires a tiny guest agent and explicit protocol implementation. This is selected because its capability can be narrower than a filesystem or network proxy. |

The guest agent exposes two fixed roots:

- host-to-guest uploads may create basenames only under
  `/var/lib/wasm-vm/transfer/inbox`;
- guest-to-host downloads may read regular files by basename only from
  `/var/lib/wasm-vm/transfer/outbox`.

Neither root is configurable through WVFT. Directories, symlinks, devices, sockets, any source with
`st_nlink != 1`, and path traversal are rejected.

## Transport and protocol constants

WVFT runs on one reliable, ordered byte stream at the reserved virtual endpoint
`10.0.2.2:10021`. The slirp implementation terminates that address internally; it must not turn the
request into a host socket or public listener.

| Name | Version 1 value |
|---|---:|
| `MAGIC` | ASCII `WVFT` |
| `VERSION` | `1` |
| `HEADER_BYTES` | `16` |
| `MAX_FRAME_PAYLOAD` | `65536` bytes |
| `MAX_DATA_BYTES` | `65528` bytes |
| `MAX_TRANSFER_BYTES` | `1073741824` bytes (1 GiB) |
| `MAX_NAME_BYTES` | `255` UTF-8 bytes after NFC normalization |
| `MAX_CONCURRENT_TRANSFERS` | `2` per VM |
| `MAX_IN_FLIGHT_DATA_FRAMES` | `4` per transfer |
| `MAX_CONTROL_PAYLOAD` | `4096` bytes |
| `IDLE_TIMEOUT_SECONDS` | `30` |

The receiver therefore buffers at most four data payloads per transfer: 262112 bytes, plus one
4096-byte control frame and fixed parser/state metadata. Implementations must stream file bytes and
hash incrementally; reading a whole transfer into memory is forbidden.

## Frame envelope

Every integer is unsigned and encoded in network byte order. Every frame has exactly this
16-byte header:

| Offset | Bytes | Field | Rule |
|---:|---:|---|---|
| 0 | 4 | magic | exactly `WVFT` |
| 4 | 1 | version | exactly `1` |
| 5 | 1 | type | one defined type below |
| 6 | 2 | flags | `0`; unknown bits are an error |
| 8 | 4 | stream_id | `0` for HELLO/HELLO_ACK; otherwise nonzero and not reusable on the connection |
| 12 | 4 | payload_len | number of following bytes, at most `MAX_FRAME_PAYLOAD` |

`payload_len` is the sole frame boundary. A parser reads the complete header and must reject any
invalid length before allocation, then reads exactly `payload_len` bytes. EOF in either region is
`TRUNCATED`. Extra bytes are the next frame, never padding. Type-specific payloads have exact
lengths or an explicitly length-prefixed final field; a valid prefix with trailing bytes is
`BAD_FRAME`.

## Frame types and exact payloads

| Type | Code | Payload |
|---|---:|---|
| `HELLO` | 1 | `max_version:u8`, exactly 1 byte |
| `HELLO_ACK` | 2 | `selected_version:u8`, exactly 1 byte |
| `OFFER` | 3 | `direction:u8`, `reserved:u8=0`, `name_len:u16`, `total_len:u64`, `sha256:32`, then exactly `name_len` bytes |
| `ACCEPT` | 4 | `initial_credit:u8`, exactly 1 byte; value 1 through 4 |
| `DATA` | 5 | `offset:u64`, then 1 through 65528 data bytes |
| `ACK` | 6 | `next_offset:u64`, `credit:u8`, exactly 9 bytes; credit 0 through 4 |
| `COMMIT` | 7 | `total_len:u64`, `sha256:32`, exactly 40 bytes |
| `COMPLETE` | 8 | `total_len:u64`, `sha256:32`, exactly 40 bytes |
| `CANCEL` | 9 | `reason:u16`, exactly 2 bytes |
| `ERROR` | 10 | `code:u16`, `message_len:u16`, then exactly `message_len` UTF-8 bytes; total at most 4096 bytes |

HELLO and HELLO_ACK are the only frames with `stream_id=0`; transfer frames with zero or negotiation
frames with nonzero IDs are `BAD_FRAME`. `direction` is `1` for host-to-guest upload and `2` for
guest-to-host download. Unknown codes, directions, versions, reserved values, or lengths terminate
that stream with `ERROR(BAD_FRAME)`. The connection is closed for an invalid envelope because its
next boundary cannot be trusted.

The SHA-256 in `OFFER` is computed by the sender before transfer. The receiver hashes the DATA
stream independently. `DATA.offset` must equal the receiver's next expected offset; overlap, gaps,
replay, integer overflow, data beyond `total_len`, or data beyond `MAX_TRANSFER_BYTES` is
`ERROR(BAD_OFFSET)`. A zero-byte transfer has no DATA frames and proceeds directly to COMMIT.

`ACCEPT.initial_credit` and each `ACK.credit` implement receiver-controlled flow control. The
sender may have no more than four unacknowledged DATA frames and must stop at zero credit. A peer
that exceeds advertised credit receives `ERROR(FLOW_CONTROL)` and the stream becomes terminal.

## Name normalization

The receiver decodes the OFFER name as strict UTF-8 and normalizes it to Unicode NFC before any
filesystem operation. It accepts the name only when all of the following hold:

1. normalized length is 1 through 255 UTF-8 bytes;
2. the normalized value is one basename, is unchanged by taking its platform basename, and is not
   `.` or `..`;
3. it contains no `/`, `\`, NUL, C0/C1 control, bidirectional override/isolate, or Unicode
   noncharacter code point;
4. it does not end in a space or `.`;
5. no existing final name or active normalized name compares equal byte-for-byte.

The receiver returns the normalized name in its local UI. It never silently strips or substitutes
characters. Invalid UTF-8, `/etc/passwd`, `../x`, `a/b`, `a\b`, `.`, `..`, `x<NUL>y`, decomposed
aliases that collide after NFC, and names longer than 255 bytes are `ERROR(BAD_NAME)`.

All opens are relative to a pre-opened inbox or outbox directory descriptor. Implementations use
no-follow/beneath/no-cross-device semantics (`openat2` with `RESOLVE_BENEATH`,
`RESOLVE_NO_SYMLINKS`, and `RESOLVE_NO_XDEV` where available, otherwise component-free basename
checks plus `openat` with `O_NOFOLLOW`) and verify the result is a regular file. For a download,
`fstat` on the already-open descriptor must report `st_nlink == 1` both before and after streaming;
`st_nlink != 1` is `ERROR(BAD_NAME)`. Holding the descriptor prevents path replacement from changing
the object being read, while the second link-count check detects a link added during the transfer.
If an outside name is removed so the outbox name is the inode's only remaining link, the outbox name
is its sole filesystem capability and no out-of-root alias remains. Protocol names are never
concatenated into an absolute path.

## Host-to-guest upload state machine

1. **NEGOTIATE:** exchange HELLO/HELLO_ACK. Any other first frame is `BAD_STATE`.
2. **OFFERED:** the host sends OFFER. The guest validates direction, normalized basename, size,
   quota, concurrency, and collision before allocating file state.
3. **RECEIVING:** after ACCEPT, the guest creates
   `.wvft-<stream_id>.part` in the inbox with exclusive/no-follow semantics. DATA is written at the
   exact next offset, hashed incrementally, and ACKed according to available credit.
4. **COMMITTING:** COMMIT is accepted only when its length and hash equal both OFFER and the
   receiver's observed byte count/hash. The guest flushes file data and metadata, durably writes a
   bounded `.wvft-<stream_id>.commit` record containing the normalized name, length, and hash,
   atomically renames the partial to the normalized final basename without replacement. That rename
   is the **final-name visibility point**: the bytes are already complete and independently
   validated, but the directory entry is not yet claimed durable. The guest then fsyncs the inbox
   directory, removes the commit record, and fsyncs the directory again.
5. **COMPLETE:** only after the directory fsync succeeds does the guest send COMPLETE. A final file
   is never visible with incomplete or unvalidated bytes; transport acknowledgement follows local
   durable promotion.

The receiving guest owns upload durability. `fdatasync`/`fsync`, the durable commit record, atomic
no-replace rename, and parent-directory `fsync` are its responsibility; a sender flush does not
satisfy them. On startup, a commit record plus a matching final file resumes the pending directory
fsync and then proves local completion; a commit record with only a partial remains interrupted;
any mismatch is quarantined and reported as IO. Thus a crash cannot make incomplete or unvalidated
bytes look final.

## Guest-to-host download state machine

1. **NEGOTIATE:** exchange HELLO/HELLO_ACK.
2. **OFFERED:** the guest opens one normalized basename relative to the pre-opened outbox, using
   no-follow semantics, verifies a regular file and the maximum size, computes its SHA-256, and
   sends OFFER.
3. **RECEIVING:** after ACCEPT, the guest streams DATA under receiver credit. The host/browser
   adapter writes to a session-private `.wvft-<stream_id>.part` sink and hashes incrementally.
4. **COMMITTING:** the guest sends COMMIT. The host verifies length/hash, flushes and closes its
   sink, promotes it atomically to a complete session object, and only then sends COMPLETE.
5. **COMPLETE:** the UI may expose/export the download only after COMPLETE. Export to a
   user-selected host file is a separate user gesture; WVFT never receives that host path.

The receiving host adapter owns download durability. In the browser it uses a streaming OPFS
temporary object (or another sink with equivalent bounded streaming and flush/close semantics),
not an in-memory Blob. The guest must not report success merely because it finished sending.

## Cancellation, interruption, and errors

`ERROR` and transport EOF are terminal for the affected stream. CANCEL before final-name visibility
is terminal and idempotent: receiving it twice does not resurrect or reclassify a stream. CANCEL
after final-name visibility is too late to undo validated bytes; the receiver finishes the durable
commit and answers COMPLETE, or answers `ERROR(IO)` if durability fails. Frames after a terminal
state are ignored except that malformed connection framing still closes the connection.

| Event | Upload outcome | Download outcome |
|---|---|---|
| sender or receiver CANCEL before final-name visibility | close the file; retain only `.wvft-<stream_id>.part`, marked partial | close the sink; retain or delete only the session-private `.part`, never expose/export it |
| CANCEL after final-name visibility | finish fsync/recovery and return COMPLETE; on durability failure return `ERROR(IO)` and recover from the commit record | complete local flush/promotion and return COMPLETE; on durability failure return `ERROR(IO)` and keep the object private |
| EOF, timeout, tab kill, or VM stop before final-name visibility | same explicit interrupted partial outcome | same explicit interrupted partial outcome |
| EOF after final-name visibility but before durable promotion | commit record drives startup fsync/finalization or quarantine; the final name contains only validated bytes | host adapter keeps the validated object private and finishes or quarantines it before exposure |
| EOF after durable promotion but before COMPLETE is observed | receiver retains the validated final file; sender reports `COMPLETION_UNKNOWN`, never a false failure or success | receiver retains the validated complete session object; sender reports `COMPLETION_UNKNOWN` |
| length/hash/offset mismatch | ERROR; retain partial for inspection/explicit cleanup | ERROR; retain or delete partial, never expose it |
| quota or I/O failure | ERROR; no final rename | ERROR; no complete session object |
| failure after rename but before directory fsync | startup recovery uses the durable commit record to verify and finalize or quarantine; it never trusts the basename alone | host adapter must not emit COMPLETE; unacknowledged object remains private |

Version 1 does not resume partial transfers. Partials are keyed by connection epoch plus stream ID,
never by an attacker-provided path. A later task may define age-based cleanup, but cleanup must
never rename a partial to a final name. Error messages are bounded safe text and must not contain
absolute paths, auth material, host environment values, or arbitrary underlying exception text.

Stable error codes are: `UNSUPPORTED_VERSION`, `BAD_FRAME`, `BAD_STATE`, `BAD_NAME`,
`BAD_OFFSET`, `TOO_LARGE`, `BUSY`, `QUOTA`, `FLOW_CONTROL`, `HASH_MISMATCH`, `SOURCE_CHANGED`,
`CANCELLED`, `TIMEOUT`, `COMPLETION_UNKNOWN`, and `IO`. Unknown peer error codes are
displayed as `peer error` without interpreting their message.

## Threat model and capability statement

### Capabilities intentionally granted to guest code

Guest code can:

- receive bytes from a file that the user explicitly selected in the current browser session,
  stored under one normalized basename in the fixed guest inbox;
- offer bytes from a regular file already placed in the fixed guest outbox to a bounded,
  session-private browser sink;
- consume at most two concurrent streams, one GiB per stream, four 64-KiB data frames of receiver
  credit, and the configured guest/storage quota;
- cancel its own streams and receive bounded status/error codes.

These capabilities are available to arbitrary code inside the VM. The design does not rely on the
guest keeping a token secret from itself.

### Capabilities not granted

This table is the normative capability policy for version 1. No prose, extension field, error text,
or future-compatible parsing rule may override a `DENY` row.

| Capability input or operation | Version 1 policy |
|---|---|
| URL, DNS name, destination IP, or port | `DENY` |
| host path or host directory enumeration | `DENY` |
| guest path containing a directory component | `DENY` |
| command, shell, eval, dynamic import, or URL handler | `DENY` |
| host listener or public ingress | `DENY` |

- **No arbitrary host fetch:** there is no URL, DNS name, IP address, port, HTTP method, or redirect
  field. The reserved endpoint has no CONNECT or proxy opcode and cannot dial a destination.
- **No arbitrary host filesystem access:** the guest never supplies a host path. Browser file
  selection/export requires a user gesture, and transfer bytes live only in the selected File or a
  session-private OPFS namespace. WVFT cannot enumerate host directories.
- **No arbitrary guest filesystem access from the host:** only normalized basenames under the
  fixed inbox/outbox descriptors exist in the protocol; symlinks, directories, devices, and path
  components are rejected.
- **No eval or command execution:** opcodes are the ten fixed frame types. Names, MIME values, error
  text, and file bytes are data and are never passed to a shell, dynamic import, URL handler, or
  interpreter.
- **No public ingress:** `10.0.2.2:10021` is a VM-private synthetic address terminated inside
  slirp. It creates no host listener and is unreachable from other origins, VMs, or the Internet.
- **No ambient persistence authority:** only the receiving side may durably promote a partial, and
  only after independent length/hash validation. A sender cannot manufacture COMPLETE.

### Abuse controls

The endpoint enforces limits before allocation or open, shares concurrency/quota accounting across
connections for one VM, times out idle streams after 30 seconds, and releases credit, file
descriptors, and parser state on every terminal transition. UI confirmation is required before an
offered guest download is exported. Logs contain stream IDs, directions, byte counts, state, and
stable error codes only—not names, contents, absolute paths, or browser File metadata.

## Required adversarial vectors

An implementation and verifier must cover:

- envelope lengths of 0, 65536, 65537, and `u32::MAX`, including truncated and trailing payloads;
- transfer lengths of 0, 1 GiB, 1 GiB + 1, and `u64::MAX`;
- offset overlap, gap, replay, wraparound, DATA after COMMIT, and more than four frames of credit;
- every hostile name listed in Name normalization plus NFC collisions, symlink replacement, and an
  out-of-root hard-link fixture that must fail the `st_nlink == 1` checks;
- CANCEL/EOF at every state, especially after the last DATA and between rename and directory fsync;
- two concurrent streams reaching ACCEPT and a third `BUSY` response;
- attempts to encode a URL, host path, shell command, unknown opcode, or destination in any field;
- source mutation during download and quota/I/O failure during upload.

Any case that exposes a final/complete-looking file before receiver validation and durable
promotion, buffers the whole transfer, escapes a fixed root/sink, or reaches a network/command
capability refutes version 1.
