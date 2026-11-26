// ─────────────────────────────────────────────────────────────────────────────────────────────
// E5-T37a ROUND 2 VERIFIER tests (fresh critic session; not the worker, not the round-1
// verifier). Own guests, own host clocks, own parameters. Every test name starts `r2_`.
//
// To build: append BOTH lines to `crates/core/src/turbo_equivalence_tests.rs` (this file uses
// that module's assembler and the round-1 verifier's clock / loop-flavour helpers):
//
//   include!("../../../evidence/e5-t37a/verifier/verifier_tests.rs");
//   include!("../../../evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs");
//
// then `cargo test -p wasm-vm-core --lib r2_ -- --nocapture --test-threads=1`.
//
// Tests whose name ends `_REFUTES` assert what the round-2 claim needs and FAIL at head
// d8db32db8 (crates == 215cbd1f9); each prints the observed numbers first. The others pass.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const R2_PLIC: u64 = platform::virt::PLIC_BASE;
const R2_RTC: u64 = platform::virt::RTC_BASE;
const R2_MS: u64 = 1_000_000;

/// M-mode guest: optional busy prologue, optional UART + PLIC programming (M context), the
/// machine timer armed `first` ticks out, then
/// `loop: wfi; ld x17 <- mtime; csrr x18 <- time; x19 += 1; j loop`.
/// The handler reads `mtime` (x27) and `time` (x25) as its first two instructions, then by
/// cause: software -> clears msip, x26 += 1, x23 = x27; timer -> x31 += 1, x24 = x27, re-arms
/// `rearm` ticks out; external -> x30 += 1, x11 = x27, claim, read RBR, complete. Then `work`
/// passes of a four-instruction loop and `mret`.
#[derive(Clone, Copy)]
struct R2Guest {
    first: u32,
    rearm: u32,
    work: u32,
    busy: u32,
    mie: u32,
    global_ie: bool,
    /// `Some(fcr)`: FIFO control byte; the receive interrupt is enabled and routed.
    uart_fcr: Option<u32>,
}
impl R2Guest {
    const WAKE: Self = Self {
        first: 100_000_000,
        rearm: 1_000_000_000,
        work: 700,
        busy: 0,
        mie: 0x888,
        global_ie: true,
        uart_fcr: Some(0x01),
    };
}

fn r2_image(g: &R2Guest) -> Vec<u8> {
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(8, UART);
    a.la(9, R2_PLIC + 0x20_0000);
    a.la(12, CLINT);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, g.first));
    a.ws(&li32(21, g.rearm));
    a.ws(&li32(22, g.work));
    a.ws(&li32(5, g.busy));
    a.branch(BEQ, 5, 0, "arm");
    a.label("bwork");
    a.ws(&[addi(15, 15, 3), xor(16, 16, 15), addi(5, 5, -1)]);
    a.branch(BNE, 5, 0, "bwork");
    a.label("arm");
    if let Some(fcr) = g.uart_fcr {
        a.la(7, R2_PLIC);
        a.ws(&[addi(5, 0, 1), sw(5, 7, 0x28)]); // priority[10] = 1
        a.la(7, R2_PLIC + 0x2000);
        a.ws(&[addi(5, 0, 0x400), sw(5, 7, 0)]); // M context enables source 10
        a.w(sw(0, 9, 0)); // threshold 0
        a.ws(&li32(5, fcr));
        a.w(sb(5, 8, 2));
        a.ws(&[addi(5, 0, 1), sb(5, 8, 1)]); // IER = receive data available
    }
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.ws(&li32(7, g.mie));
    a.w(csrrs(0, MIE, 7));
    if g.global_ie {
        a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    }
    a.label("loop");
    a.w(WFI);
    a.ws(&[ld(17, 14, 0), csrrs(18, TIME, 0), addi(19, 19, 1)]);
    a.jal(0, "loop");
    a.org(BASE + 0x2000);
    a.label("handler");
    a.ws(&[
        ld(27, 14, 0),
        csrrs(25, TIME, 0),
        csrrs(28, MCAUSE, 0),
        andi(28, 28, 0xF),
        addi(29, 0, 3),
    ]);
    a.branch(BEQ, 28, 29, "soft");
    a.w(addi(29, 0, 7));
    a.branch(BEQ, 28, 29, "timer");
    a.ws(&[
        addi(30, 30, 1),
        add(11, 27, 0),
        lw(5, 9, 4),
        lbu(7, 8, 0),
        sw(5, 9, 4),
    ]);
    a.jal(0, "work");
    a.label("soft");
    a.ws(&[sw(0, 12, 0), addi(26, 26, 1), add(23, 27, 0)]);
    a.jal(0, "work");
    a.label("timer");
    a.ws(&[addi(31, 31, 1), add(24, 27, 0)]);
    a.ws(&[ld(5, 14, 0), add(5, 5, 21), sd(5, 13, 0)]);
    a.label("work");
    a.w(add(10, 22, 0));
    a.branch(BEQ, 10, 0, "done");
    a.label("spin");
    a.ws(&[addi(15, 15, 3), xor(16, 16, 15), addi(10, 10, -1)]);
    a.branch(BNE, 10, 0, "spin");
    a.label("done");
    a.w(MRET);
    a.finish()
}

struct R2Rig {
    m: Machine,
    host: VClock,
}

const R2_HOST0: u64 = 7 * V_SEC;

/// A paced machine with the idle yield selected, the host clock under the test's control (it
/// does not move by being read unless the test sets a step).
fn r2_rig(image: &[u8], cfg: &Cfg, l: VLoop, bound: Option<u64>) -> R2Rig {
    let mut m = v_machine(cfg, image, l);
    let host = VClock::at(R2_HOST0, 0);
    m.set_paced_icount_clock(host.boxed()).unwrap();
    m.set_paced_idle_policy(true, bound);
    R2Rig { m, host }
}

fn r2_m_rig(g: &R2Guest, div: u64, l: VLoop, bound: Option<u64>) -> R2Rig {
    let cfg = Cfg {
        uart: g.uart_fcr.is_some(),
        ..Cfg::m_mode(div)
    };
    r2_rig(&r2_image(g), &cfg, l, bound)
}

fn r2_push(m: &Machine, bytes: &[u8]) {
    m.uart.as_ref().unwrap().0.borrow_mut().push_input(bytes);
}
fn r2_msip(m: &Machine) {
    m.clint.as_ref().unwrap().borrow_mut().msip = true;
}
fn r2_retired(m: &Machine) -> u64 {
    m.irq_stats().retired
}

/// The host event a test delivers while the guest waits.
#[derive(Clone, Copy, Debug, PartialEq)]
enum R2Event {
    /// The CLINT software interrupt (what the worker's and round 1's tests use).
    Msip,
    /// A byte on the UART (FIFO trigger 1), through the PLIC: a real host input path.
    Uart,
}
fn r2_deliver(m: &Machine, e: R2Event) {
    match e {
        R2Event::Msip => r2_msip(m),
        R2Event::Uart => r2_push(m, b"k"),
    }
}
/// (count, `mtime` at handler entry) of the handler for `e`.
fn r2_seen(m: &Machine, e: R2Event) -> (u64, u64) {
    match e {
        R2Event::Msip => (x(m, 26), x(m, 23)),
        R2Event::Uart => (x(m, 30), x(m, 11)),
    }
}

// ───────────────────────────── C5: time slept is kept ─────────────────────────────

/// C5a + C5c3 + Q2. The host takes the wait, sleeps 5 s and is woken by an event for the
/// guest; the handler retires more than `IDLE_SPIN_INSTRS`. The slept time is on the guest
/// clock at the handler's first instruction, exactly; the next wait is shorter by exactly the
/// sleep; the host clock is read once for the wake and once for the next `wfi`.
#[test]
fn r2_c5a_time_slept_before_a_host_wake_is_kept_exactly() {
    const SLEPT: u64 = 5 * V_SEC;
    let mut n = 0u64;
    for l in V_LOOPS {
        for div in [3u64, 10] {
            for work in [520u32, 4000] {
                for bound in [Some(50 * R2_MS), Some(0)] {
                    for event in [R2Event::Msip, R2Event::Uart] {
                        let at = alloc::format!("{l:?} div={div} work={work} bound={bound:?} {event:?}");
                        let g = R2Guest { work, ..R2Guest::WAKE };
                        let R2Rig { mut m, host } = r2_m_rig(&g, div, l, bound);
                        host.advance(V_SEC);
                        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                        let wait = m.take_idle_wait_nanos().expect("waiting");
                        let t0 = v_mtime(&m);
                        assert_eq!(t0, v_ticks(V_SEC), "{at}: level with the host clock");
                        assert_eq!(wait, (v_mtimecmp(&m) - t0) * V_TICK_NS, "{at}");
                        let (reads, retired) = (host.reads.get(), r2_retired(&m));
                        host.advance(SLEPT);
                        r2_deliver(&m, event);
                        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                        assert_eq!(r2_seen(&m, event).0, 1, "{at}: handled");
                        assert_eq!(x(&m, 31), 0, "{at}: the timer has not fired");
                        assert_eq!(
                            r2_seen(&m, event).1,
                            t0 + v_ticks(SLEPT),
                            "{at}: mtime at the handler's first instruction"
                        );
                        assert_eq!(x(&m, 25), t0 + v_ticks(SLEPT), "{at}: and the time CSR");
                        let ran = r2_retired(&m) - retired;
                        assert!(ran > IDLE_SPIN_INSTRS, "{at}: the handler worked: {ran}");
                        let rest = m.take_idle_wait_nanos().expect("waiting again");
                        assert_eq!(rest, wait - SLEPT, "{at}: the wait shrank by the sleep");
                        let moved = v_mtime(&m) - t0;
                        assert!(
                            moved >= v_ticks(SLEPT) && moved <= v_ticks(SLEPT) + ran / div + 1,
                            "{at}: moved {moved} ticks"
                        );
                        assert_eq!(host.reads.get(), reads + 2, "{at}: wake + next wfi");
                        n += 1;
                    }
                }
            }
        }
    }
    std::eprintln!("R2 c5a: {n} configurations, all exact");
}

