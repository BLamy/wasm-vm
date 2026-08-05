//! Poll-driven DNS service seam for the synchronous [`crate::SlirpLocalBackend`].
//!
//! The virtio-net backend cannot `await`, while both production resolvers are asynchronous (native
//! OS lookup and browser DoH `fetch`). A [`DnsService`] accepts bounded, identified DNS messages and
//! later yields their answers from [`DnsService::poll`]. The local backend retains the delivery
//! target (UDP datagram or DNS-over-TCP connection), so the resolver/cache is transport-agnostic and
//! one service instance can answer both paths.

/// Maximum unresolved DNS messages retained by one slirp backend. Once full, the backend returns a
/// prompt SERVFAIL instead of growing memory or allowing a stalled upstream to wedge networking.
pub const MAX_PENDING_DNS: usize = 64;

/// One DNS wire-format query submitted to the asynchronous service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DnsRequest {
    pub id: u64,
    pub message: Vec<u8>,
    /// Monotonic submission time used by the deterministic TTL cache.
    pub now_ms: i64,
}

/// Completion for a previously accepted request. `None` means the query was malformed and should be
/// dropped; resolver failures are encoded as a real SERVFAIL message in `message`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DnsCompletion {
    pub id: u64,
    pub message: Option<Vec<u8>>,
}

/// Asynchronous DNS work presented as a synchronous, poll-driven interface.
pub trait DnsService {
    /// Accept a request, or return it unchanged when the bounded queue is full/unavailable. The
    /// caller turns a rejected well-formed query into an immediate SERVFAIL.
    fn submit(&mut self, request: DnsRequest) -> Result<(), DnsRequest>;

    /// Drain every answer completed since the previous poll.
    fn poll(&mut self) -> Vec<DnsCompletion>;

    /// True while an accepted request or completed-but-undrained answer exists. This participates in
    /// the machine's WFI policy so host I/O gets another run-chunk boundary.
    fn pending(&self) -> bool;
}
