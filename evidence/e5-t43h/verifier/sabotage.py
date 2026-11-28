import sys
p='crates/core/src/lib.rs'; s=open('../lib.rs.orig').read()
k=sys.argv[1]
R={
'S1':("if !self.external_wake_io_pending_for_idle_jump() {\n            self.wfi_fast_forward();","if !self.external_wake_io_pending() {\n            self.wfi_fast_forward();"),
'S2':("self.fabric_host_io_epoch == Some(self.fabric_epoch.get())\n            && self.fresh_mip()","false && self.fabric_host_io_epoch == Some(self.fabric_epoch.get())\n            && self.fresh_mip()"),
'S3':("nanos.min(HOST_IO_IDLE_NAP_NANOS)","nanos"),
'S4':("let limited = pacer.limit_deadline_after(clock.now_nanos(), mtime, d, worked);","let _ = pacer.limit_deadline_after(clock.now_nanos(), mtime, d, worked); let limited = d;"),
'S5':("(others_idle && net_busy_waiting_on_host == Some(true))","(net_busy_waiting_on_host == Some(true))"),
'S6':("&& !self.backend.rx_ready()","&& true"),
}
a,b=R[k]
assert s.count(a)==1 or k=='S6', (k, s.count(a))
if k=='S6':
    p='crates/core/src/dev/virtio/net.rs'; s=open(p).read(); assert s.count(a)==1
    open('../net.rs.orig','w').write(s)
open(p,'w').write(s.replace(a,b))
