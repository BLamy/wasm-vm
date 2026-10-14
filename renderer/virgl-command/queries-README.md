# Original boolean queries

The production profile admits original query object9/types1 and11 at index0,
BEGIN19, END20 and GET21. Other query types and private profiles refuse. The
typed occlusion bit exposes these GLES boolean targets; public desktop GL and
numeric/timer/conditional-render/QBO query APIs remain unavailable.

Each virtual subcontext owns at most one active boolean query. Actual raster
draws receive physical WebGL queries, and their native results are ORed. This
keeps a query active across submissions or virtual-context switches without
leaving a physical query active across asynchronous reads, feedback lowering
or another guest's rendering. Empty queries receive an actual empty measurement.
Both targets share the virtual overlap rule. Conservative results preserve
the host's permitted false positives.

Availability is asynchronous. A false result cannot stand in for unavailable.
Only available native GLuint results0/1 can publish DONE1, result_size4 and
an eight-byte result with high-half0. WAIT_HOST2 changes only the state word.
The original16-byte host structure lives at byte0 of a retained CUSTOM131072
buffer; the pinned native renderer ignores create offset and get wait hints.
Original transfer readbacks carry the buffer into guest memory. Publication
checks live resource/context membership and all result/backing extents before
native writes. Detach/unref/reuse cancels a pending old owner. Destruction,
reset and physical loss collect all query names and retained storage.

Native parts share a4096-object ceiling. Results and query state are not inferred
from draw counts, CPU geometry, or an optional numeric-query fallback.
