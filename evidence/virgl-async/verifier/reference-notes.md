# Primary reference review

Consulted the [WebGL 2.0 specification](https://registry.khronos.org/webgl/specs/latest/2.0/),
2026-06-30 editor's draft, on 2026-10-03. Section names are stable citation anchors;
this document is a work in progress rather than a frozen normative revision.

- **Sync objects / clientWaitSync:** sync readiness requires returning to the browser
  event loop. Repeated microtasks alone cannot be treated as a readiness guarantee.
  Zero-timeout polling can report timeout until a later task. A wait failure must not
  authorize collection.
- **Buffer Object Binding / Copying Buffers:** initial binding assigns a persistent
  element-array or other-data class. Copying between those classes is invalid. Binding
  a previously undefined buffer to a COPY target assigns the other-data class, so index
  staging needs its element class established first.
- **Buffer objects / getBufferSubData:** this is the CPU collection operation. The
  verifier must associate it with the producer and signaled fence for that allocation.
- **Reading back pixels:** the numeric-offset overload addresses PIXEL_PACK_BUFFER;
  the typed-array overload is a different synchronous destination path.

The independent oracle calls the real WebGL methods. Delay injection only suppresses
readiness reports; it never fabricates a successful GPU signal or supplies result bytes.