/// C5b. The host oversleeps the wait by 2 s; nothing but the guest's own timer wakes it. The
/// timer is taken at its deadline in guest time, and after the handler worked the next idle
/// jump brings guest time exactly to the host clock's value: the 2 s are neither lost nor
/// handed over twice. No extra reading of the host clock (Q2).
#[test]
fn r2_c5b_time_a_host_overslept_is_kept_exactly() {
    const OVER: u64 = 2 * V_SEC;
    for l in V_LOOPS {
        for div in [3u64, 10] {
            for bound in [Some(50 * R2_MS), Some(0)] {
                let at = alloc::format!("{l:?} div={div} bound={bound:?}");
                let g = R2Guest {
                    first: 20_000,
                    work: 1500,
                    uart_fcr: None,
                    ..R2Guest::WAKE
                };
                let R2Rig { mut m, host } = r2_m_rig(&g, div, l, bound);
                host.advance(R2_MS);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                let wait = m.take_idle_wait_nanos().expect("waiting");
                let d = v_mtimecmp(&m);
                let reads = host.reads.get();
                host.advance(wait + OVER);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                assert_eq!(x(&m, 31), 1, "{at}: the timer was handled");
                assert_eq!(x(&m, 24), d, "{at}: taken at its deadline in guest time");
                assert!(m.take_idle_wait_nanos().is_some(), "{at}: waiting again");
                assert_eq!(
                    v_mtime(&m),
                    d + v_ticks(OVER),
                    "{at}: guest time == host clock (deadline + 2 s)"
                );
                assert_eq!(v_mtime(&m), v_ticks(host.now.get() - R2_HOST0), "{at}");
                // One reading at the idle pass that reaches the deadline, one at the wfi after
                // the handler; none for a wake (the guest's own timer woke it).
                assert_eq!(host.reads.get(), reads + 2, "{at}");
            }
        }
    }
}

/// C5c1. Several sleeps without an event (1 s, 2 s), then 2 s and a host wake: the handler
/// starts at t0 + 5 s exactly.
#[test]
fn r2_c5c1_several_sleeps_before_the_wake() {
    for l in V_LOOPS {
        for event in [R2Event::Msip, R2Event::Uart] {
            let at = alloc::format!("{l:?} {event:?}");
            let g = R2Guest { work: 900, ..R2Guest::WAKE };
            let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, Some(50 * R2_MS));
            host.advance(V_SEC);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            let wait = m.take_idle_wait_nanos().expect("waiting");
            let t0 = v_mtime(&m);
            let mut slept = 0u64;
            for step in [V_SEC, 2 * V_SEC] {
                host.advance(step);
                slept += step;
                let retired = r2_retired(&m);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                assert_eq!(r2_retired(&m) - retired, 5, "{at}: one idle pass");
                assert_eq!(v_mtime(&m), t0 + v_ticks(slept), "{at}");
                assert_eq!(m.take_idle_wait_nanos(), Some(wait - slept), "{at}");
            }
            host.advance(2 * V_SEC);
            r2_deliver(&m, event);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!(r2_seen(&m, event), (1, t0 + v_ticks(5 * V_SEC)), "{at}");
            assert_eq!(m.take_idle_wait_nanos(), Some(wait - 5 * V_SEC), "{at}");
        }
    }
}

/// C5c2. A wake while the guest's retire-derived time is AHEAD of the host clock: a sleep
/// shorter than the lead moves nothing (the lead shrinks), a longer one moves guest time to
/// the host clock's value exactly.
#[test]
fn r2_c5c2_a_wake_while_the_guest_is_ahead_of_the_host_clock() {
    for l in V_LOOPS {
        for bound in [Some(50 * R2_MS), None] {
            let at = alloc::format!("{l:?} bound={bound:?}");
            // Divider 1 and 40,000 busy instructions with the host clock standing still.
            let g = R2Guest {
                busy: 10_000,
                uart_fcr: None,
                ..R2Guest::WAKE
            };
            let R2Rig { mut m, host } = r2_m_rig(&g, 1, l, bound);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            let wait = m.take_idle_wait_nanos().expect("waiting");
            let (lead, d) = (v_mtime(&m), v_mtimecmp(&m));
            assert!(lead > 40_000 && lead < 41_000, "{at}: {lead} ticks ahead");
            assert_eq!(wait, d * V_TICK_NS, "{at}: measured from the ceiling (0)");
            // 1 ms < the 4 ms lead.
            host.advance(R2_MS);
            r2_msip(&m);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!((x(&m, 26), x(&m, 23)), (1, lead), "{at}: guest time did not move");
            assert_eq!(m.take_idle_wait_nanos(), Some(wait - R2_MS), "{at}");
            // 10 ms more: the host clock (11 ms) is now past the guest (about 4.3 ms).
            let before = v_mtime(&m);
            assert!(before < 50_000, "{at}");
            host.advance(10 * R2_MS);
            r2_msip(&m);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!(
                (x(&m, 26), x(&m, 23)),
                (2, v_ticks(11 * R2_MS)),
                "{at}: guest time == host clock"
            );
            assert_eq!(m.take_idle_wait_nanos(), Some(wait - 11 * R2_MS), "{at}");
        }
    }
}

/// C5c3 + Q2. The wake accounting belongs to a wait the host took: taken and not slept -> one
/// reading, nothing moves; not taken -> no reading, nothing moves; taken, slept, but the
/// pending interrupt is not enabled -> no reading at the boundary and the guest stays asleep
/// (the time arrives with its next `wfi`, and the yield is not held back: N5h).
#[test]
fn r2_c5c3_wake_accounting_only_for_a_taken_wait_and_an_enabled_interrupt() {
    for l in V_LOOPS {
        for (taken, slept) in [(true, 0u64), (false, 0), (false, 5 * V_SEC)] {
            let at = alloc::format!("{l:?} taken={taken} slept={slept}");
            let g = R2Guest { work: 0, ..R2Guest::WAKE };
            let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, Some(50 * R2_MS));
            host.advance(V_SEC);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            if taken {
                assert!(m.take_idle_wait_nanos().is_some());
            }
            let (t0, reads) = (v_mtime(&m), host.reads.get());
            host.advance(slept);
            r2_msip(&m);
            assert_eq!(m.run(1), RunOutcome::MaxInstrs);
            assert_eq!(v_ints(&m), 1, "{at}: the interrupt used the slot");
            assert_eq!(v_mtime(&m), t0, "{at}: nothing to hand over");
            assert_eq!(host.reads.get(), reads + u64::from(taken), "{at}");
        }
        // Pending but not enabled: MSIE off.
        let g = R2Guest {
            mie: 0x80,
            work: 0,
            uart_fcr: None,
            ..R2Guest::WAKE
        };
        let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, Some(50 * R2_MS));
        host.advance(V_SEC);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        let wait = m.take_idle_wait_nanos().expect("waiting");
        let (t0, reads) = (v_mtime(&m), host.reads.get());
        host.advance(5 * V_SEC);
        r2_msip(&m);
        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        assert_eq!((v_ints(&m), v_mtime(&m)), (0, t0), "{l:?}: still asleep");
        assert_eq!(host.reads.get(), reads, "{l:?}: no reading for a disabled interrupt");
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(v_mtime(&m), t0 + v_ticks(5 * V_SEC), "{l:?}: at the next wfi");
        assert_eq!(m.take_idle_wait_nanos(), Some(wait - 5 * V_SEC), "{l:?}: N5h");
        assert_eq!(host.reads.get(), reads + 1);
        assert_eq!(v_ints(&m), 0);
    }
}

/// C5c4. The timer deadline falls inside the slept interval AND a host event arrives: guest
/// time at the first handler is the deadline exactly (never past it), both interrupts are
/// taken, and after the handlers worked the next idle jump lands on the host clock's value.
#[test]
fn r2_c5c4_deadline_inside_the_slept_interval_with_a_host_event() {
    const OVER: u64 = 2 * V_SEC;
    for l in V_LOOPS {
        for event in [R2Event::Msip, R2Event::Uart] {
            for bound in [Some(50 * R2_MS), Some(0)] {
                let at = alloc::format!("{l:?} {event:?} bound={bound:?}");
                let g = R2Guest {
                    first: 20_000,
                    work: 900,
                    ..R2Guest::WAKE
                };
                let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, bound);
                host.advance(R2_MS);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                let wait = m.take_idle_wait_nanos().expect("waiting");
                let d = v_mtimecmp(&m);
                let reads = host.reads.get();
                host.advance(wait + OVER);
                r2_deliver(&m, event);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                assert_eq!(r2_seen(&m, event).0, 1, "{at}: the event was handled");
                assert_eq!(x(&m, 31), 1, "{at}: and the timer");
                let first_entry = r2_seen(&m, event).1.min(x(&m, 24));
                assert_eq!(first_entry, d, "{at}: the first handler starts at the deadline");
                assert!(m.take_idle_wait_nanos().is_some(), "{at}: waiting again");
                assert_eq!(v_mtime(&m), d + v_ticks(OVER), "{at}: == host clock");
                assert_eq!(host.reads.get(), reads + 2, "{at}: wake + next wfi");
            }
        }
    }
}

/// S-mode guest on the built-in SBI timer with the UART routed to the PLIC's S context.
/// `rdtime` is the handler's first instruction (x27); external -> x30 += 1, x23 = x27;
/// timer -> x31 += 1, x24 = x27, `set_timer(time + rearm)`.
fn r2_sbi_uart_image(first: u32, rearm: u32, work: u32) -> Vec<u8> {
    const EID_TIME: u64 = 0x5449_4D45;
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, STVEC, 6));
    a.la(8, UART);
    a.la(9, R2_PLIC + 0x20_1000);
    a.la(12, R2_PLIC);
    a.la(13, R2_PLIC + 0x2080);
    a.ws(&[addi(5, 0, 1), sw(5, 12, 0x28)]);
    a.ws(&[addi(5, 0, 0x400), sw(5, 13, 0)]);
    a.w(sw(0, 9, 0));
    a.ws(&[addi(5, 0, 1), sb(5, 8, 2), sb(5, 8, 1)]);
    a.ws(&li32(20, first));
    a.ws(&li32(21, rearm));
    a.ws(&li32(22, work));
    a.la(17, EID_TIME);
    a.w(addi(16, 0, 0));
    a.ws(&[csrrs(10, TIME, 0), add(10, 10, 20), ECALL]);
    a.ws(&[addi(7, 0, 0x220), csrrs(0, SIE, 7)]); // SEIE | STIE
    a.ws(&[addi(7, 0, 0x2), csrrs(0, SSTATUS, 7)]);
    a.label("loop");
    a.ws(&[WFI, csrrs(18, TIME, 0), addi(19, 19, 1)]);
    a.jal(0, "loop");
    a.org(BASE + 0x2000);
    a.label("handler");
    a.ws(&[
        csrrs(27, TIME, 0),
        csrrs(28, SCAUSE, 0),
        andi(28, 28, 0xF),
        addi(29, 0, 9),
    ]);
    a.branch(BEQ, 28, 29, "ext");
    a.ws(&[addi(31, 31, 1), add(24, 27, 0)]);
    a.ws(&[csrrs(10, TIME, 0), add(10, 10, 21), ECALL]);
    a.jal(0, "work");
    a.label("ext");
    a.ws(&[
        addi(30, 30, 1),
        add(23, 27, 0),
        lw(5, 9, 4),
        lbu(7, 8, 0),
        sw(5, 9, 4),
    ]);
    a.label("work");
    a.w(add(14, 22, 0));
    a.branch(BEQ, 14, 0, "done");
    a.label("spin");
    a.ws(&[addi(15, 15, 3), addi(14, 14, -1)]);
    a.branch(BNE, 14, 0, "spin");
    a.label("done");
    a.w(SRET);
    a.finish()
}

