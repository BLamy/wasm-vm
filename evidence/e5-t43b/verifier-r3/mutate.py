"""Round-2 condition-removal mutants (+ round-3 I34: both Listen terms dropped). Usage: mutate.py <local_backend.rs> <mutant-id>.
Each mutant is one exact text replacement; the script fails loudly if the text is absent."""
import sys
IDLE = """        self.egress.is_empty()
            && !NetBackend::external_io_pending(self)
            && self.stack.dns_tcp_state() == Listen
            && (0..FILE_TRANSFER_SLOTS).all(|slot| self.stack.file_tcp_state(slot) == Listen)"""
M = {
 "I1-egress": (IDLE, IDLE.replace("self.egress.is_empty()\n            && ", "")),
 "I2-external_io_pending": (IDLE, IDLE.replace("\n            && !NetBackend::external_io_pending(self)", "")),
 "I3-dns_tcp_listen": (IDLE, IDLE.replace("\n            && self.stack.dns_tcp_state() == Listen", "")),
 "I4-file_tcp_listen_both": (IDLE, IDLE.replace("\n            && (0..FILE_TRANSFER_SLOTS).all(|slot| self.stack.file_tcp_state(slot) == Listen)", "")),
 "I5-file_tcp_slot0_only": (IDLE, IDLE.replace("(0..FILE_TRANSFER_SLOTS)", "(0..1)")),
 "I6-file_tcp_slot1_only": (IDLE, IDLE.replace("(0..FILE_TRANSFER_SLOTS)", "(1..FILE_TRANSFER_SLOTS)")),
 "I34-no_listen_terms": (IDLE, IDLE.replace("\n            && self.stack.dns_tcp_state() == Listen", "").replace("\n            && (0..FILE_TRANSFER_SLOTS).all(|slot| self.stack.file_tcp_state(slot) == Listen)", "")),
 "E1-xio_pending_dns": ("            || !self.pending_dns.is_empty()\n            || self.dns.as_ref()", "            || self.dns.as_ref()"),
 "E2-xio_flows": ("        (self.connector.is_some() && self.manager.flow_count() > 0)\n            || ", "        "),
 "E3-xio_dns_service": ("            || self.dns.as_ref().is_some_and(|dns| dns.pending())\n", ""),
 "E4-xio_file_transfers": ("            || self.file_transfer.active_transfers() > 0\n", ""),
}
path, mid = sys.argv[1], sys.argv[2]
old, new = M[mid]
src = open(path).read()
assert src.count(old) == 1, (mid, src.count(old))
open(path, "w").write(src.replace(old, new))
print("applied", mid)
