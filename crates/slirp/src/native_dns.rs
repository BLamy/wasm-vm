//! Native poll-driven DNS service: a bounded Tokio worker owns one [`crate::DnsForwarder`] backed by
//! [`crate::NativeResolver`]. The slirp driver remains responsive while OS resolution is in flight,
//! and the forwarder's TTL cache is shared by UDP and DNS-over-TCP requests.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::dns_service::{DnsCompletion, DnsRequest, DnsService, MAX_PENDING_DNS};
use crate::{DnsForwarder, NativeResolver};

const DNS_CACHE_ENTRIES: usize = 256;

pub struct NativeDnsService {
    requests: tokio::sync::mpsc::Sender<DnsRequest>,
    completions: tokio::sync::mpsc::UnboundedReceiver<DnsCompletion>,
    pending: Arc<AtomicUsize>,
}

impl NativeDnsService {
    /// Spawn the resolver worker on the current Tokio runtime.
    pub fn new() -> Self {
        let (request_tx, mut request_rx) =
            tokio::sync::mpsc::channel::<DnsRequest>(MAX_PENDING_DNS);
        let (completion_tx, completion_rx) = tokio::sync::mpsc::unbounded_channel();
        let pending = Arc::new(AtomicUsize::new(0));
        tokio::spawn(async move {
            let mut forwarder = DnsForwarder::new(NativeResolver::new(), DNS_CACHE_ENTRIES);
            while let Some(request) = request_rx.recv().await {
                let message = forwarder.handle(&request.message, request.now_ms).await;
                if completion_tx
                    .send(DnsCompletion {
                        id: request.id,
                        message,
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        Self {
            requests: request_tx,
            completions: completion_rx,
            pending,
        }
    }
}

impl Default for NativeDnsService {
    fn default() -> Self {
        Self::new()
    }
}

impl DnsService for NativeDnsService {
    fn submit(&mut self, request: DnsRequest) -> Result<(), DnsRequest> {
        self.pending.fetch_add(1, Ordering::Relaxed);
        match self.requests.try_send(request) {
            Ok(()) => Ok(()),
            Err(error) => {
                self.pending.fetch_sub(1, Ordering::Relaxed);
                Err(error.into_inner())
            }
        }
    }

    fn poll(&mut self) -> Vec<DnsCompletion> {
        let mut out = Vec::new();
        while let Ok(completion) = self.completions.try_recv() {
            self.pending.fetch_sub(1, Ordering::Relaxed);
            out.push(completion);
        }
        out
    }

    fn pending(&self) -> bool {
        self.pending.load(Ordering::Relaxed) != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dns::{TYPE_A, build_query, parse_response};
    use std::time::Duration;

    #[tokio::test]
    async fn resolves_localhost_without_blocking_the_submitter() {
        let mut service = NativeDnsService::new();
        service
            .submit(DnsRequest {
                id: 7,
                message: build_query(0x1234, "localhost", TYPE_A),
                now_ms: 0,
            })
            .unwrap();
        assert!(service.pending());

        let completion = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(answer) = service.poll().pop() {
                    break answer;
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .expect("native DNS worker must complete");

        assert_eq!(completion.id, 7);
        let parsed = parse_response(completion.message.as_deref().unwrap()).unwrap();
        assert!(parsed.a_records.iter().any(|(ip, _)| ip.is_loopback()));
        assert!(!service.pending());
    }
}