/// C5c5. The same two properties on the S-mode built-in-SBI timer with a UART byte as the
/// host event: slept time at the handler's `rdtime`, overslept time after the timer handler.
#[test]
fn r2_c5c5_s_mode_sbi_timer_host_wake_and_oversleep() {
    for l in V_LOOPS {
        for bound in [Some(50 * R2_MS), Some(0)] {
            let at = alloc::format!("{l:?} bound={bound:?}");
            let image = r2_sbi_uart_image(100_000_000, 30_000_000, 1100);
            let cfg = Cfg {
                uart: true,
                ..Cfg::s_mode(10)
            };
            let R2Rig { mut m, host } = r2_rig(&image, &cfg, l, bound);
            host.advance(V_SEC);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            let wait = m.take_idle_wait_nanos().expect("waiting");
            let (t0, d) = (v_mtime(&m), m.sbi_state.stimecmp);
            assert_eq!(wait, (d - t0) * V_TICK_NS, "{at}");
            let (reads, retired) = (host.reads.get(), r2_retired(&m));
            host.advance(5 * V_SEC);
            r2_push(&m, b"k");
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!((x(&m, 30), x(&m, 31)), (1, 0), "{at}: external only");
            assert_eq!(x(&m, 23), t0 + v_ticks(5 * V_SEC), "{at}: rdtime at stvec");
            assert!(r2_retired(&m) - retired > IDLE_SPIN_INSTRS, "{at}");
            let rest = m.take_idle_wait_nanos().expect("waiting again");
            assert_eq!(rest, wait - 5 * V_SEC, "{at}");
            assert_eq!(host.reads.get(), reads + 2, "{at}");
            // Now the host oversleeps by 2 s and the S-timer wakes the guest.
            host.advance(rest + 2 * V_SEC);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!((x(&m, 30), x(&m, 31)), (1, 1), "{at}: the S-timer");
            assert_eq!(x(&m, 24), d, "{at}: taken at its deadline");
            assert!(m.take_idle_wait_nanos().is_some(), "{at}");
            assert_eq!(v_mtime(&m), d + v_ticks(2 * V_SEC), "{at}: == host clock");
            assert_eq!(host.reads.get(), reads + 4, "{at}");
        }
    }
}

/// C5c6. Interrupts globally masked: the `wfi` returns without a trap and the very next
/// instruction reads the slept time from the CLINT register and from the `time` CSR.
#[test]
fn r2_c5c6_wake_with_interrupts_globally_masked() {
    for l in V_LOOPS {
        let g = R2Guest {
            global_ie: false,
            uart_fcr: None,
            ..R2Guest::WAKE
        };
        let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, Some(50 * R2_MS));
        host.advance(V_SEC);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert!(m.take_idle_wait_nanos().is_some());
        let (t0, reads) = (v_mtime(&m), host.reads.get());
        host.advance(5 * V_SEC);
        r2_msip(&m);
        assert_eq!(m.run(3), RunOutcome::MaxInstrs);
        assert_eq!((v_ints(&m), x(&m, 19)), (0, 1), "{l:?}: no trap, went on");
        assert_eq!(x(&m, 17), t0 + v_ticks(5 * V_SEC), "{l:?}: CLINT mtime (MMIO)");
        assert_eq!(x(&m, 18), t0 + v_ticks(5 * V_SEC), "{l:?}: time CSR");
        assert_eq!(host.reads.get(), reads + 1, "{l:?}");
    }
}

/// C5d. The bound still binds: 6,400 busy instructions with the host 7 s ahead move guest
/// time by exactly the bound; a wait + host wake hands the slept time over in full; and the
/// work the handler then does, while the host clock runs 3 s further, earns exactly one more
/// bound.
#[test]
fn r2_c5d_a_busy_guest_skips_exactly_one_bound_per_busy_stretch() {
    const BOUND: u64 = 20 * R2_MS;
    for l in V_LOOPS {
        let g = R2Guest {
            busy: 1600,
            work: 1000,
            uart_fcr: None,
            ..R2Guest::WAKE
        };
        let R2Rig { mut m, host } = r2_m_rig(&g, 1, l, Some(BOUND));
        let to_wfi = |m: &mut Machine| {
            while crate::bus::Bus::load32(&mut m.bus, m.hart.regs.pc).unwrap() != WFI {
                assert_eq!(m.run(1), RunOutcome::MaxInstrs);
            }
        };
        to_wfi(&mut m);
        assert!(r2_retired(&m) > 6_400);
        let before = v_mtime(&m);
        host.advance(7 * V_SEC);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(v_mtime(&m), before + 1 + v_ticks(BOUND), "{l:?}: exactly the bound");
        let wait = m.take_idle_wait_nanos().expect("waiting");
        assert_eq!(wait, (v_mtimecmp(&m) - v_mtime(&m)) * V_TICK_NS, "{l:?}");
        // Wait 5 s, host wake; while the handler works the host clock runs 3 s further.
        let t0 = v_mtime(&m);
        host.advance(5 * V_SEC);
        host.step.set(3 * V_SEC);
        r2_msip(&m);
        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        host.step.set(0);
        assert_eq!(v_mtime(&m), t0 + v_ticks(5 * V_SEC), "{l:?}: the slept time in full");
        to_wfi(&mut m);
        assert_eq!(x(&m, 26), 1);
        let before = v_mtime(&m);
        assert!(before - t0 - v_ticks(5 * V_SEC) > IDLE_SPIN_INSTRS, "{l:?}: it worked");
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(
            v_mtime(&m),
            before + 1 + v_ticks(BOUND),
            "{l:?}: one bound for the 3 s it fell behind while working"
        );
    }
}

// ─────────────────── B5b / C3c / N1: a wait and what it describes ───────────────────

/// B1 + B2 + B3. A recorded wait is dropped by every host call that changes what it means,
/// before the take (nothing reported) and after it (no wake accounted); a rebase is reflected
/// in the distance, with the guest level with or ahead of the host clock.
#[test]
fn r2_b_a_wait_is_dropped_by_clock_policy_and_restore_and_follows_a_rebase() {
    #[derive(Clone, Copy, Debug, PartialEq)]
    enum Op {
        ICount,
        Wall,
        Paced,
        PolicyOn,
        PolicyBound,
        PolicyOff,
        Restore,
    }
    const OPS: [Op; 7] = [
        Op::ICount,
        Op::Wall,
        Op::Paced,
        Op::PolicyOn,
        Op::PolicyBound,
        Op::PolicyOff,
        Op::Restore,
    ];
    for l in V_LOOPS {
        for op in OPS {
            for after_take in [false, true] {
                let at = alloc::format!("{l:?} {op:?} after_take={after_take}");
                let g = R2Guest {
                    work: 0,
                    uart_fcr: None,
                    ..R2Guest::WAKE
                };
                let cfg = Cfg::m_mode(10);
                let mut m = v_machine(&cfg, &r2_image(&g), l);
                let blob = m.save_resume().unwrap();
                let host = VClock::at(R2_HOST0, 0);
                m.set_paced_icount_clock(host.boxed()).unwrap();
                m.set_paced_idle_policy(true, Some(50 * R2_MS));
                host.advance(V_SEC);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                if after_take {
                    assert!(m.take_idle_wait_nanos().is_some(), "{at}");
                }
                match op {
                    Op::ICount => m.set_icount_clock(),
                    Op::Wall => m.set_wall_clock(host.boxed(), time::WallClockPolicy::DEFAULT),
                    Op::Paced => m.set_paced_icount_clock(host.boxed()).unwrap(),
                    Op::PolicyOn => m.set_paced_idle_policy(true, None),
                    Op::PolicyBound => m.set_paced_idle_policy(true, Some(7)),
                    Op::PolicyOff => m.set_paced_idle_policy(false, None),
                    Op::Restore => m.load_resume(&blob).unwrap(),
                }
                assert_eq!(m.take_idle_wait_nanos(), None, "{at}: nothing to report");
                if after_take && !matches!(op, Op::Wall | Op::Restore) {
                    // The wake that went with the wait is gone too: an event after a sleep is
                    // taken with the guest clock where it was, and the host clock is not read.
                    let (t0, reads) = (v_mtime(&m), host.reads.get());
                    host.advance(5 * V_SEC);
                    r2_msip(&m);
                    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
                    assert_eq!(v_ints(&m), 1, "{at}");
                    assert_eq!(v_mtime(&m), t0, "{at}: no wake accounting");
                    assert_eq!(host.reads.get(), reads, "{at}: no reading");
                }
            }
        }
        // Rebase, the guest level with the host clock (it idled for a second).
        let g = R2Guest {
            work: 0,
            uart_fcr: None,
            ..R2Guest::WAKE
        };
        let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, Some(50 * R2_MS));
        host.advance(V_SEC);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        host.advance(3 * V_SEC); // a pause the rebase freezes
        m.rebase_guest_clock();
        let (t, d) = (v_mtime(&m), v_mtimecmp(&m));
        assert_eq!(m.take_idle_wait_nanos(), Some((d - t) * V_TICK_NS), "{l:?}: level");
        // Rebase, the guest ahead of the host clock (divider 1, busy, host standing still).
        let g = R2Guest {
            busy: 5_000,
            work: 0,
            uart_fcr: None,
            ..R2Guest::WAKE
        };
        let R2Rig { mut m, host: _ } = r2_m_rig(&g, 1, l, Some(50 * R2_MS));
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        let (t, d) = (v_mtime(&m), v_mtimecmp(&m));
        assert!(t > 20_000);
        m.rebase_guest_clock();
        assert_eq!(m.take_idle_wait_nanos(), Some((d - t) * V_TICK_NS), "{l:?}: ahead");
    }
}

/// B4 / NV1 (novel). Task, Boundary: "a rebase of the host anchor is reflected in the
/// distance" — so a wait survives a rebase and the host may take it and sleep on it — and
/// "Waiting time is never bounded: ... when the host took a reported wait and an interrupt
/// then wakes the guest (the host delivered an event), the host time since the `wfi` goes on
/// the guest clock at that boundary". A rebase discards the host time BEFORE it; the time
/// after it is waiting time like any other.
///
/// The host rebases (before or after taking the wait), sleeps 5 s on the reported wait and is
/// woken by an event; the handler retires about 2,800 instructions; bound 50 ms.
#[test]
#[allow(non_snake_case)]
fn r2_b4_time_slept_after_a_rebase_is_kept_REFUTES() {
    const SLEPT: u64 = 5 * V_SEC;
    let mut failures = alloc::vec::Vec::new();
    for l in V_LOOPS {
        for rebase_before_take in [true, false] {
            for bound in [Some(50 * R2_MS), None] {
                let g = R2Guest {
                    uart_fcr: None,
                    ..R2Guest::WAKE
                };
                let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, bound);
                host.advance(V_SEC);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                let wait = if rebase_before_take {
                    m.rebase_guest_clock();
                    m.take_idle_wait_nanos().expect("a rebase keeps the wait")
                } else {
                    let w = m.take_idle_wait_nanos().expect("waiting");
                    m.rebase_guest_clock();
                    w
                };
                let (t0, reads) = (v_mtime(&m), host.reads.get());
                host.advance(SLEPT);
                r2_msip(&m);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                assert_eq!(x(&m, 26), 1);
                let at_entry = x(&m, 23) - t0;
                let at_next_wfi = v_mtime(&m) - t0;
                let rest = m.take_idle_wait_nanos().expect("waiting again");
                let line = alloc::format!(
                    "{l:?} rebase_before_take={rebase_before_take} bound={bound:?}: wait {} ms; \
                     slept 5000 ms; guest time moved {at_entry} ticks at handler entry, \
                     {at_next_wfi} ticks ({} ms) by the next wfi; lost {} ticks; remaining \
                     wait {} ms (want {}); host clock read {} time(s) for the wake",
                    wait / R2_MS,
                    at_next_wfi / 10_000,
                    v_ticks(SLEPT).saturating_sub(at_next_wfi),
                    rest / R2_MS,
                    (wait - SLEPT) / R2_MS,
                    host.reads.get() - reads - 1,
                );
                std::eprintln!("R2 B4 {line}");
                if at_entry != v_ticks(SLEPT) || at_next_wfi < v_ticks(SLEPT) {
                    failures.push(line);
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "time slept after a rebase is not on the guest clock at the wake ({} of 12):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

// ───────────────────── N5: no wait while an interrupt is deliverable ─────────────────────

/// N5a + N5b + Q2. `sw 1 -> msip; wfi` in one block (the round-1 case) and
/// `sd <past> -> mtimecmp; wfi` in one block: no call ever reports a wait before the
/// interrupt is handled, whatever the budget, and nobody is charged a wake.
#[test]
fn r2_n5ab_clint_levels_raised_in_the_wfi_block() {
    for kind in ["msip", "mtimecmp"] {
        let mut a = Asm::new();
        a.la_label(6, "handler");
        a.w(csrrw(0, MTVEC, 6));
        a.la(12, CLINT);
        a.la(13, CLINT + 0x4000);
        a.la(14, CLINT + 0xBFF8);
        a.ws(&li32(20, 100_000_000));
        a.ws(&li32(21, 1_000_000_000));
        a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
        a.ws(&[addi(7, 0, 0x88), csrrs(0, MIE, 7)]);
        a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
        a.w(addi(4, 0, 1));
        a.jal(0, "go");
        a.label("go");
        if kind == "msip" {
            a.ws(&[addi(15, 15, 1), sw(4, 12, 0), WFI]);
        } else {
            a.ws(&[ld(5, 14, 0), addi(5, 5, -3), sd(5, 13, 0), WFI]);
        }
        a.label("loop");
        a.ws(&[addi(19, 19, 1), WFI]);
        a.jal(0, "loop");
        a.org(BASE + 0x1000);
        a.label("handler");
        a.ws(&[sw(0, 12, 0), addi(26, 26, 1)]);
        a.ws(&[ld(5, 14, 0), add(5, 5, 21), sd(5, 13, 0), MRET]);
        let image = a.finish();
        for l in V_LOOPS {
            for budget in [1u64, 2, 3, 1_000_000] {
                let at = alloc::format!("{kind} {l:?} budget={budget}");
                let R2Rig { mut m, host } = r2_rig(&image, &Cfg::m_mode(10), l, None);
                let mut calls = 0;
                while x(&m, 26) == 0 {
                    assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                    calls += 1;
                    assert!(calls < 200, "{at}: never handled");
                    if x(&m, 26) == 0 {
                        assert_eq!(
                            m.take_idle_wait_nanos(),
                            None,
                            "{at}: a wait with an interrupt deliverable (call {calls})"
                        );
                    }
                }
                assert_eq!(v_ints(&m), 1, "{at}");
                // Selection, plus the consultation of a `wfi` that saw a future deadline
                // (the msip case; the mtimecmp case has none left) — and never a wake.
                let consulted = u64::from(kind == "msip");
                let later_wfis = m.irq_stats().wfi - 1;
                assert_eq!(host.reads.get(), 1 + consulted + later_wfis, "{at}: readings");
            }
        }
    }
}

/// N5c. Task, Boundary: "A wait is reported only while it holds. It does not hold when the
/// `wfi`'s wake condition is met or about to be: an enabled interrupt is pending; the CLINT or
/// SBI-timer levels this boundary will sample make one pending (`mip` is refreshed at block
/// boundaries only, so a store earlier in the `wfi`'s own block is not in it yet)".
///
/// The same stale-`mip` case through the OTHER interrupt controller. A UART byte is pending
/// at the PLIC (serviced at an earlier boundary) but the source is not yet enabled for the M
/// context; the block `sw <enable> -> PLIC; wfi` enables it. After the store the PLIC asserts
/// the external line, `mip.MEIP` follows at the next boundary — and the `wfi` in between
/// reports the whole distance to the timer.
#[test]
#[allow(non_snake_case)]
fn r2_n5c_no_wait_while_a_plic_interrupt_is_deliverable_REFUTES() {
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(8, UART);
    a.la(9, R2_PLIC + 0x20_0000);
    a.la(12, R2_PLIC + 0x2000);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, 100_000_000));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.la(7, R2_PLIC);
    a.ws(&[addi(5, 0, 1), sw(5, 7, 0x28)]); // priority[10] = 1
    a.w(sw(0, 9, 0)); // threshold 0
    a.ws(&[addi(5, 0, 1), sb(5, 8, 2), sb(5, 8, 1)]); // FIFO trigger 1, IER = RX
    a.ws(&li32(7, 0x880)); // MEIE | MTIE
    a.w(csrrs(0, MIE, 7));
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.w(addi(4, 0, 0x400));
    a.jal(0, "go"); // a block boundary: the UART is serviced and its line reaches the PLIC
    a.label("go");
    a.ws(&[sw(4, 12, 0), WFI]); // enable source 10 for the M context; wfi
    a.label("loop");
    a.ws(&[addi(19, 19, 1), WFI]);
    a.jal(0, "loop");
    a.org(BASE + 0x1000);
    a.label("handler");
    a.ws(&[ld(27, 14, 0), csrrs(28, MCAUSE, 0), andi(28, 28, 0xF)]);
    a.ws(&[lw(5, 9, 4), lbu(7, 8, 0), sw(5, 9, 4), addi(30, 30, 1), MRET]);
    let image = a.finish();
    let cfg = Cfg {
        uart: true,
        ..Cfg::m_mode(10)
    };
    // Control: without the opt-in the interrupt is taken at the boundary after the `wfi`.
    let mut c = v_machine(&cfg, &image, VLoop::General);
    c.set_paced_icount_clock(VClock::at(R2_HOST0, 0).boxed())
        .unwrap();
    r2_push(&c, b"k");
    assert_eq!(c.run(200), RunOutcome::MaxInstrs);
    assert_eq!((x(&c, 30), x(&c, 28)), (1, 11), "control: machine external");
    assert_eq!(c.irq_stats().wfi > 1, true);

    let mut failures = alloc::vec::Vec::new();
    for l in V_LOOPS {
        for budget in [1u64, 1_000_000] {
            let R2Rig { mut m, host } = r2_rig(&image, &cfg, l, None);
            r2_push(&m, b"k"); // the host's byte is there before the guest enables anything
            let mut wait = None;
            while m.irq_stats().wfi == 0 {
                assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                wait = m.take_idle_wait_nanos();
            }
            let eip = m.plic.as_ref().unwrap().borrow().eip(0);
            let (handled, wfis, retired) = (x(&m, 30), m.irq_stats().wfi, r2_retired(&m));
            let reads = host.reads.get();
            // What happens next with the host clock unchanged and nothing delivered.
            let (mut probe_ints, mut probe_reads) = (0, 0);
            if handled == 0 {
                assert_eq!(m.run(1), RunOutcome::MaxInstrs);
                probe_ints = v_ints(&m);
                probe_reads = host.reads.get() - reads;
                // Three handler instructions: x28 = mcause & 0xF.
                assert_eq!(m.run(3), RunOutcome::MaxInstrs);
            }
            let line = alloc::format!(
                "{l:?} budget={budget}: the call that retired the first wfi ended at \
                 retired={retired} wfi={wfis} with wait={wait:?} ns, plic.eip(M)={eip}, \
                 external handled={handled}; the next run(1), host clock unchanged, took \
                 {probe_ints} interrupt(s) (mcause & 0xF = {}), host readings for it \
                 {probe_reads}",
                x(&m, 28),
            );
            std::eprintln!("R2 N5c {line}");
            if wait.is_some() && eip {
                failures.push(line);
            }
        }
    }
    assert!(
        failures.is_empty(),
        "a wait was reported while the PLIC asserted an enabled interrupt ({} of 6):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// N5d — the worker's device rule. Task, Boundary: "A wait is reported only while it holds";
/// `lib.rs` (`wfi_fast_forward`): "The deadline is in the paced future: nothing can happen in
/// the guest until the host clock gets there or something else wakes it."
///
/// The rule asks whether a fabric device was ACCESSED since the last sampled boundary. It
/// does not ask whether a device still has work. Here the UART is programmed the way Linux's
/// 8250 driver programs a 16550A (FIFO trigger 8, receive interrupt on), the guest idles on a
/// timer 10 s out, and the host delivers ONE byte. The 16550 character timeout raises the
/// interrupt 1024 boundary ticks later with no further access by anyone — a guest that keeps
/// executing (yield off) takes it inside the same run call. With the yield on, every `wfi` on
/// the way reports the 10 s wait.
#[test]
#[allow(non_snake_case)]
fn r2_n5d_no_wait_while_the_uart_character_timeout_is_running_REFUTES() {
    let g = R2Guest {
        work: 0,
        uart_fcr: Some(0x81),
        ..R2Guest::WAKE
    };
    let cfg = Cfg {
        uart: true,
        ..Cfg::m_mode(10)
    };
    // Control: yield off. One run call after the byte, host clock standing still.
    let mut c = v_machine(&cfg, &r2_image(&g), VLoop::General);
    let chost = VClock::at(R2_HOST0, 0);
    c.set_paced_icount_clock(chost.boxed()).unwrap();
    chost.advance(V_SEC);
    assert_eq!(c.run(2_000), RunOutcome::MaxInstrs);
    assert_eq!(x(&c, 30), 0);
    r2_push(&c, b"k");
    let (retired, t) = (r2_retired(&c), v_mtime(&c));
    assert_eq!(c.run(20_000), RunOutcome::MaxInstrs);
    assert_eq!(x(&c, 30), 1, "control: the timeout interrupt, in one call");
    std::eprintln!(
        "R2 N5d control (yield off): byte delivered, host clock standing still; the UART \
         interrupt handler started {} guest ticks ({} us) later, inside the same run call \
         ({} retirements used of 20000)",
        x(&c, 11) - t,
        (x(&c, 11) - t) / 10,
        r2_retired(&c) - retired,
    );

    let mut failures = alloc::vec::Vec::new();
    for l in V_LOOPS {
        let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, None);
        host.advance(V_SEC);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        let first = m.take_idle_wait_nanos().expect("idle, nothing owed yet");
        // The host delivers the byte and calls run. From here on the host clock does not
        // move and nothing else is delivered: per the claim nothing can happen in the guest.
        r2_push(&m, b"k");
        let (mut calls, mut waits, mut sum, mut not_idle) = (0u64, 0u64, 0u128, 0u64);
        let mut smallest = u64::MAX;
        while x(&m, 30) == 0 {
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            calls += 1;
            if x(&m, 30) == 0
                && let Some(w) = m.take_idle_wait_nanos()
            {
                waits += 1;
                sum += u128::from(w);
                smallest = smallest.min(w);
                // What the run loop already knows (E4 fabric quiescence): the last full
                // device pass of this call did NOT find every device idle.
                not_idle += u64::from(m.fabric_idle_epoch != Some(m.fabric_epoch.get()));
            }
            assert!(calls < 100_000, "{l:?}: the interrupt never came");
        }
        let line = alloc::format!(
            "{l:?}: first wait {} ms; after the byte {waits} run calls each reported a wait \
             (smallest {} ms; {} s of sleep in total for a host that honours them) before the \
             UART interrupt was taken in call {calls} — host clock unchanged, nothing else \
             delivered; at {not_idle} of those waits the machine's own fabric-idle marker \
             said a device still had work",
            first / R2_MS,
            smallest / R2_MS,
            sum / u128::from(V_SEC),
        );
        std::eprintln!("R2 N5d {line}");
        if waits != 0 {
            failures.push(line);
        }
    }
    assert!(
        failures.is_empty(),
        "waits reported while a device owed an interrupt that needs neither the host clock \
         nor a host event:\n{}",
        failures.join("\n")
    );
}

struct R2Wall(alloc::rc::Rc<core::cell::Cell<u64>>);
impl dev::rtc::WallClock for R2Wall {
    fn now_ns(&self) -> u64 {
        self.0.get()
    }
}

/// N5e — the same hole with the goldfish RTC. An alarm armed 1 ms ahead (interrupt enabled
/// and routed), the CLINT timer 10 s out. The wait reported is the timer's; a host that
/// sleeps it delivers the alarm 10 s late. A guest that keeps executing takes it on time.
#[test]
#[allow(non_snake_case)]
fn r2_n5e_no_wait_longer_than_an_armed_rtc_alarm_REFUTES() {
    const WALL0: u64 = 1_000_000;
    const ALARM: u64 = 2_000_000;
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(8, R2_RTC);
    a.la(9, R2_PLIC + 0x20_0000);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.la(7, R2_PLIC);
    a.ws(&[addi(5, 0, 1), sw(5, 7, 0x2C)]); // priority[11] = 1
    a.la(7, R2_PLIC + 0x2000);
    a.ws(&li32(5, 0x800));
    a.w(sw(5, 7, 0)); // M context enables source 11
    a.w(sw(0, 9, 0));
    a.ws(&[addi(5, 0, 1), sw(5, 8, 0x10)]); // IRQ_ENABLED
    a.w(sw(0, 8, 0x0c)); // ALARM_HIGH
    a.ws(&li32(5, ALARM as u32));
    a.w(sw(5, 8, 0x08)); // ALARM_LOW arms
    a.ws(&li32(20, 100_000_000));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.ws(&li32(7, 0x880));
    a.w(csrrs(0, MIE, 7));
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.jal(0, "loop");
    a.label("loop");
    a.ws(&[WFI, addi(19, 19, 1)]);
    a.jal(0, "loop");
    a.org(BASE + 0x1000);
    a.label("handler");
    a.ws(&[ld(27, 14, 0), csrrs(28, MCAUSE, 0), andi(28, 28, 0xF)]);
    a.w(addi(29, 0, 11));
    a.branch(BNE, 28, 29, "timer");
    a.ws(&[
        lw(5, 9, 4),
        sw(0, 8, 0x1c),
        sw(5, 9, 4),
        addi(30, 30, 1),
        add(11, 27, 0),
        MRET,
    ]);
    a.label("timer");
    a.ws(&[addi(31, 31, 1), addi(5, 0, -1), sd(5, 13, 0), MRET]);
    let image = a.finish();
    let cfg = Cfg {
        uart: true,
        ..Cfg::m_mode(10)
    };
    let build = |l: VLoop, yield_to_host: bool| {
        let mut m = v_machine(&cfg, &image, l);
        let wall = alloc::rc::Rc::new(core::cell::Cell::new(WALL0));
        let rtc = m.enable_rtc(alloc::boxed::Box::new(R2Wall(alloc::rc::Rc::clone(&wall))));
        let host = VClock::at(R2_HOST0, 0);
        m.set_paced_icount_clock(host.boxed()).unwrap();
        m.set_paced_idle_policy(yield_to_host, None);
        (m, host, wall, rtc)
    };
    // Control: yield off; both host clocks move 2 ms (the alarm is due after 1); one call.
    let (mut c, chost, cwall, _) = build(VLoop::General, false);
    assert_eq!(c.run(500), RunOutcome::MaxInstrs);
    let t = v_mtime(&c);
    chost.advance(2 * R2_MS);
    cwall.set(cwall.get() + 2 * R2_MS);
    assert_eq!(c.run(500), RunOutcome::MaxInstrs);
    assert_eq!((x(&c, 30), x(&c, 31)), (1, 0), "control: the alarm, not the timer");
    std::eprintln!(
        "R2 N5e control (yield off): alarm handled {} guest ticks after the clocks moved 2 ms",
        x(&c, 11) - t
    );

    let mut failures = alloc::vec::Vec::new();
    for l in V_LOOPS {
        let (mut m, host, wall, rtc) = build(l, true);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        let armed = rtc.borrow().alarm_armed();
        let fabric_idle = m.fabric_idle_epoch == Some(m.fabric_epoch.get());
        let wait = m.take_idle_wait_nanos();
        let t0 = v_mtime(&m);
        let to_alarm = ALARM - wall.get();
        // A host that honours the wait: both of its clocks advance by it.
        let slept = wait.unwrap_or(to_alarm);
        host.advance(slept);
        wall.set(wall.get() + slept);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        let line = alloc::format!(
            "{l:?}: alarm armed={armed} (fabric-idle marker: {fabric_idle}), due in {} us; \
             wait reported {:?} ns; after the host slept it the alarm handler started {} \
             guest ticks ({} ms) after the wfi (alarms handled {}, timers {})",
            to_alarm / 1_000,
            wait,
            x(&m, 11).saturating_sub(t0),
            x(&m, 11).saturating_sub(t0) / 10_000,
            x(&m, 30),
            x(&m, 31),
        );
        std::eprintln!("R2 N5e {line}");
        if armed && wait.is_some_and(|w| w > to_alarm) {
            failures.push(line);
        }
    }
    assert!(
        failures.is_empty(),
        "a wait longer than the time to an armed, enabled RTC alarm was reported:\n{}",
        failures.join("\n")
    );
}

/// N5f + N5g. Where the device rule does apply it behaves the same in the three
/// block-sampled loop flavours: a fabric access in the `wfi`'s own block holds that `wfi`
/// back, the next `wfi` yields. An idle loop that touches a device in the `wfi`'s block on
/// every pass never yields (a performance loss, nothing reported, same state as yield off);
/// with interrupt batching off — every instruction a sampled boundary — it yields each pass.
#[test]
fn r2_n5fg_device_rule_in_every_loop_flavour_and_the_never_yielding_idle_loop() {
    let image = |every_pass: bool| {
        let mut a = Asm::new();
        a.la_label(6, "handler");
        a.w(csrrw(0, MTVEC, 6));
        a.la(8, UART);
        a.la(13, CLINT + 0x4000);
        a.la(14, CLINT + 0xBFF8);
        a.ws(&li32(20, 100_000_000));
        a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
        a.ws(&[addi(7, 0, 0x80), csrrs(0, MIE, 7)]);
        a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
        if every_pass {
            a.label("loop");
            a.ws(&[lbu(5, 8, 5), WFI]); // LSR read, then wfi: one block
            a.jal(0, "loop");
        } else {
            a.ws(&[lbu(5, 8, 5), WFI]);
            a.label("loop");
            a.ws(&[addi(19, 19, 1), WFI]);
            a.jal(0, "loop");
        }
        a.org(BASE + 0x1000);
        a.label("handler");
        a.w(MRET);
        a.finish()
    };
    let cfg = Cfg {
        uart: true,
        ..Cfg::m_mode(10)
    };
    let once = image(false);
    let always = image(true);
    let mut seen = alloc::vec::Vec::new();
    for l in V_LOOPS {
        let R2Rig { mut m, host: _ } = r2_rig(&once, &cfg, l, None);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        let wait = m.take_idle_wait_nanos();
        assert_eq!(m.irq_stats().wfi, 2, "{l:?}: held back at the first, yields at the next");
        assert!(wait.is_some(), "{l:?}");
        seen.push((r2_retired(&m), wait, v_mtime(&m)));

        // The never-yielding loop: budget used in full, nothing reported, and the state is
        // the yield-off machine's after every call.
        let R2Rig { mut m, host: _ } = r2_rig(&always, &cfg, l, None);
        let mut c = v_machine(&cfg, &always, VLoop::General);
        c.set_paced_icount_clock(VClock::at(R2_HOST0, 0).boxed())
            .unwrap();
        let (mut tm, mut tc) = (HashSink::new(), HashSink::new());
        for budget in [1u64, 2, 3, 500, 30_000] {
            let before = r2_retired(&m);
            let om = m.run_traced(budget, &mut tm);
            let oc = c.run_traced(budget, &mut tc);
            assert_eq!(r2_retired(&m) - before, budget, "{l:?}: budget used");
            assert_eq!(m.take_idle_wait_nanos(), None, "{l:?}: nothing reported");
            assert_eq!(observe(&m, &tm, om), observe(&c, &tc, oc), "{l:?} budget {budget}");
        }
        assert!(m.irq_stats().wfi > 10_000, "{l:?}: it spun");
    }
    assert!(seen.windows(2).all(|w| w[0] == w[1]), "loops agree: {seen:?}");
    // Legacy per-instruction sampling: the device is serviced between the access and the
    // `wfi`, so the rule has nothing to hold back.
    let R2Rig { mut m, host: _ } = r2_rig(&always, &cfg, VLoop::General, None);
    m.set_interrupt_batching(false);
    assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
    assert!(r2_retired(&m) < 100 && m.take_idle_wait_nanos().is_some());
    std::eprintln!(
        "R2 N5g: `lbu LSR; wfi; j` never yields in General/Batched/Turbo (budget used, state \
         == yield off); with batching off it yields at retired={}",
        r2_retired(&m)
    );
}

// ───────────────────────────── Exact equivalence (Q1, V4) ─────────────────────────────

/// The round-2 contract's "has to wait", from architectural state of a yield-off control and
/// one number the harness tracks itself — never from the implementation's own bookkeeping
/// (`idle_wait_deadline`, `idle_boundary_epoch`):
///
/// * no enabled interrupt pending in `mip` as last sampled;
/// * none per the levels the next boundary samples: `msip`, `mtime >= mtimecmp`, and with the
///   built-in SBI `mtime >= stimecmp`, each gated by its `mie` bit;
/// * no fabric device access since the last sampled boundary: `epoch_at_boundary` is the
///   pre-existing fabric access counter as the HARNESS read it the last time the control
///   stood at a block boundary;
/// * the nearest timer deadline that was ahead when the `wfi` retired is still ahead.
fn r2_wfi_waits(m: &Machine, mtime_at_wfi: u64, epoch_at_boundary: u64) -> bool {
    if m.hart.csr.mip_and_mie_nonzero() {
        return false;
    }
    let c = *m.clint.as_ref().unwrap().borrow();
    let mie = m.hart.csr.mie_bits();
    if (c.msip && mie & 0x8 != 0) || (c.mtime >= c.mtimecmp && mie & 0x80 != 0) {
        return false;
    }
    if m.builtin_sbi && c.mtime >= m.sbi_state.stimecmp && mie & 0x20 != 0 {
        return false;
    }
    if m.fabric_epoch.get() != epoch_at_boundary {
        return false;
    }
    let mut nearest: Option<u64> = None;
    for cmp in [c.mtimecmp, m.sbi_state.stimecmp] {
        if cmp != u64::MAX && cmp > mtime_at_wfi {
            nearest = Some(nearest.map_or(cmp, |d| d.min(cmp)));
        }
    }
    nearest.is_some_and(|d| c.mtime < d)
}

/// The round-1 verifier's lockstep (`v_lockstep`), with `r2_wfi_waits`, the harness-tracked
/// fabric epoch, and the two machines' host-clock reading counts compared after every call.
fn r2_lockstep(
    label: &str,
    build: &dyn Fn(VLoop, bool) -> (Machine, VClock),
    budgets: &[u64],
    tally: &mut VTally,
) {
    for subject_loop in V_LOOPS {
        let at = alloc::format!("{label} loop={subject_loop:?} budgets={budgets:?}");
        let (mut control, cclock) = build(VLoop::General, false);
        let (mut subject, sclock) = build(subject_loop, true);
        assert!(subject.paced_idle_yield() && !control.paced_idle_yield());
        let (mut tc, mut ts) = (HashSink::new(), HashSink::new());
        let mut call = 0usize;
        let mut epoch_at_boundary = control.fabric_epoch.get();
        tally.configs += 1;
        loop {
            let budget = budgets[call % budgets.len()];
            call += 1;
            tally.calls += 1;
            let os = subject.run_traced(budget, &mut ts);
            let wait = subject.take_idle_wait_nanos();
            assert_eq!(subject.take_idle_wait_nanos(), None, "{at}: reported twice");
            let target = subject.irq_stats().retired;
            let mut oc = RunOutcome::MaxInstrs;
            let mut slots = 0u64;
            let mut last_waits = false;
            loop {
                let done = match wait {
                    Some(_) => control.irq_stats().retired >= target,
                    None => slots == budget || oc != RunOutcome::MaxInstrs,
                };
                if done {
                    break;
                }
                assert!(
                    !last_waits,
                    "{at} call {call}: MISSED RETURN — the control retired a waiting wfi at \
                     retired={} and the subject ran on to {target}",
                    control.irq_stats().retired
                );
                if resume_point(&control).is_none() {
                    // The control's next loop iteration samples this boundary.
                    epoch_at_boundary = control.fabric_epoch.get();
                }
                let (wfis, mtime, accum) = (
                    control.irq_stats().wfi,
                    v_mtime(&control),
                    control.tick_accum,
                );
                oc = control.run_traced(1, &mut tc);
                slots += 1;
                tally.control_steps += 1;
                last_waits = control.irq_stats().wfi != wfis && {
                    let tick = u64::from(accum + 1 >= control.clock_div);
                    r2_wfi_waits(&control, mtime + tick, epoch_at_boundary)
                };
            }
            match wait {
                Some(ns) => {
                    tally.yields += 1;
                    assert!(
                        last_waits,
                        "{at} call {call}: EARLY RETURN — wait {ns} ns reported at \
                         retired={target} but the last retirement was not a waiting wfi"
                    );
                    assert!(slots <= budget, "{at} call {call}: over budget");
                    assert_eq!(os, RunOutcome::MaxInstrs, "{at}");
                    assert!(ns >= V_TICK_NS, "{at}: a wait is at least one tick");
                }
                None => assert!(
                    !last_waits,
                    "{at} call {call}: MISSED RETURN on the last budget slot (retired={target})"
                ),
            }
            assert_eq!(
                observe(&subject, &ts, os),
                observe(&control, &tc, oc),
                "{at} call {call} budget {budget} wait {wait:?}"
            );
            assert!(
                subject.bus.ram().as_bytes() == control.bus.ram().as_bytes(),
                "{at} call {call}: RAM"
            );
            assert_eq!(
                sclock.reads.get(),
                cclock.reads.get(),
                "{at} call {call}: host clock readings"
            );
            let sampled = wait.is_some() && tally.yields.is_multiple_of(89);
            if call.is_multiple_of(400) || sampled || os != RunOutcome::MaxInstrs {
                assert_eq!(
                    subject.save_resume().unwrap(),
                    control.save_resume().unwrap(),
                    "{at} call {call}: resume bytes"
                );
            }
            if os != RunOutcome::MaxInstrs {
                assert!(powered_off(&subject), "{at}: ended by poweroff, got {os:?}");
                break;
            }
            assert!(call < 3_000_000, "{at}: no progress");
        }
    }
}

fn r2_paced(
    cfg: &Cfg,
    image: &[u8],
    l: VLoop,
    yield_to_host: bool,
    lag: Option<u64>,
    step_ticks: u64,
    policy_first: bool,
) -> (Machine, VClock) {
    let mut m = v_machine(cfg, image, l);
    let clock = VClock::at(424_242_424, step_ticks * V_TICK_NS);
    if policy_first {
        m.set_paced_idle_policy(yield_to_host, lag);
        m.set_paced_icount_clock(clock.boxed()).unwrap();
    } else {
        m.set_paced_icount_clock(clock.boxed()).unwrap();
        m.set_paced_idle_policy(yield_to_host, lag);
    }
    (m, clock)
}

/// A seeded M-mode program like round 1's, plus UART accesses (scratch writes, LSR reads) —
/// the fabric accesses the round-2 device rule is about — next to the `wfi`s.
fn r2_random_image(seed: u64) -> Vec<u8> {
    let mut s = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut next = move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    };
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(8, DATA + 0x800);
    a.la(11, UART);
    a.la(12, CLINT);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&[ld(10, 14, 0), addi(10, 10, 70), sd(10, 13, 0)]);
    a.ws(&[addi(7, 0, 0x88), csrrs(0, MIE, 7)]);
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    for reg in 16..26 {
        a.ws(&li32(reg, next() as u32));
    }
    a.w(addi(9, 0, 6));
    a.label("loop");
    for _ in 0..50 + next() % 70 {
        let reg = |v: u64| 16 + (v % 10) as u32;
        let (rd, rs1, rs2) = (reg(next()), reg(next()), reg(next()));
        let off = (next() % 64) as i32 * 8 - 256;
        match next() % 28 {
            0..=5 => a.w(match next() % 3 {
                0 => addi(rd, rs1, (next() % 4096) as i32 - 2048),
                1 => add(rd, rs1, rs2),
                _ => xor(rd, rs1, rs2),
            }),
            6..=7 => a.w([lbu, lh, lw, ld][(next() % 4) as usize](rd, 8, off)),
            8..=9 => a.w([sb, sh, sw, sd][(next() % 4) as usize](rs2, 8, off)),
            10..=11 => {
                let f3 = [BEQ, BNE, BLT, BGEU][(next() % 4) as usize];
                a.w(b_type(4 * (2 + (next() % 3) as i32), rs2, rs1, f3));
            }
            12 => a.w(csrrs(rd, [TIME, CYCLE, MINSTRET][(next() % 3) as usize], 0)),
            13 => a.w(ld(rd, 14, 0)),
            14..=15 => {
                let ahead = [-4, 2, 55, 900, 2000][(next() % 5) as usize];
                a.ws(&[ld(10, 14, 0), addi(10, 10, ahead), sd(10, 13, 0)]);
            }
            16 => a.w(sw(rs2, 12, 0)), // msip = bit 0 of a register
            17..=19 => a.w(sb(rs2, 11, 7)), // UART scratch
            20..=21 => a.w(lbu(rd, 11, 5)), // UART line status
            _ => a.w(WFI),
        }
    }
    a.ws(&[addi(0, 0, 0); 4]);
    a.w(addi(9, 9, -1));
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    a.label("handler");
    a.ws(&[
        csrrs(28, MEPC, 0),
        slli(29, 30, 5),
        add(30, 30, 29),
        add(30, 30, 28),
        csrrs(28, MCAUSE, 0),
        add(30, 30, 28),
        addi(31, 31, 1),
        sw(0, 12, 0),
        ld(27, 14, 0),
        addi(27, 27, 53),
        sd(27, 13, 0),
        MRET,
    ]);
    a.finish()
}

const R2_BUDGETS: [&[u64]; 4] = [&[1], &[3, 2], &[1, 11, 1, 40], &[250_000]];
const R2_LAGS: [Option<u64>; 4] = [Some(0), None, Some(1_700), Some(3 * V_SEC)];
const R2_STEPS: [u64; 4] = [1, 17, 350, 40_000];

/// Q1 / V4. Timer-only guests (S-mode SBI timer; M-mode with the `wfi` last in an inline
/// block and straddling a page), seeded random programs with `msip` writes and deadline
/// rewrites, and seeded random programs with fabric accesses — at my seeds and parameters,
/// with the predicate above. State, RAM, host-clock readings equal after every call and the
/// resume bytes at every sample, in the three loop flavours.
#[test]
fn r2_q1_lockstep_with_an_independent_predicate() {
    let mut tally = VTally::default();
    let mut n = 0usize;
    let pick = |n: usize| {
        (
            [3u64, 5, 41][n % 3],
            R2_LAGS[(n / 3) % 4],
            R2_STEPS[(n / 2) % 4],
            R2_BUDGETS[n % 4],
            n.is_multiple_of(2),
        )
    };
    for (first, rearm, stop) in [(700u32, 310u32, 11), (29, 29, 25), (12_000, 4, 7)] {
        let image = v_sbi_image(first, rearm, stop);
        for _ in 0..6 {
            n += 1;
            let (div, lag, step, budgets, pf) = pick(n);
            let label = alloc::format!("sbi first={first} rearm={rearm} div={div} step={step} lag={lag:?}");
            r2_lockstep(
                &label,
                &|l, y| r2_paced(&Cfg::s_mode(div), &image, l, y, lag, step, pf),
                budgets,
                &mut tally,
            );
        }
    }
    let sbi = tally.yields;
    for straddle in [false, true] {
        for (first, rearm, stop, handler, pad) in
            [(450u32, 130u32, 10, 2u32, 0u32), (31, 31, 24, 0, 2), (7_000, 3, 7, 60, 1)]
        {
            let image = v_idle_image(&VGuest {
                first,
                rearm,
                stop,
                busy: 17,
                handler,
                pad,
                extra: true,
                straddle,
            });
            for _ in 0..4 {
                n += 1;
                let (div, lag, step, budgets, pf) = pick(n);
                let label = alloc::format!(
                    "m straddle={straddle} first={first} rearm={rearm} handler={handler} \
                     pad={pad} div={div} step={step} lag={lag:?}"
                );
                r2_lockstep(
                    &label,
                    &|l, y| r2_paced(&Cfg::m_mode(div), &image, l, y, lag, step, pf),
                    budgets,
                    &mut tally,
                );
            }
        }
    }
    let m_mode = tally.yields - sbi;
    for seed in 9101..=9116u64 {
        let image = v_random_image(seed);
        for _ in 0..2 {
            n += 1;
            let (div, lag, step, budgets, pf) = pick(n);
            let label = alloc::format!("random seed={seed} div={div} step={step} lag={lag:?}");
            r2_lockstep(
                &label,
                &|l, y| r2_paced(&Cfg::m_mode(div), &image, l, y, lag, step, pf),
                budgets,
                &mut tally,
            );
        }
    }
    let random = tally.yields - sbi - m_mode;
    let cfg_uart = |div| Cfg {
        uart: true,
        ..Cfg::m_mode(div)
    };
    for seed in 9201..=9224u64 {
        let image = r2_random_image(seed);
        for _ in 0..2 {
            n += 1;
            let (div, lag, step, budgets, pf) = pick(n);
            let label = alloc::format!("fabric seed={seed} div={div} step={step} lag={lag:?}");
            r2_lockstep(
                &label,
                &|l, y| r2_paced(&cfg_uart(div), &image, l, y, lag, step, pf),
                budgets,
                &mut tally,
            );
        }
    }
    let fabric = tally.yields - sbi - m_mode - random;
    std::eprintln!(
        "R2 lockstep: configs={} calls={} control_steps={} yields={} (sbi {sbi}, m-mode \
         {m_mode}, random {random}, fabric {fabric})",
        tally.configs,
        tally.calls,
        tally.control_steps,
        tally.yields,
    );
    assert!(sbi > 500 && m_mode > 500 && random > 100 && fabric > 100);
}

// ─────────────────────────── The pacer alone (Q3, NV2) ───────────────────────────

/// `IdlePacer` as it was before the task (`git show ee5582ac6:crates/core/src/time.rs`).
struct R2LegacyPacer {
    anchor_host_ns: u64,
    latest_host_ns: u64,
    anchor_mtime: u64,
    timebase_hz: u64,
}
impl R2LegacyPacer {
    fn new(host_ns: u64, mtime: u64, timebase_hz: u64) -> Self {
        Self {
            anchor_host_ns: host_ns,
            latest_host_ns: host_ns,
            anchor_mtime: mtime,
            timebase_hz,
        }
    }
    fn limit_deadline(&mut self, host_ns: u64, current: u64, deadline: u64) -> u64 {
        self.latest_host_ns = self.latest_host_ns.max(host_ns);
        let elapsed = self.latest_host_ns - self.anchor_host_ns;
        let ticks = u128::from(elapsed) * u128::from(self.timebase_hz) / 1_000_000_000;
        let ceiling = (u128::from(self.anchor_mtime) + ticks).min(u128::from(u64::MAX)) as u64;
        current.max(deadline.min(ceiling))
    }
    fn rebase(&mut self, host_ns: u64, mtime: u64) {
        *self = Self::new(host_ns, mtime, self.timebase_hz);
    }
}

fn r2_rng(seed: u64) -> impl FnMut() -> u64 {
    let mut s = seed.wrapping_mul(0xA24B_AED4_963E_E407) | 1;
    move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    }
}

/// Q3. Without a bound (the default, and what a paced machine that does not opt in gets) the
/// new pacer is the old one, whatever `worked` says: random closed-loop sequences with host
/// readings that stand still, jump, run backwards and saturate, deadlines near, far, past and
/// at the u64 edge, rebases, and timebases from 1 Hz to 10 GHz.
#[test]
fn r2_q3_unbounded_pacer_is_the_pre_task_pacer() {
    let mut steps = 0u64;
    for seed in 1..=400u64 {
        let mut next = r2_rng(seed);
        let hz = [10_000_000u64, 1, 1_000_000_000, 10_000_000_000, 32_768][(seed % 5) as usize];
        let extreme = seed % 4 == 0;
        let (mut host, mut current) = if extreme {
            (next(), next())
        } else {
            (next() % (1 << 40), next() % (1 << 40))
        };
        let mut new = time::IdlePacer::new(host, current, hz);
        if seed % 3 == 0 {
            new.set_max_busy_lag_ticks(u64::MAX);
        }
        let mut old = R2LegacyPacer::new(host, current, hz);
        for _ in 0..500 {
            host = match next() % 10 {
                0 => host,
                1 => host.saturating_sub(next() % 1_000_000_000),
                2 if extreme => host.saturating_add(next()),
                _ => host.saturating_add(next() % 50_000_000),
            };
            current = match next() % 8 {
                0 if extreme => current.saturating_add(next() >> 8),
                0..=2 => current,
                _ => current.saturating_add(next() % 5_000),
            };
            let deadline = match next() % 8 {
                0 => u64::MAX - 1,
                1 => current.saturating_sub(next() % 100),
                2 => current,
                3 if extreme => next(),
                _ => current.saturating_add(1 + next() % 2_000_000),
            };
            let worked = next() % 2 == 0;
            if next() % 97 == 0 {
                new.rebase(host, current);
                old.rebase(host, current);
            }
            let want = old.limit_deadline(host, current, deadline);
            let got = if next() % 5 == 0 {
                new.limit_deadline(host, current, deadline)
            } else {
                new.limit_deadline_after(host, current, deadline, worked)
            };
            assert_eq!(got, want, "seed {seed} hz {hz} worked {worked}");
            assert_eq!(new.waiting(), got < deadline);
            current = got;
            steps += 1;
        }
    }
    std::eprintln!("R2 Q3: {steps} consultations, new == pre-task");
}

/// NV2. Closed-loop fuzz with a bound. (i) a guest that never works gets exactly the unbounded
/// pacing; (ii) total idle jump <= host time that passed while it waited + one bound per
/// consultation that followed work (+ one tick of rounding per consultation); (iii) an idle
/// jump never carries guest time past the host clock's value; (iv) no panic.
#[test]
fn r2_nv2_bounded_pacer_closed_loop_invariants() {
    const HZ: u64 = 10_000_000;
    let ticks = |ns: u64| (u128::from(ns) * u128::from(HZ) / 1_000_000_000) as u64;
    let mut steps = 0u64;
    for seed in 1..=600u64 {
        let mut next = r2_rng(seed ^ 0x5EED);
        let bound = [0u64, 1, 5_000, 500_000, 20_000_000][(seed % 5) as usize];
        let never_works = seed % 3 == 0;
        let host0 = next() % (1 << 40);
        let mtime0 = next() % (1 << 40);
        let (mut host, mut current) = (host0, mtime0);
        let mut bounded = time::IdlePacer::new(host, current, HZ);
        bounded.set_max_busy_lag_ticks(bound);
        let mut free = time::IdlePacer::new(host, current, HZ);
        let mut legacy = R2LegacyPacer::new(host, current, HZ);
        let (mut free_now, mut jumped, mut waited_ns, mut busy) = (current, 0u64, 0u64, 0u64);
        let mut last_host = host;
        for _ in 0..400 {
            let worked = !never_works && next() % 3 == 0;
            // Work costs guest ticks and (much more) host time; waiting costs host time only.
            let step_ns = match (worked, next() % 6) {
                (true, _) => next() % 400_000_000,
                (false, 0) => 0,
                (false, 1) => next() % 3_000_000_000,
                (false, _) => next() % 30_000_000,
            };
            host += step_ns;
            let work_ticks = if worked { 300 + next() % 20_000 } else { next() % 200 };
            current += work_ticks;
            free_now += work_ticks;
            let ahead = match next() % 4 {
                0 => 1 + next() % 500,
                1 => 1 + next() % 50_000,
                _ => 1 + next() % 40_000_000,
            };
            let got = bounded.limit_deadline_after(host, current, current + ahead, worked);
            // The same guest, same deadline distance, without a bound.
            let free_got = free.limit_deadline_after(host, free_now, free_now + ahead, worked);
            // The host clock's value in guest ticks (no forgetting): the old pacer's ceiling.
            let ceiling = legacy.limit_deadline(host, 0, u64::MAX);
            assert!(got >= current && got <= current + ahead, "seed {seed}");
            assert!(
                got <= current.max(ceiling),
                "seed {seed}: an idle jump passed the host clock: {got} > {ceiling}"
            );
            if worked {
                busy += 1;
            } else {
                waited_ns += host - last_host;
            }
            last_host = host;
            jumped += got - current;
            current = got;
            free_now = free_got;
            steps += 1;
            if never_works {
                assert_eq!(got, free_got, "seed {seed}: waiting only, bound {bound}");
            }
            assert!(
                jumped <= ticks(waited_ns) + busy * bound + steps,
                "seed {seed} bound {bound}: jumped {jumped} ticks > waited {} + {busy} x bound",
                ticks(waited_ns)
            );
            assert!(bounded.owed_wait_ticks() <= ticks(host - host0), "seed {seed}");
        }
        assert!(current <= free_now, "seed {seed}: a bound never gives MORE time");
    }
    // Extremes: no panic, no rewind (debug overflow checks are on in this profile).
    let mut p = time::IdlePacer::new(0, u64::MAX - 5, 10_000_000_000);
    p.set_max_busy_lag_ticks(u64::MAX - 1);
    for (h, c, d, w) in [
        (u64::MAX, u64::MAX - 5, u64::MAX - 1, false),
        (0, u64::MAX - 4, u64::MAX, true),
        (u64::MAX, u64::MAX - 1, u64::MAX, true),
        (5, u64::MAX, 0, false),
    ] {
        let got = p.limit_deadline_after(h, c, d, w);
        assert!(got >= c);
        let _ = (p.ticks_until(d), p.owed_wait_ticks(), p.waiting());
    }
    std::eprintln!("R2 NV2: {steps} consultations");
}

// ────────── Tests written after the mutation run, for mutants nobody's test killed ──────────
// (see sabotage.log: K2, M10, M13, M6, M3). Each states a behaviour of the round-2 code that
// neither the worker's 15 tests nor the round-1 verifier's 19 pin. All pass at this head.

fn r2_to_wfi(m: &mut Machine) {
    while crate::bus::Bus::load32(&mut m.bus, m.hart.regs.pc).unwrap() != WFI {
        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
    }
}

/// K2 (`limited < d` -> `<=`). A timer that is armed but not enabled wakes nothing. Once the
/// paced clock reaches its deadline the guest spins as it always has: the run call uses its
/// budget ("a run call that returns early when nothing is waiting", task attack list).
#[test]
fn r2_k2_a_reached_deadline_that_wakes_nothing_does_not_end_the_run() {
    for l in V_LOOPS {
        let g = R2Guest {
            first: 20_000,
            mie: 0x8, // MSIE only: the timer is armed, MTIE is off
            work: 0,
            uart_fcr: None,
            ..R2Guest::WAKE
        };
        let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, None);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        // The deadline is in the paced future, so it is reported (it will wake nothing).
        let wait = m.take_idle_wait_nanos().expect("a deadline ahead");
        let d = v_mtimecmp(&m);
        host.advance(wait + R2_MS);
        let before = r2_retired(&m);
        assert_eq!(m.run(5_000), RunOutcome::MaxInstrs);
        assert_eq!(r2_retired(&m) - before, 5_000, "{l:?}: no early return");
        assert_eq!(m.take_idle_wait_nanos(), None, "{l:?}");
        assert!(v_mtime(&m) >= d && v_ints(&m) == 0, "{l:?}");
    }
}

/// M10 (owed waiting time not capped by what the host clock is ahead by). Host time that
/// passes at a wait while the guest's own clock is AHEAD of the host clock is not owed to
/// it: a later busy stretch, with the host clock then far ahead, skips exactly one bound.
#[test]
fn r2_m10_waiting_while_ahead_of_the_host_clock_earns_no_credit() {
    const BOUND: u64 = 2 * R2_MS;
    for l in V_LOOPS {
        let g = R2Guest {
            busy: 10_000,
            work: 3_000,
            uart_fcr: None,
            ..R2Guest::WAKE
        };
        let R2Rig { mut m, host } = r2_m_rig(&g, 1, l, Some(BOUND));
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert!(m.take_idle_wait_nanos().is_some());
        let lead = v_mtime(&m);
        assert!(lead > 40_000, "{l:?}: 4 ms ahead of a host clock that has not moved");
        // 3 ms pass at the wait: one idle pass, and nothing to hand over (the guest is ahead).
        host.advance(3 * R2_MS);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(v_mtime(&m), lead + 5, "{l:?}: five retirements, no jump");
        assert!(m.take_idle_wait_nanos().is_some());
        // A host wake; the handler works 12,000 instructions while the host clock runs 1 s on.
        host.step.set(V_SEC);
        r2_msip(&m);
        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        host.step.set(0);
        r2_to_wfi(&mut m);
        assert_eq!(x(&m, 26), 1);
        let before = v_mtime(&m);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(
            v_mtime(&m),
            before + 1 + v_ticks(BOUND),
            "{l:?}: one bound, not the bound plus the 3 ms"
        );
    }
}

/// M13 (`load_resume` does not start a new worked/waited interval). After a restore the host
/// time until a `wfi` the restored guest reaches within the idle-spin threshold is waiting
/// time, whatever the replaced guest had retired since its last consultation.
#[test]
fn r2_m13_a_restore_starts_a_new_worked_or_waited_interval() {
    for l in V_LOOPS {
        let g = R2Guest {
            busy: 1_500,
            work: 0,
            uart_fcr: None,
            ..R2Guest::WAKE
        };
        let R2Rig { mut m, host } = r2_m_rig(&g, 10, l, Some(0));
        r2_to_wfi(&mut m);
        assert!(r2_retired(&m) > IDLE_SPIN_INSTRS, "{l:?}: busy since the clock was selected");
        let blob = m.save_resume().unwrap();
        m.load_resume(&blob).unwrap();
        m.rebase_guest_clock(); // what a host does after a restore
        let t = v_mtime(&m);
        host.advance(3 * V_SEC);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(m.irq_stats().wfi, 1, "{l:?}");
        assert_eq!(v_mtime(&m), t + v_ticks(3 * V_SEC), "{l:?}: three seconds of waiting");
    }
}

/// M6 (STIP level term). A built-in-SBI guest whose S-timer comes due INSIDE the `wfi`'s own
/// block (by retirement) while a machine-timer compare is still ahead: `mip.STIP` is stale at
/// the `wfi`, the pacer is consulted for the machine deadline, and no wait may be reported —
/// the S-timer interrupt is taken at the next boundary.
#[test]
fn r2_m6_no_wait_when_the_s_timer_came_due_inside_the_wfi_block() {
    const EID_TIME: u64 = 0x5449_4D45;
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, STVEC, 6));
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, 100_000_000));
    a.ws(&li32(21, 1_000_000_000));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]); // mtimecmp 10 s out (never enabled)
    a.ws(&[addi(7, 0, 0x20), csrrs(0, SIE, 7)]);
    a.ws(&[addi(7, 0, 0x2), csrrs(0, SSTATUS, 7)]);
    a.la(17, EID_TIME);
    a.w(addi(16, 0, 0));
    a.ws(&[csrrs(10, TIME, 0), addi(10, 10, 30), ECALL]); // S-timer 30 ticks out
    a.jal(0, "go");
    a.label("go");
    a.ws(&[addi(15, 15, 1); 60]); // divider 1: the deadline passes in here
    a.w(WFI);
    a.label("loop");
    a.ws(&[addi(19, 19, 1), WFI]);
    a.jal(0, "loop");
    a.org(BASE + 0x1000);
    a.label("handler");
    a.ws(&[addi(31, 31, 1), csrrs(10, TIME, 0), add(10, 10, 21), ECALL, SRET]);
    let image = a.finish();
    for l in V_LOOPS {
        for budget in [1u64, 1_000_000] {
            let at = alloc::format!("{l:?} budget={budget}");
            let R2Rig { mut m, host: _ } = r2_rig(&image, &Cfg::s_mode(1), l, None);
            let mut wait = None;
            while m.irq_stats().wfi == 0 {
                assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                wait = m.take_idle_wait_nanos();
            }
            if budget == 1 {
                let c = *m.clint.as_ref().unwrap().borrow();
                assert!(c.mtime >= m.sbi_state.stimecmp, "{at}: the S-timer is due");
                assert!(c.mtimecmp > c.mtime, "{at}: a machine deadline is ahead");
                assert_eq!(x(&m, 31), 0, "{at}: not taken yet");
                assert_eq!(wait, None, "{at}: a wait with the S-timer deliverable");
                assert_eq!(m.run(1), RunOutcome::MaxInstrs);
                assert_eq!(v_ints(&m), 1, "{at}: taken at the next boundary");
            } else {
                assert_eq!(x(&m, 31), 1, "{at}: handled within the call");
                assert!(wait.is_some() && m.irq_stats().wfi == 2, "{at}: the next wfi waits");
            }
        }
    }
}

/// M3 (`sync_sbi_timer` after the wake moved `mtime`). S-mode, interrupts globally masked: a
/// host event ends a wait the host overslept past the S-timer deadline. The wake puts guest
/// time at the deadline, so the instruction after the `wfi` must read STIP pending in `sip`
/// together with the event (SEIP) and the deadline in `time`.
#[test]
fn r2_m3_masked_s_mode_wake_at_the_deadline_shows_stip() {
    const EID_TIME: u64 = 0x5449_4D45;
    const R2_SIP: u32 = 0x144;
    let mut a = Asm::new();
    a.la(8, UART);
    a.la(9, R2_PLIC + 0x20_1000);
    a.la(12, R2_PLIC);
    a.la(13, R2_PLIC + 0x2080);
    a.ws(&[addi(5, 0, 1), sw(5, 12, 0x28)]);
    a.ws(&[addi(5, 0, 0x400), sw(5, 13, 0)]);
    a.w(sw(0, 9, 0));
    a.ws(&[addi(5, 0, 1), sb(5, 8, 2), sb(5, 8, 1)]);
    a.ws(&li32(20, 20_000));
    a.la(17, EID_TIME);
    a.w(addi(16, 0, 0));
    a.ws(&[csrrs(10, TIME, 0), add(10, 10, 20), ECALL]);
    a.ws(&[addi(7, 0, 0x220), csrrs(0, SIE, 7)]); // SEIE | STIE; sstatus.SIE stays off
    a.w(WFI);
    a.ws(&[csrrs(5, R2_SIP, 0), csrrs(18, TIME, 0), addi(19, 19, 1)]);
    a.w(JDOT);
    let image = a.finish();
    let cfg = Cfg {
        uart: true,
        ..Cfg::s_mode(10)
    };
    for l in V_LOOPS {
        let R2Rig { mut m, host } = r2_rig(&image, &cfg, l, Some(50 * R2_MS));
        host.advance(R2_MS);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        let wait = m.take_idle_wait_nanos().expect("waiting");
        let d = m.sbi_state.stimecmp;
        host.advance(wait + 2 * V_SEC);
        r2_push(&m, b"k");
        assert_eq!(m.run(3), RunOutcome::MaxInstrs);
        assert_eq!((v_ints(&m), x(&m, 19)), (0, 1), "{l:?}: no trap, went on");
        assert_eq!(x(&m, 18), d, "{l:?}: time == the deadline");
        assert_eq!(x(&m, 5) & 0x220, 0x220, "{l:?}: sip shows SEIP and STIP: {:#x}", x(&m, 5));
    }
}
