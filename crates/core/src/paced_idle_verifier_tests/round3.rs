// ─────────────────────────────────────────────────────────────────────────────────────────────
// E5-T37a — the ROUND 3 VERIFIER's tests (verdict `needs-evidence`, commit 21f6a8413). Written
// by a fresh critic session, not the worker and not the round-1 or round-2 verifier: own guests,
// own host clocks, own parameters. Every test name starts `r3_`.
//
// Source: evidence/e5-t37a/verifier-r3/verifier_r3_tests.rs (sha256 e63ecd55b7cc).
// Part of the suite since the task's `verified` verdict (round 5, 2026-11-26): promoted from
// `evidence/` by the ROUND 5 verifier with evidence/e5-t37a/verifier-r5/promote.py.
// `include!`d by `../turbo_equivalence_tests.rs`, in order round1, round2, round3, round4:
// each file uses that module's assembler and helpers and those of the files before it (rounds
// 1 and 2 also use `R3Vouch` and `r3_levels` from round3.rs). None of these tests has
// `paced_idle` in its path, so the task's acceptance command
// `cargo test -p wasm-vm-core --lib paced_idle` selects the worker's tests only, as before.
//
// The round-3 contract: "a reported wait is always true; a true wait is not always reported".
// SAFETY tests fail on any reported wait that something other than the host can end before its
// deadline. COMPLETENESS tests say when a true wait is reported and when it is not.
//
// Nothing differs from the source below this header (the promoting verifier, round 5, wrote
// the header only; the source was already rustfmt- and clippy-clean).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/// The four ways the run loop executes a block: the three block-sampled flavours of the earlier
/// rounds, and legacy per-instruction sampling (interrupt batching off).
#[derive(Clone, Copy, Debug, PartialEq)]
enum R3Loop {
    PerOp,
    General,
    Batched,
    Turbo,
}
const R3_LOOPS: [R3Loop; 4] = [
    R3Loop::PerOp,
    R3Loop::General,
    R3Loop::Batched,
    R3Loop::Turbo,
];
fn r3_set_loop(m: &mut Machine, l: R3Loop) {
    v_set_loop(
        m,
        match l {
            R3Loop::PerOp | R3Loop::General => VLoop::General,
            R3Loop::Batched => VLoop::Batched,
            R3Loop::Turbo => VLoop::Turbo,
        },
    );
    m.set_interrupt_batching(l != R3Loop::PerOp);
}

const R3_HOST0: u64 = 11 * V_SEC;
const R3_WALL0: u64 = 1_000_000;

/// A wall clock for the RTC that moves by being read: an armed alarm fires after a number of
/// run-loop polls, with no host call and whatever the paced host clock does.
struct R3Wall {
    now: alloc::rc::Rc<core::cell::Cell<u64>>,
    step: u64,
}
impl dev::rtc::WallClock for R3Wall {
    fn now_ns(&self) -> u64 {
        let now = self.now.get();
        self.now.set(now + self.step);
        now
    }
}

struct R3Rig {
    m: Machine,
    host: VClock,
    wall: Option<alloc::rc::Rc<core::cell::Cell<u64>>>,
}

#[derive(Clone, Copy)]
struct R3Setup {
    cfg: Cfg,
    /// `Some(step)`: attach the RTC on a wall clock that advances `step` ns per reading.
    rtc_step: Option<u64>,
    lag: Option<u64>,
    /// Host-clock ticks per reading (0: it moves only when the test moves it).
    host_step: u64,
}
impl R3Setup {
    fn m(div: u64, uart: bool) -> Self {
        Self {
            cfg: Cfg {
                uart,
                ..Cfg::m_mode(div)
            },
            rtc_step: None,
            lag: None,
            host_step: 0,
        }
    }
}

fn r3_rig(image: &[u8], s: &R3Setup, l: R3Loop, yield_to_host: bool) -> R3Rig {
    let mut m = machine(&s.cfg, image, true);
    r3_set_loop(&mut m, l);
    let wall = s.rtc_step.map(|step| {
        let now = alloc::rc::Rc::new(core::cell::Cell::new(R3_WALL0));
        m.enable_rtc(alloc::boxed::Box::new(R3Wall {
            now: alloc::rc::Rc::clone(&now),
            step,
        }));
        now
    });
    let host = VClock::at(R3_HOST0, s.host_step * V_TICK_NS);
    m.set_paced_icount_clock(host.boxed()).unwrap();
    m.set_paced_idle_policy(yield_to_host, s.lag);
    R3Rig { m, host, wall }
}

/// M-mode guest with real device work. PLIC sources 10 (UART) and 11 (RTC) routed to the M
/// context; the machine timer armed `first` ticks out and re-armed `rearm` ticks out by its
/// handler, which powers off at the `stop`-th timer interrupt. Idle pass:
/// `addi x19; [lbu LSR]; jal | [sd; ld;] wfi | jal`.
///
/// Handler, by cause: timer -> x31 += 1; software -> clears msip, x26 += 1; external -> claim;
/// RTC: clear its interrupt, re-arm `rtc` ns ahead while x24 > 0, x27 += 1; UART: read IIR (which
/// clears a THRE cause) and, for a receive cause, RBR (and echo it to THR), x30 += 1; complete.
/// Then `work` passes of a four-instruction loop.
#[derive(Clone, Copy)]
struct R3Guest {
    first: u32,
    rearm: u32,
    stop: i32,
    work: u32,
    /// `(FCR, IER)` written to the UART.
    uart: Option<(u32, u32)>,
    echo: bool,
    /// Read the UART line status in every idle pass, in the block before the `wfi`'s.
    poll: bool,
    /// The `wfi` is the third op of its block (`sd; ld; wfi`) instead of the first.
    mid: bool,
    /// Arm an RTC alarm this many wall nanoseconds ahead.
    rtc: Option<u32>,
    rtc_rearms: i32,
}
impl R3Guest {
    const IDLE: Self = Self {
        first: 100_000_000,
        rearm: 100_000_000,
        stop: 1_000,
        work: 0,
        uart: None,
        echo: false,
        poll: false,
        mid: true,
        rtc: None,
        rtc_rearms: 0,
    };
}

fn r3_image(g: &R3Guest) -> Vec<u8> {
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(8, UART);
    a.la(9, R2_PLIC + 0x20_0000);
    a.la(11, DATA);
    a.la(12, CLINT);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.la(15, R2_RTC);
    a.ws(&li32(20, g.first));
    a.ws(&li32(21, g.rearm));
    a.ws(&li32(22, g.work));
    a.w(addi(10, 0, g.stop));
    a.w(addi(24, 0, g.rtc_rearms));
    if g.uart.is_some() || g.rtc.is_some() {
        a.la(7, R2_PLIC);
        a.ws(&[addi(5, 0, 1), sw(5, 7, 0x28), sw(5, 7, 0x2C)]); // priority[10], priority[11]
        a.la(7, R2_PLIC + 0x2000);
        a.ws(&li32(5, 0xC00));
        a.w(sw(5, 7, 0)); // the M context enables sources 10 and 11
        a.w(sw(0, 9, 0)); // threshold 0
    }
    if let Some((fcr, ier)) = g.uart {
        a.ws(&li32(5, fcr));
        a.w(sb(5, 8, 2));
        a.ws(&li32(5, ier));
        a.w(sb(5, 8, 1));
    }
    if let Some(delta) = g.rtc {
        a.ws(&li32(23, delta));
        a.ws(&[addi(5, 0, 1), sw(5, 15, 0x10)]); // IRQ_ENABLED
        a.ws(&[
            lw(5, 15, 0),
            add(5, 5, 23),
            sw(0, 15, 0x0c),
            sw(5, 15, 0x08),
        ]);
    }
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.ws(&li32(7, 0x888)); // MEIE | MTIE | MSIE
    a.w(csrrs(0, MIE, 7));
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.label("loop");
    a.w(addi(19, 19, 1));
    if g.poll {
        a.w(lbu(18, 8, 5));
    }
    a.jal(0, "idle");
    a.label("idle");
    if g.mid {
        a.ws(&[sd(19, 11, 0), ld(17, 11, 0)]);
    }
    a.w(WFI);
    a.jal(0, "loop");
    a.org(BASE + 0x1000);
    a.label("handler");
    a.ws(&[csrrs(28, MCAUSE, 0), andi(28, 28, 0xF), addi(29, 0, 7)]);
    a.branch(BEQ, 28, 29, "timer");
    a.w(addi(29, 0, 3));
    a.branch(BEQ, 28, 29, "soft");
    a.ws(&[lw(5, 9, 4), addi(29, 0, 11)]); // claim
    a.branch(BEQ, 5, 29, "rtc");
    a.ws(&[lbu(16, 8, 2), andi(1, 16, 4)]); // IIR; receive causes have bit 2
    a.branch(BEQ, 1, 0, "extdone");
    a.w(lbu(16, 8, 0)); // RBR
    if g.echo {
        a.w(sb(16, 8, 0)); // THR
    }
    a.label("extdone");
    a.ws(&[sw(5, 9, 4), addi(30, 30, 1)]);
    a.jal(0, "work");
    a.label("rtc");
    a.w(sw(0, 15, 0x1c)); // CLEAR_INTERRUPT
    a.branch(BEQ, 24, 0, "rtcdone");
    a.w(addi(24, 24, -1));
    a.ws(&[
        lw(16, 15, 0),
        add(16, 16, 23),
        sw(0, 15, 0x0c),
        sw(16, 15, 0x08),
    ]);
    a.label("rtcdone");
    a.ws(&[sw(5, 9, 4), addi(27, 27, 1)]);
    a.jal(0, "work");
    a.label("soft");
    a.ws(&[sw(0, 12, 0), addi(26, 26, 1)]);
    a.jal(0, "work");
    a.label("timer");
    a.w(addi(31, 31, 1));
    a.branch(BEQ, 31, 10, "off");
    a.ws(&[ld(5, 14, 0), add(5, 5, 21), sd(5, 13, 0)]);
    a.label("work");
    a.w(add(25, 22, 0));
    a.branch(BEQ, 25, 0, "done");
    a.label("spin");
    a.ws(&[addi(4, 4, 3), xor(1, 1, 4), addi(25, 25, -1)]);
    a.branch(BNE, 25, 0, "spin");
    a.label("done");
    a.w(MRET);
    a.label("off");
    a.poweroff();
    a.finish()
}

// ───────────────────── What "has to wait" means, from device state alone ─────────────────────

/// The interrupt levels a boundary samples, read from the devices themselves (never from
/// `fresh_mip`): CLINT `msip` and `mtime >= mtimecmp`, the built-in SBI timer, the PLIC's two
/// contexts.
fn r3_levels(m: &Machine) -> u64 {
    let mut pending = 0u64;
    if let Some(clint) = &m.clint {
        let c = *clint.borrow();
        pending |= u64::from(c.msip) << 3;
        pending |= u64::from(c.mtime >= c.mtimecmp) << 7;
        pending |= u64::from(m.builtin_sbi && c.mtime >= m.sbi_state.stimecmp) << 5;
    }
    if let Some(plic) = &m.plic {
        let p = plic.borrow();
        pending |= u64::from(p.eip(0)) << 11;
        pending |= u64::from(p.eip(1)) << 9;
    }
    pending
}

/// The nearest timer deadline that is ahead of `mtime`.
fn r3_deadline(m: &Machine, mtime: u64) -> Option<u64> {
    let c = *m.clint.as_ref().unwrap().borrow();
    let mut nearest: Option<u64> = None;
    for cmp in [c.mtimecmp, m.sbi_state.stimecmp] {
        if cmp != u64::MAX && cmp > mtime {
            nearest = Some(nearest.map_or(cmp, |d| d.min(cmp)));
        }
    }
    nearest
}

/// The architectural half of "the `wfi` that just retired has to wait": no enabled interrupt
/// pending as `mip` was last sampled, none per the levels the next boundary samples, and the
/// nearest deadline that was ahead when the `wfi` retired is still ahead.
fn r3_arch_waits(m: &Machine, mtime_at_wfi: u64) -> bool {
    !m.hart.csr.mip_and_mie_nonzero()
        && r3_levels(m) & m.hart.csr.mie_bits() == 0
        && r3_deadline(m, mtime_at_wfi).is_some_and(|d| v_mtime(m) < d)
}

/// Device work that can raise an interrupt on a schedule of its own: the UART's character
/// timeout running, an RTC alarm armed.
fn r3_uart_running(m: &Machine) -> bool {
    m.uart
        .as_ref()
        .is_some_and(|(u, _)| u.borrow().ticks_until_timeout().is_some())
}
fn r3_rtc_armed(m: &Machine) -> bool {
    m.rtc
        .as_ref()
        .is_some_and(|(r, _)| r.borrow().alarm_armed())
}

/// What must be true of the machine itself whenever it reports a wait.
fn r3_assert_quiet(m: &Machine, at: &str) {
    assert!(
        !r3_uart_running(m),
        "{at}: FALSE WAIT — the UART's character timeout is running"
    );
    assert!(!r3_rtc_armed(m), "{at}: FALSE WAIT — an RTC alarm is armed");
    assert!(
        !m.hart.csr.mip_and_mie_nonzero() && r3_levels(m) & m.hart.csr.mie_bits() == 0,
        "{at}: FALSE WAIT — an enabled interrupt is pending or about to be (mip {:#x}, levels \
         {:#x}, mie {:#x})",
        m.hart.csr.mip_bits(),
        r3_levels(m),
        m.hart.csr.mie_bits()
    );
}

/// The harness's own copy of the quiescence rule for ONE run call of the subject, kept from
/// the control as it replays that call one work slot at a time. It starts unset. At every slot
/// that begins at a sampled boundary (the control stands at a block boundary; any slot with
/// per-instruction sampling) where the copy is not valid for the fabric access counter as the
/// harness reads it, a full device pass runs: it finds the devices idle iff the UART's timeout
/// clock was not running before the slot and no RTC alarm is armed after it (an op that then
/// touches either device moves the counter, which decides alone). The subject's call can vouch
/// for the devices at a `wfi` iff the copy is valid for the counter as it stands after it.
///
/// Nothing here reads the subject, or the machine's own marker (`fabric_idle_epoch`).
#[derive(Default)]
struct R3Vouch {
    at: Option<u64>,
    /// The call has passed a sampled boundary.
    sampled: bool,
    full_pass: Option<(u64, bool)>,
}
impl R3Vouch {
    fn before_slot(&mut self, control: &Machine, per_op: bool) {
        let at_boundary = per_op || resume_point(control).is_none();
        self.sampled |= at_boundary;
        let epoch = control.fabric_epoch.get();
        self.full_pass =
            (at_boundary && self.at != Some(epoch)).then(|| (epoch, r3_uart_running(control)));
    }
    fn after_slot(&mut self, control: &Machine) {
        if let Some((epoch, uart_running)) = self.full_pass.take() {
            let idle = !uart_running && !r3_rtc_armed(control);
            self.at = idle.then_some(epoch);
        }
    }
    fn vouches(&self, control: &Machine) -> bool {
        self.at == Some(control.fabric_epoch.get())
    }
}

#[derive(Default)]
struct R3Tally {
    configs: u64,
    calls: u64,
    control_steps: u64,
    yields: u64,
    /// Waiting `wfi`s not reported because the subject's call had sampled no boundary yet.
    unsampled: u64,
    /// ... because a device had work at the last full pass or was accessed since.
    busy: u64,
    probes: u64,
    probe_slots: u64,
    events: u64,
}

/// More block boundaries than the UART's 1024-boundary character timeout.
const R3_PROBE_BOUNDARIES: u64 = 1_100;
const R3_PROBE_SLOTS: u64 = 60_000;

/// The behavioural SAFETY oracle. A machine without the idle yield is put in the state at which
/// the subject reported a wait (the control's resume bytes), its host clock is frozen, and it
/// runs on by itself, with no host call but `run`, past more block boundaries than any device
/// here needs to raise an interrupt. Before guest time reaches the deadline it may take none.
///
/// Only for guests whose code after a `wfi` is an idle loop that asks nothing of a device (a
/// guest that goes on to raise its own interrupt is not being woken).
fn r3_probe(
    at: &str,
    build: &dyn Fn(R3Loop, bool) -> R3Rig,
    control: &mut R3Rig,
    per_op: bool,
) -> u64 {
    let blob = control.m.save_resume().unwrap();
    let mut p = build(
        if per_op {
            R3Loop::PerOp
        } else {
            R3Loop::General
        },
        false,
    );
    if let (Some(wall), Some(from)) = (&p.wall, &control.wall) {
        wall.set(from.get());
    }
    p.m.load_resume(&blob).unwrap();
    p.m.set_paced_icount_clock(VClock::at(control.host.now.get(), 0).boxed())
        .unwrap();
    let deadline = r3_deadline(&p.m, v_mtime(&p.m))
        .unwrap_or_else(|| panic!("{at}: a wait was reported with no deadline ahead"));
    let ints = v_ints(&p.m);
    let (mut slots, mut boundaries) = (0u64, 0u64);
    while slots < R3_PROBE_SLOTS && boundaries < R3_PROBE_BOUNDARIES && v_mtime(&p.m) < deadline {
        boundaries += u64::from(per_op || resume_point(&p.m).is_none());
        assert_eq!(p.m.run(1), RunOutcome::MaxInstrs, "{at}: probe");
        slots += 1;
        assert_eq!(
            v_ints(&p.m),
            ints,
            "{at}: FALSE WAIT — with the host clock frozen and nothing delivered the guest took \
             an interrupt {slots} work slots after the reported wait (mcause {:#x}, mtime {} < \
             deadline {deadline})",
            p.m.hart.csr.mcause,
            v_mtime(&p.m)
        );
    }
    if v_mtime(&p.m) < deadline {
        r3_assert_quiet(&p.m, at);
    }
    slots
}

fn r3_rng(seed: u64) -> impl FnMut() -> u64 {
    let mut s = seed.wrapping_mul(0xA24B_AED4_963E_E407) | 1;
    move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    }
}

/// How one lockstep run is driven.
#[derive(Clone, Copy)]
struct R3Drive<'a> {
    loops: &'a [R3Loop],
    budgets: &'a [u64],
    /// `Some(seed)`: the harness is the host. Between calls it either lets host time pass or
    /// delivers an event (a UART byte, `msip`) to both machines — never both in one gap, and
    /// the host clock does not move by being read, so the wake accounting of a taken wait has
    /// no time to hand over and the two machines must stay equal.
    host: Option<u64>,
    /// Run the behavioural probe at sampled reported waits.
    probe: bool,
    /// Stop a configuration after this many control work slots (or at the guest's poweroff).
    max_steps: u64,
}

/// Lockstep with a predicate of my own for the round-3 contract, asserted in BOTH directions,
/// plus direct device-state checks and the behavioural probe at reported waits.
///
/// The subject (paced, yield ON) is given `budgets` one call at a time; the control (paced,
/// yield OFF; the general loop, or per-op sampling when the subject uses it) replays every
/// subject call one work slot at a time. A `wfi` retired by the subject's call has to be
/// reported iff
///
/// * `r3_arch_waits` on the control after that slot, and
/// * the subject's call can vouch for the devices (`R3Vouch`).
///
/// Nothing is read from the subject's own bookkeeping (`idle_wait_deadline`,
/// `fabric_idle_epoch`).
fn r3_lockstep(
    label: &str,
    build: &dyn Fn(R3Loop, bool) -> R3Rig,
    drive: R3Drive<'_>,
    tally: &mut R3Tally,
) {
    for &subject_loop in drive.loops {
        let per_op = subject_loop == R3Loop::PerOp;
        let at = alloc::format!(
            "{label} loop={subject_loop:?} budgets={:?} host={:?}",
            drive.budgets,
            drive.host
        );
        let mut control = build(
            if per_op {
                R3Loop::PerOp
            } else {
                R3Loop::General
            },
            false,
        );
        let mut subject = build(subject_loop, true);
        assert!(subject.m.paced_idle_yield() && !control.m.paced_idle_yield());
        let (mut tc, mut ts) = (HashSink::new(), HashSink::new());
        let mut rng = r3_rng(drive.host.unwrap_or(1));
        let mut call = 0usize;
        let mut config_yields = 0u64;
        let steps_at_start = tally.control_steps;
        tally.configs += 1;
        loop {
            let budget = drive.budgets[call % drive.budgets.len()];
            call += 1;
            tally.calls += 1;
            let os = subject.m.run_traced(budget, &mut ts);
            let wait = subject.m.take_idle_wait_nanos();
            assert_eq!(
                subject.m.take_idle_wait_nanos(),
                None,
                "{at}: reported twice"
            );
            let target = subject.m.irq_stats().retired;
            let mut oc = RunOutcome::MaxInstrs;
            let mut slots = 0u64;
            let mut last_waits = false;
            let mut vouch = R3Vouch::default();
            loop {
                let done = match wait {
                    Some(_) => control.m.irq_stats().retired >= target,
                    None => slots == budget || oc != RunOutcome::MaxInstrs,
                };
                if done {
                    break;
                }
                assert!(
                    !last_waits,
                    "{at} call {call}: MISSED RETURN — the control retired a wfi that has to \
                     wait at retired={} and the subject ran on to {target}",
                    control.m.irq_stats().retired
                );
                vouch.before_slot(&control.m, per_op);
                let (wfis, mtime, accum) = (
                    control.m.irq_stats().wfi,
                    v_mtime(&control.m),
                    control.m.tick_accum,
                );
                oc = control.m.run_traced(1, &mut tc);
                slots += 1;
                tally.control_steps += 1;
                vouch.after_slot(&control.m);
                last_waits = false;
                if control.m.irq_stats().wfi != wfis {
                    let tick = u64::from(accum + 1 >= control.m.clock_div);
                    if r3_arch_waits(&control.m, mtime + tick) {
                        if vouch.vouches(&control.m) {
                            last_waits = true;
                        } else if vouch.sampled {
                            tally.busy += 1;
                        } else {
                            tally.unsampled += 1;
                        }
                    }
                }
            }
            match wait {
                Some(ns) => {
                    tally.yields += 1;
                    config_yields += 1;
                    assert!(
                        last_waits,
                        "{at} call {call}: EARLY RETURN — wait {ns} ns reported at \
                         retired={target} but the last retirement was not a wfi that has to wait"
                    );
                    assert!(slots <= budget, "{at} call {call}: over budget");
                    assert_eq!(os, RunOutcome::MaxInstrs, "{at}");
                    assert!(ns >= V_TICK_NS, "{at}: a wait is at least one tick");
                    r3_assert_quiet(&subject.m, &at);
                }
                None => assert!(
                    !last_waits,
                    "{at} call {call}: MISSED RETURN on the last budget slot (retired={target})"
                ),
            }
            assert_eq!(
                observe(&subject.m, &ts, os),
                observe(&control.m, &tc, oc),
                "{at} call {call} budget {budget} wait {wait:?}"
            );
            assert!(
                subject.m.bus.ram().as_bytes() == control.m.bus.ram().as_bytes(),
                "{at} call {call}: RAM"
            );
            if drive.host.is_none() {
                assert_eq!(
                    subject.host.reads.get(),
                    control.host.reads.get(),
                    "{at} call {call}: host clock readings"
                );
            }
            let sample = wait.is_some() && (config_yields <= 2 || tally.yields.is_multiple_of(61));
            if call.is_multiple_of(350) || sample || os != RunOutcome::MaxInstrs {
                assert_eq!(
                    subject.m.save_resume().unwrap(),
                    control.m.save_resume().unwrap(),
                    "{at} call {call}: resume bytes"
                );
            }
            if os != RunOutcome::MaxInstrs {
                assert!(
                    powered_off(&subject.m),
                    "{at}: ended by poweroff, got {os:?}"
                );
                break;
            }
            if sample && drive.probe {
                tally.probes += 1;
                tally.probe_slots += r3_probe(
                    &alloc::format!("{at} call {call}"),
                    build,
                    &mut control,
                    per_op,
                );
            }
            if tally.control_steps - steps_at_start >= drive.max_steps {
                break;
            }
            if drive.host.is_some() {
                match rng() % 64 {
                    0 | 1 => {
                        tally.events += 1;
                        if subject.m.uart.is_some() && !rng().is_multiple_of(4) {
                            let n = 1 + (rng() % 3) as usize;
                            let bytes = [b'a' + (rng() % 26) as u8; 3];
                            r2_push(&subject.m, &bytes[..n]);
                            r2_push(&control.m, &bytes[..n]);
                        } else {
                            r2_msip(&subject.m);
                            r2_msip(&control.m);
                        }
                    }
                    2..=9 => {
                        let ns = [0u64, 100, 1_500, 9_000, 40_000, 150_000][(rng() % 6) as usize];
                        subject.host.advance(ns);
                        control.host.advance(ns);
                    }
                    _ => {}
                }
            }
        }
    }
}

const R3_BUDGETS: [&[u64]; 6] = [&[1], &[2, 3], &[5], &[1, 9, 1, 60], &[300], &[150_000]];
const R3_LAGS: [Option<u64>; 4] = [None, Some(0), Some(900), Some(2 * V_SEC)];

/// SAFETY + COMPLETENESS on guests with real device work, the harness playing the host: UART
/// bytes (FIFO off, triggers 1/4/8/14, receive interrupt on and off, THRE echo, a guest that
/// polls the line status), `msip`, host time passing, an RTC alarm that fires on a wall clock
/// of its own. Every reported wait is one my predicate says has to be reported and none is
/// missed; state and RAM equal the yield-off control after every call; the probe at sampled
/// waits takes no interrupt.
#[test]
fn r3_s1_lockstep_with_device_work_and_a_host() {
    let guests: [(&str, R3Guest, Option<u64>); 8] = [
        (
            "trig1",
            R3Guest {
                uart: Some((0x01, 1)),
                ..R3Guest::IDLE
            },
            None,
        ),
        (
            "trig8-poll",
            R3Guest {
                uart: Some((0x81, 1)),
                poll: true,
                mid: false,
                work: 9,
                ..R3Guest::IDLE
            },
            None,
        ),
        (
            "trig14-echo",
            R3Guest {
                uart: Some((0xC1, 3)),
                echo: true,
                ..R3Guest::IDLE
            },
            None,
        ),
        (
            "fifo-off",
            R3Guest {
                uart: Some((0x00, 1)),
                mid: false,
                work: 800,
                ..R3Guest::IDLE
            },
            None,
        ),
        (
            "trig4-masked",
            R3Guest {
                uart: Some((0x41, 0)),
                ..R3Guest::IDLE
            },
            None,
        ),
        (
            "rtc",
            R3Guest {
                uart: Some((0x81, 1)),
                rtc: Some(260_000),
                rtc_rearms: 4,
                mid: false,
                ..R3Guest::IDLE
            },
            Some(700),
        ),
        (
            "rtc-mid",
            R3Guest {
                uart: Some((0x01, 1)),
                rtc: Some(90_000),
                rtc_rearms: 7,
                ..R3Guest::IDLE
            },
            Some(300),
        ),
        ("clint-only", R3Guest::IDLE, None),
    ];
    let mut tally = R3Tally::default();
    let mut n = 0usize;
    for (name, guest, rtc_step) in guests {
        let image = r3_image(&R3Guest {
            first: 3_000,
            rearm: 2_200,
            stop: 14,
            ..guest
        });
        for budgets in R3_BUDGETS {
            n += 1;
            let setup = R3Setup {
                rtc_step,
                lag: R3_LAGS[n % 4],
                ..R3Setup::m([2u64, 7, 33][n % 3], guest.uart.is_some())
            };
            let label = alloc::format!("{name} div={} lag={:?}", setup.cfg.clint_div, setup.lag);
            r3_lockstep(
                &label,
                &|l, y| r3_rig(&image, &setup, l, y),
                R3Drive {
                    loops: &R3_LOOPS,
                    budgets,
                    host: Some(0x5EED_0000 + n as u64),
                    probe: true,
                    max_steps: 120_000,
                },
                &mut tally,
            );
        }
    }
    std::eprintln!(
        "R3 S1 lockstep (host events): configs={} calls={} control_steps={} yields={} events={} \
         probes={} probe_slots={} unreported-true-waits: no-boundary-sampled={} device-busy={}",
        tally.configs,
        tally.calls,
        tally.control_steps,
        tally.yields,
        tally.events,
        tally.probes,
        tally.probe_slots,
        tally.unsampled,
        tally.busy,
    );
    assert!(tally.yields > 5_000 && tally.probes > 300 && tally.events > 2_000);
    assert!(tally.unsampled > 0 && tally.busy > 0);
}

/// The same harness with no host: the host clock moves by being read (so the two machines'
/// reading counts are compared too), on the earlier rounds' guests at seeds and parameters of
/// mine and on my RTC guest, whose alarm fires by itself.
#[test]
fn r3_s1_lockstep_timer_woken_guests_and_a_self_firing_alarm() {
    let mut tally = R3Tally::default();
    let mut n = 0usize;
    let pick = |n: usize| {
        (
            [2u64, 9, 37][n % 3],
            R3_LAGS[(n / 3) % 4],
            [1u64, 23, 500, 30_000][(n / 2) % 4],
            R3_BUDGETS[n % 6],
        )
    };
    let setup = |div: u64, lag, step, uart: bool, sup: bool, rtc_step| R3Setup {
        cfg: Cfg {
            uart,
            ..if sup {
                Cfg::s_mode(div)
            } else {
                Cfg::m_mode(div)
            }
        },
        rtc_step,
        lag,
        host_step: step,
    };
    // S-mode on the built-in SBI timer: the wfi opens its block.
    for (first, rearm, stop) in [(900u32, 270u32, 9), (41, 41, 19)] {
        let image = v_sbi_image(first, rearm, stop);
        for _ in 0..6 {
            n += 1;
            let (div, lag, step, budgets) = pick(n);
            let s = setup(div, lag, step, false, true, None);
            r3_lockstep(
                &alloc::format!(
                    "sbi first={first} rearm={rearm} div={div} step={step} lag={lag:?}"
                ),
                &|l, y| r3_rig(&image, &s, l, y),
                R3Drive {
                    loops: &R3_LOOPS,
                    budgets,
                    host: None,
                    probe: true,
                    max_steps: u64::MAX,
                },
                &mut tally,
            );
        }
    }
    let sbi = tally.yields;
    // M-mode: the wfi last in an inline block, and straddling a page.
    for straddle in [false, true] {
        for (first, rearm, stop, handler, pad) in [
            (520u32, 170u32, 9, 3u32, 0u32),
            (37, 37, 21, 0, 3),
            (9_000, 5, 6, 800, 1),
        ] {
            let image = v_idle_image(&VGuest {
                first,
                rearm,
                stop,
                busy: 23,
                handler,
                pad,
                extra: straddle,
                straddle,
            });
            for _ in 0..6 {
                n += 1;
                let (div, lag, step, budgets) = pick(n);
                let s = setup(div, lag, step, false, false, None);
                r3_lockstep(
                    &alloc::format!(
                        "m straddle={straddle} first={first} rearm={rearm} handler={handler} \
                         pad={pad} div={div} step={step} lag={lag:?}"
                    ),
                    &|l, y| r3_rig(&image, &s, l, y),
                    R3Drive {
                        loops: &R3_LOOPS,
                        budgets,
                        host: None,
                        probe: true,
                        max_steps: u64::MAX,
                    },
                    &mut tally,
                );
            }
        }
    }
    let m_mode = tally.yields - sbi;
    // Seeded random programs (they raise their own interrupts after a wfi: no probe).
    for seed in 31_001..=31_010u64 {
        for (image, uart) in [(v_random_image(seed), false), (r2_random_image(seed), true)] {
            n += 1;
            let (div, lag, step, budgets) = pick(n);
            let s = setup(div, lag, step, uart, false, None);
            r3_lockstep(
                &alloc::format!("random uart={uart} seed={seed} div={div} step={step} lag={lag:?}"),
                &|l, y| r3_rig(&image, &s, l, y),
                R3Drive {
                    loops: &R3_LOOPS,
                    budgets,
                    host: None,
                    probe: false,
                    max_steps: u64::MAX,
                },
                &mut tally,
            );
        }
    }
    let random = tally.yields - sbi - m_mode;
    // My guest with an RTC alarm that fires on its own wall clock, re-armed by its handler.
    for (delta, rearms, wall_step, mid) in [(150_000u32, 6, 500u64, true), (40_000, 12, 90, false)]
    {
        let image = r3_image(&R3Guest {
            first: 2_500,
            rearm: 1_900,
            stop: 12,
            uart: Some((0x81, 1)),
            rtc: Some(delta),
            rtc_rearms: rearms,
            mid,
            ..R3Guest::IDLE
        });
        for _ in 0..6 {
            n += 1;
            let (div, lag, step, budgets) = pick(n);
            let s = setup(div, lag, step, true, false, Some(wall_step));
            r3_lockstep(
                &alloc::format!("rtc delta={delta} mid={mid} div={div} step={step} lag={lag:?}"),
                &|l, y| r3_rig(&image, &s, l, y),
                R3Drive {
                    loops: &R3_LOOPS,
                    budgets,
                    host: None,
                    probe: true,
                    max_steps: u64::MAX,
                },
                &mut tally,
            );
        }
    }
    let rtc = tally.yields - sbi - m_mode - random;
    std::eprintln!(
        "R3 S1 lockstep (no host): configs={} calls={} control_steps={} yields={} (sbi {sbi}, \
         m-mode {m_mode}, random {random}, rtc {rtc}) probes={} probe_slots={} \
         unreported-true-waits: no-boundary-sampled={} device-busy={}",
        tally.configs,
        tally.calls,
        tally.control_steps,
        tally.yields,
        tally.probes,
        tally.probe_slots,
        tally.unsampled,
        tally.busy,
    );
    assert!(sbi > 300 && m_mode > 300 && random > 100 && rtc > 50);
    assert!(tally.probes > 100 && tally.unsampled > 0 && tally.busy > 0);
}

// ─────────────────────────── K1: fresh_mip is the boundary's level sync ───────────────────────────

/// On random machine states — CLINT levels, the SBI deadline, PLIC priorities, enables,
/// thresholds, lines, claims and completes in both contexts, and arbitrary stale `mip` bits
/// including the software-writable ones — `fresh_mip()` is `mip` as the three level syncs leave
/// it, computing it changes nothing, and the run loop's own boundary sync then leaves `mip` as
/// it is. With and without a CLINT, a PLIC and the built-in SBI timer.
#[test]
fn r3_k1_fresh_mip_is_the_level_sync_on_random_states() {
    let image = r3_image(&R3Guest::IDLE);
    let mut states = 0u64;
    let mut seen = [[false; 2]; 16];
    for (clint, plic, sbi) in [
        (true, true, false),
        (true, true, true),
        (true, false, false),
        (true, false, true),
        (false, true, false),
        (false, false, false),
    ] {
        let cfg = Cfg {
            uart: plic,
            ..Cfg::m_mode(if clint { 5 } else { 0 })
        };
        let mut m = machine(&cfg, &image, false);
        if sbi {
            m.enable_builtin_sbi();
        }
        let mut rng = r3_rng(0xF00D + u64::from(clint) * 4 + u64::from(plic) * 2 + u64::from(sbi));
        for _ in 0..5_000 {
            if let Some(c) = &m.clint {
                let mut c = c.borrow_mut();
                c.msip = rng().is_multiple_of(2);
                c.mtime = 1_000 + rng() % 8;
                c.mtimecmp = match rng() % 4 {
                    0 => u64::MAX,
                    _ => 1_000 + rng() % 8,
                };
            }
            m.sbi_state.stimecmp = match rng() % 4 {
                0 => u64::MAX,
                _ => 1_000 + rng() % 8,
            };
            if let Some(p) = &m.plic {
                for _ in 0..3 {
                    // Not source 10: the UART owns that line and a full pass mirrors it again.
                    let id = [1u64, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12][(rng() % 11) as usize];
                    match rng() % 6 {
                        0 => p
                            .borrow_mut()
                            .set_level(id as usize, rng().is_multiple_of(2)),
                        1 => {
                            crate::bus::Bus::store32(&mut m.bus, PLIC + 4 * id, (rng() % 4) as u32)
                                .unwrap()
                        }
                        2 => crate::bus::Bus::store32(
                            &mut m.bus,
                            PLIC + 0x2000 + 0x80 * (rng() % 2),
                            (rng() % 0x2000) as u32,
                        )
                        .unwrap(),
                        3 => crate::bus::Bus::store32(
                            &mut m.bus,
                            PLIC + 0x20_0000 + 0x1000 * (rng() % 2),
                            (rng() % 3) as u32,
                        )
                        .unwrap(),
                        4 => {
                            crate::bus::Bus::load32(
                                &mut m.bus,
                                PLIC + 0x20_0004 + 0x1000 * (rng() % 2),
                            )
                            .unwrap();
                        }
                        _ => crate::bus::Bus::store32(
                            &mut m.bus,
                            PLIC + 0x20_0004 + 0x1000 * (rng() % 2),
                            id as u32,
                        )
                        .unwrap(),
                    }
                }
            }
            // Arbitrary stale bits, the software-writable ones (SSIP, STIP, SEIP) included.
            for bit in [1u64, 3, 5, 7, 9, 11] {
                if rng().is_multiple_of(3) {
                    m.hart.csr.set_mip_bit(bit, rng().is_multiple_of(2));
                }
            }
            let stale = m.hart.csr.mip_bits();
            let hart = m.hart.to_snapshot();
            let predicted = m.fresh_mip();
            assert_eq!(m.hart.to_snapshot(), hart, "computing it changes nothing");
            assert_eq!(
                predicted & !0xAA8,
                stale & !0xAA8,
                "only level-driven bits can differ from the stale ones"
            );
            m.sync_clint();
            m.sync_plic();
            m.sync_sbi_timer();
            let synced = m.hart.csr.mip_bits();
            assert_eq!(
                synced, predicted,
                "clint={clint} plic={plic} sbi={sbi} stale={stale:#x}"
            );
            // The devices' own view: every level the machine has a source for.
            let levels = r3_levels(&m);
            let mut owned = 0u64;
            if clint {
                owned |= 0x88 | (u64::from(sbi) << 5);
            }
            if plic {
                owned |= 0xA00;
            }
            assert_eq!(predicted & owned, levels & owned);
            assert_eq!(predicted & !owned, stale & !owned);
            // And what the run loop itself does at a boundary (a full pass: the marker is
            // unset; the UART is idle) agrees.
            m.fabric_idle_epoch = None;
            m.boundary_sync();
            assert_eq!(m.hart.csr.mip_bits(), predicted, "the boundary sync");
            for (bit, seen) in seen.iter_mut().enumerate() {
                seen[(predicted >> bit & 1) as usize] = true;
            }
            states += 1;
        }
    }
    for bit in [1usize, 3, 5, 7, 9, 11] {
        assert_eq!(seen[bit], [true, true], "bit {bit} was both clear and set");
    }
    std::eprintln!("R3 K1: fresh_mip == level sync on {states} random states");
}

// ─────────────────────── SAFETY, directed: a device that owes an interrupt ───────────────────────

fn r3_x30(m: &Machine) -> u64 {
    x(m, 30)
}

/// S2. The host pushes bytes into the UART between run calls — after a wait it took, and after
/// one it left untaken. Receive interrupt on: no call reports a wait until every byte has been
/// read by the handler, in every FIFO mode (trigger reached at once; character timeout after
/// 1024 boundaries; FIFO off). Receive interrupt off: no wait while the timeout clock runs; then
/// waits resume with the bytes still unread, which nothing can turn into an interrupt.
#[test]
fn r3_s2_no_wait_while_a_pushed_uart_byte_is_unserved() {
    let mut reported = 0u64;
    let mut held_back = 0u64;
    for (fcr, ier) in [
        (0x00u32, 1u32),
        (0x01, 1),
        (0x41, 1),
        (0x81, 1),
        (0xC1, 1),
        (0x81, 0),
        (0x00, 0),
    ] {
        let image = r3_image(&R3Guest {
            uart: Some((fcr, ier)),
            ..R3Guest::IDLE
        });
        for n in [1usize, 3, 9] {
            for l in R3_LOOPS {
                for budget in [1u64, 7, 1_000_000] {
                    for taken in [true, false] {
                        let at = alloc::format!(
                            "fcr={fcr:#x} ier={ier} bytes={n} {l:?} budget={budget} taken={taken}"
                        );
                        let R3Rig { mut m, host, .. } =
                            r3_rig(&image, &R3Setup::m(10, true), l, true);
                        host.advance(V_SEC);
                        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                        if taken {
                            assert!(m.take_idle_wait_nanos().is_some(), "{at}: idle first");
                        }
                        r2_push(&m, &b"abcdefghi"[..n]);
                        // From here on the host clock stands still and nothing is delivered.
                        let mut waits = 0u64;
                        let mut calls = 0u64;
                        while waits < 3 && calls < 30_000 {
                            assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                            calls += 1;
                            let unread = 16 - m.uart.as_ref().unwrap().0.borrow().rx_free();
                            if m.take_idle_wait_nanos().is_some() {
                                waits += 1;
                                r3_assert_quiet(&m, &at);
                                if ier == 1 {
                                    assert_eq!(
                                        unread, 0,
                                        "{at}: FALSE WAIT — call {calls} reported a wait with \
                                         {unread} byte(s) the receive interrupt still owes"
                                    );
                                } else {
                                    assert_eq!(unread, n, "{at}: nobody reads them");
                                }
                            } else if unread != 0 {
                                held_back += 1;
                            }
                        }
                        assert_eq!(
                            r3_x30(&m) != 0,
                            ier == 1,
                            "{at}: the receive interrupt was taken iff it is enabled"
                        );
                        // COMPLETENESS: the wait comes back, except for the one-slot host on a
                        // block-sampled loop (its call never samples a boundary before the wfi).
                        let never = budget == 1 && l != R3Loop::PerOp;
                        assert_eq!(waits == 0, never, "{at}: waits={waits} in {calls} calls");
                        reported += waits;
                    }
                }
            }
        }
    }
    std::eprintln!(
        "R3 S2: {reported} waits reported, each with the UART quiet; {held_back} calls ended \
         with bytes unread and reported nothing"
    );
    assert!(held_back > 1_000);
}

/// S3. The UART's transmit interrupt. THR written with ETBEI on latches THRE at once: in the
/// `wfi`'s own block (the store is a fabric access) and in the block before it (the next
/// boundary mirrors the line). No wait is reported before the handler has run.
#[test]
fn r3_s3_no_wait_while_the_uart_transmit_interrupt_is_deliverable() {
    for same_block in [true, false] {
        let mut a = Asm::new();
        a.la_label(6, "handler");
        a.w(csrrw(0, MTVEC, 6));
        a.la(8, UART);
        a.la(9, R2_PLIC + 0x20_0000);
        a.la(13, CLINT + 0x4000);
        a.la(14, CLINT + 0xBFF8);
        a.ws(&li32(20, 100_000_000));
        a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
        a.la(7, R2_PLIC);
        a.ws(&[addi(5, 0, 1), sw(5, 7, 0x28)]);
        a.la(7, R2_PLIC + 0x2000);
        a.ws(&[addi(5, 0, 0x400), sw(5, 7, 0)]);
        a.w(sw(0, 9, 0));
        a.ws(&[addi(5, 0, 1), sb(5, 8, 2)]); // FIFO on
        a.ws(&li32(7, 0x880));
        a.w(csrrs(0, MIE, 7));
        a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
        // ETBEI on: THRE latches at once and is taken; x30 == 1 after it.
        a.ws(&[addi(5, 0, 2), sb(5, 8, 1)]);
        a.jal(0, "idle0");
        a.label("idle0");
        a.w(WFI); // quiet again: this one may be reported
        a.w(addi(4, 0, 0x41));
        if same_block {
            a.ws(&[addi(18, 18, 1), sb(4, 8, 0), WFI]);
        } else {
            a.w(sb(4, 8, 0));
            a.jal(0, "next");
            a.label("next");
            a.w(WFI);
        }
        a.label("loop");
        a.ws(&[addi(19, 19, 1), WFI]);
        a.jal(0, "loop");
        a.org(BASE + 0x1000);
        a.label("handler");
        a.ws(&[
            lw(5, 9, 4),
            lbu(16, 8, 2),
            sw(5, 9, 4),
            addi(30, 30, 1),
            MRET,
        ]);
        let image = a.finish();
        for l in R3_LOOPS {
            for budget in [1u64, 4, 1_000_000] {
                let at = alloc::format!("same_block={same_block} {l:?} budget={budget}");
                let R3Rig { mut m, host, .. } = r3_rig(&image, &R3Setup::m(10, true), l, true);
                host.advance(V_SEC);
                let (mut calls, mut waits) = (0u64, 0u64);
                while x(&m, 19) < 3 && calls < 5_000 {
                    assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                    calls += 1;
                    if m.take_idle_wait_nanos().is_some() {
                        waits += 1;
                        r3_assert_quiet(&m, &at);
                        let sent = m.uart.as_ref().unwrap().0.borrow().pending_output().len();
                        assert_eq!(
                            r3_x30(&m),
                            1 + sent as u64,
                            "{at}: FALSE WAIT — a transmit interrupt is owed (sent {sent})"
                        );
                    }
                }
                assert_eq!(r3_x30(&m), 2, "{at}: both transmit interrupts handled");
                // The wfi at `idle0` opens its block: reported whatever the slicing.
                assert!(waits >= 1, "{at}: {waits}");
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                assert!(
                    m.take_idle_wait_nanos().is_some(),
                    "{at}: quiet now, so it waits"
                );
            }
        }
    }
}

/// S4. An RTC alarm on a wall clock that moves by itself. While it is armed nothing is
/// reported; the alarm interrupts the guest; after the last one (not re-armed) waits resume.
#[test]
fn r3_s4_no_wait_while_an_rtc_alarm_is_armed() {
    for (delta, wall_step, rearms) in [(200_000u32, 400u64, 2i32), (30_000, 50, 5)] {
        let image = r3_image(&R3Guest {
            uart: Some((0x81, 1)),
            rtc: Some(delta),
            rtc_rearms: rearms,
            ..R3Guest::IDLE
        });
        for l in R3_LOOPS {
            for budget in [9u64, 1_000_000] {
                let at = alloc::format!("delta={delta} {l:?} budget={budget}");
                let setup = R3Setup {
                    rtc_step: Some(wall_step),
                    ..R3Setup::m(10, true)
                };
                let R3Rig { mut m, host, .. } = r3_rig(&image, &setup, l, true);
                host.advance(V_SEC);
                let (mut calls, mut waits) = (0u64, 0u64);
                while waits < 3 && calls < 400_000 {
                    assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                    calls += 1;
                    if m.take_idle_wait_nanos().is_some() {
                        waits += 1;
                        r3_assert_quiet(&m, &at);
                        assert_eq!(
                            x(&m, 27),
                            rearms as u64 + 1,
                            "{at}: FALSE WAIT — a wait before the last alarm was handled"
                        );
                    }
                }
                assert_eq!(waits, 3, "{at}: waits resume once nothing is armed");
                assert_eq!(x(&m, 31), 0, "{at}: the timer never fired");
            }
        }
    }
}

/// S5 (round 2's N5c, wider). Four different PLIC stores placed in the `wfi`'s own block make
/// the external line go up while `mip` is still stale — enabling the source, lowering the
/// threshold, raising the priority from zero, completing a claimed source whose line is still
/// high — for the M context (MEIP) and the S context (SEIP). No wait before the interrupt is
/// handled.
#[test]
fn r3_s5_no_wait_after_any_plic_store_in_the_wfi_block() {
    for kind in ["enable", "threshold", "priority", "complete"] {
        for ctx in [0u64, 1] {
            let ext = if ctx == 0 { 0x800u32 } else { 0x200 };
            let mut a = Asm::new();
            a.la_label(6, "handler");
            a.w(csrrw(0, MTVEC, 6));
            a.la(8, UART);
            a.la(9, R2_PLIC + 0x20_0000 + 0x1000 * ctx);
            a.la(12, R2_PLIC + 0x2000 + 0x80 * ctx);
            a.la(15, R2_PLIC);
            a.la(13, CLINT + 0x4000);
            a.la(14, CLINT + 0xBFF8);
            a.ws(&li32(20, 100_000_000));
            a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
            a.w(addi(4, 0, 0x400));
            a.w(addi(18, 0, 1));
            if kind != "priority" {
                a.w(sw(18, 15, 0x28));
            }
            if kind != "enable" {
                a.w(sw(4, 12, 0));
            }
            a.ws(&[
                addi(5, 0, if kind == "threshold" { 7 } else { 0 }),
                sw(5, 9, 0),
            ]);
            a.ws(&[addi(5, 0, 1), sb(5, 8, 2), sb(5, 8, 1)]); // FIFO trigger 1, IER = RX
            a.ws(&li32(7, if kind == "complete" { 0x80 } else { 0x80 | ext }));
            a.w(csrrs(0, MIE, 7));
            a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
            if kind == "complete" {
                // Claim with the external interrupt still disabled, then enable it (a CSR
                // write ends the block) and complete next to the wfi.
                a.jal(0, "claim");
                a.label("claim");
                a.w(lw(17, 9, 4));
                a.ws(&li32(7, ext));
                a.w(csrrs(0, MIE, 7));
            } else {
                a.jal(0, "go"); // a boundary: the UART's line reaches the PLIC
            }
            a.label("go");
            a.w(match kind {
                "enable" => sw(4, 12, 0),
                "threshold" => sw(0, 9, 0),
                "priority" => sw(18, 15, 0x28),
                _ => sw(17, 9, 4),
            });
            a.w(WFI);
            a.label("loop");
            a.ws(&[addi(19, 19, 1), WFI]);
            a.jal(0, "loop");
            a.org(BASE + 0x1000);
            a.label("handler");
            a.ws(&[csrrs(28, MCAUSE, 0), andi(28, 28, 0xF)]);
            a.ws(&[
                lw(5, 9, 4),
                lbu(7, 8, 0),
                sw(5, 9, 4),
                addi(30, 30, 1),
                MRET,
            ]);
            let image = a.finish();
            for l in R3_LOOPS {
                for budget in [1u64, 3, 1_000_000] {
                    let at = alloc::format!("{kind} ctx={ctx} {l:?} budget={budget}");
                    let R3Rig { mut m, host, .. } = r3_rig(&image, &R3Setup::m(10, true), l, true);
                    host.advance(V_SEC);
                    r2_push(&m, b"k"); // there before the guest programs anything
                    let (mut calls, mut waits, mut seen_up) = (0u64, 0u64, false);
                    while x(&m, 19) < 3 && calls < 5_000 {
                        assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                        calls += 1;
                        let up = m.plic.as_ref().unwrap().borrow().eip(ctx as usize);
                        seen_up |= up && m.irq_stats().wfi == 1 && r3_x30(&m) == 0;
                        if m.take_idle_wait_nanos().is_some() {
                            waits += 1;
                            r3_assert_quiet(&m, &at);
                            assert_eq!(
                                r3_x30(&m),
                                1,
                                "{at}: FALSE WAIT — reported before the external interrupt"
                            );
                        }
                    }
                    assert_eq!(
                        (r3_x30(&m), x(&m, 28)),
                        (1, 11 - 2 * ctx),
                        "{at}: handled once"
                    );
                    if budget == 1 || l == R3Loop::PerOp {
                        assert!(
                            seen_up || l == R3Loop::PerOp,
                            "{at}: the stale-mip state arose"
                        );
                    }
                    let _ = waits;
                    assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                    assert!(
                        m.take_idle_wait_nanos().is_some(),
                        "{at}: served, so it waits"
                    );
                }
            }
        }
    }
}

/// S7. The quiescence marker across a host push. The run call that ended on a wait leaves the
/// marker saying "idle"; the host then pushes a byte into the UART (no fabric access, so the
/// marker is not moved by it). A NEW RUN CALL must not report a wait off that stale marker,
/// with the first wait taken or not — the entry clear. Also measured, not asserted: what
/// `take_idle_wait_nanos()` answers when the host pushes first and asks afterwards, without
/// running in between (round 2 filed that as the host's own delivery, a follow-up).
#[test]
fn r3_s7_a_host_push_after_the_run_is_seen_before_the_next_report() {
    let image = r3_image(&R3Guest {
        uart: Some((0x81, 1)),
        ..R3Guest::IDLE
    });
    let mut asked_after_push = alloc::vec::Vec::new();
    for l in R3_LOOPS {
        for taken in [true, false] {
            let at = alloc::format!("{l:?} taken={taken}");
            let R3Rig { mut m, host, .. } = r3_rig(&image, &R3Setup::m(10, true), l, true);
            host.advance(V_SEC);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            if taken {
                assert!(m.take_idle_wait_nanos().is_some());
            }
            assert_eq!(
                m.fabric_idle_epoch,
                Some(m.fabric_epoch.get()),
                "{at}: the marker says idle after the call"
            );
            r2_push(&m, b"k");
            assert_eq!(
                m.fabric_idle_epoch,
                Some(m.fabric_epoch.get()),
                "{at}: a host push does not move it"
            );
            // The new call: 1024 boundaries of character timeout, then the interrupt, all
            // inside this one call, and only then a wait.
            let wfis = m.irq_stats().wfi;
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!(r3_x30(&m), 1, "{at}: the byte was served in this call");
            assert!(
                m.irq_stats().wfi - wfis > 100,
                "{at}: it went round its idle loop"
            );
            assert!(m.take_idle_wait_nanos().is_some(), "{at}: then it waits");
            r3_assert_quiet(&m, &at);
        }
        // Push, then ask, with no run in between.
        let R3Rig { mut m, host, .. } = r3_rig(&image, &R3Setup::m(10, true), l, true);
        host.advance(V_SEC);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        r2_push(&m, b"k");
        let answer = m.take_idle_wait_nanos();
        asked_after_push.push((l, answer, r3_uart_running(&m)));
        // Whatever it answered, a host that runs again (it knows it delivered something)
        // loses nothing: the byte is served and five slept seconds are on the guest clock.
        let t0 = v_mtime(&m);
        host.advance(5 * V_SEC);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(r3_x30(&m), 1, "{l:?}");
        assert!(v_mtime(&m) - t0 >= 50_000_000, "{l:?}: slept time kept");
    }
    std::eprintln!(
        "R3 S7 host pushes a byte and THEN asks, without running: (loop, answer in ns, UART \
         timeout clock running at that moment) = {asked_after_push:?}"
    );
}

// ───────────────────────────────── COMPLETENESS ─────────────────────────────────

/// C1 + C2. The realistic flow: every call starts at the boundary after the `wfi` the last one
/// ended on (or at some other block boundary) with a budget that reaches the next `wfi`. Every
/// such call returns early and reports, in all four loop flavours, on idle loops of one to
/// several blocks, with the `wfi` first or last in its block or straddling a page.
#[test]
fn r3_c1_a_call_from_a_block_boundary_reports_at_the_first_waiting_wfi() {
    let mut total = 0u64;
    let v = |pad, extra, straddle| {
        v_idle_image(&VGuest {
            first: 80_000_000,
            pad,
            extra,
            straddle,
            ..VGuest::IDLE
        })
    };
    let guests: [(&str, Vec<u8>, bool, bool); 6] = [
        ("m pad=0", v(0, false, false), false, false),
        ("m pad=4 extra", v(4, true, false), false, false),
        ("m straddle", v(1, false, true), false, false),
        ("sbi", v_sbi_image(80_000_000, 0, 5), true, false),
        (
            "uart idle",
            r3_image(&R3Guest {
                uart: Some((0x81, 1)),
                ..R3Guest::IDLE
            }),
            false,
            true,
        ),
        (
            "uart polled",
            r3_image(&R3Guest {
                uart: Some((0x81, 1)),
                poll: true,
                ..R3Guest::IDLE
            }),
            false,
            true,
        ),
    ];
    for (name, image, sup, uart) in &guests {
        for l in R3_LOOPS {
            for budget in [64u64, 500_000] {
                let at = alloc::format!("{name} {l:?} budget={budget}");
                let setup = R3Setup {
                    cfg: Cfg {
                        uart: *uart,
                        ..if *sup {
                            Cfg::s_mode(10)
                        } else {
                            Cfg::m_mode(10)
                        }
                    },
                    rtc_step: None,
                    lag: Some(40_000_000),
                    host_step: 0,
                };
                let R3Rig { mut m, host, .. } = r3_rig(image, &setup, l, true);
                host.advance(V_SEC);
                // Up to the first wait, however many calls the prologue takes.
                while m.irq_stats().wfi == 0 {
                    assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                }
                assert!(m.take_idle_wait_nanos().is_some(), "{at}: first wait");
                for call in 0..200 {
                    let (wfis, retired) = (m.irq_stats().wfi, m.irq_stats().retired);
                    assert!(
                        resume_point(&m).is_none(),
                        "{at}: starts at a block boundary"
                    );
                    assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                    assert_eq!(
                        m.irq_stats().wfi,
                        wfis + 1,
                        "{at} call {call}: one idle pass"
                    );
                    assert!(
                        m.irq_stats().retired - retired < budget,
                        "{at}: returned early"
                    );
                    assert!(
                        m.take_idle_wait_nanos().is_some(),
                        "{at} call {call}: reported"
                    );
                    total += 1;
                }
                // C2: from another block boundary (two slots further on in the idle pass).
                if !*sup && !name.contains("straddle") {
                    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
                    while resume_point(&m).is_some() {
                        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
                    }
                    let wfis = m.irq_stats().wfi;
                    assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                    assert_eq!(m.irq_stats().wfi, wfis + 1, "{at}: the first wfi it meets");
                    assert!(m.take_idle_wait_nanos().is_some(), "{at}");
                }
            }
        }
    }
    std::eprintln!("R3 C1: {total} of {total} calls from a block boundary reported their wait");
}

/// C3. The narrowing, characterised. With block-sampled interrupts a call reports a `wfi` only
/// if it passed a block boundary before it. A host whose calls are never longer than the
/// `wfi`'s position in its block (one or two work slots here: the `wfi` is the third op)
/// therefore never gets a report — not one pass later, never — while the same host gets one
/// at every `wfi` when the `wfi` opens its block, or with per-instruction sampling. Larger
/// fixed budgets: reported whenever the call that retires the `wfi` began at or before its
/// block's boundary.
#[test]
fn r3_c3_which_slicings_never_see_a_wait() {
    let mid = v_idle_image(&VGuest {
        first: 80_000_000,
        ..VGuest::IDLE
    }); // 6-instruction pass: addi; add; beq | sd; ld; wfi | jal
    let first = v_sbi_image(80_000_000, 0, 5); // wfi opens its block
    let mut rows = alloc::vec::Vec::new();
    for l in R3_LOOPS {
        for (name, image, sup) in [
            ("wfi-third-in-block", &mid, false),
            ("wfi-first", &first, true),
        ] {
            for budget in [1u64, 2, 3, 4, 5, 6, 7, 13] {
                let setup = R3Setup {
                    cfg: if sup {
                        Cfg::s_mode(10)
                    } else {
                        Cfg::m_mode(10)
                    },
                    rtc_step: None,
                    lag: None,
                    host_step: 0,
                };
                let R3Rig { mut m, host, .. } = r3_rig(image, &setup, l, true);
                host.advance(V_SEC);
                // Past the prologue to the first wfi, one slot at a time (reports discarded).
                while m.irq_stats().wfi == 0 {
                    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
                }
                let _ = m.take_idle_wait_nanos();
                let wfis = m.irq_stats().wfi;
                let mut reports = 0u64;
                for _ in 0..600 {
                    assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                    reports += u64::from(m.take_idle_wait_nanos().is_some());
                }
                let passes = m.irq_stats().wfi - wfis;
                rows.push(alloc::format!(
                    "{l:?} {name} budget={budget}: {reports} reports over {passes} wfis"
                ));
                // The wfi is op 2 of its block: a call of one or two slots that retires it began
                // inside that block, every time.
                let never = !sup && l != R3Loop::PerOp && budget <= 2;
                assert_eq!(
                    reports == 0,
                    never,
                    "{l:?} {name} budget={budget}: {reports}"
                );
                if l == R3Loop::PerOp || sup {
                    assert_eq!(reports, passes, "{l:?} {name} budget={budget}: every wfi");
                }
                assert_eq!(x(&m, 31), 0, "the timer is far away");
            }
        }
    }
    std::eprintln!("R3 C3:\n{}", rows.join("\n"));
}

struct R3Entropy;
impl dev::virtio::rng::EntropySource for R3Entropy {
    fn fill(&mut self, out: &mut [u8]) {
        out.fill(0x3c);
    }
}

/// A network backend that does not opt in to `NetBackend::idle` (the default): it is polled at
/// every boundary, like the slirp stack (`SlirpLocalBackend` and its wrappers do not override
/// `idle`).
struct R3PolledNet;
impl dev::virtio::net::NetBackend for R3PolledNet {
    fn tx(&mut self, _frame: &[u8]) {}
    fn rx(&mut self) -> Option<Vec<u8>> {
        None
    }
    fn rx_ready(&self) -> bool {
        false
    }
}

/// C4. Not vacuous with the ordinary device set attached and idle: PLIC, UART, RTC without an
/// alarm, virtio blk, net (loopback), rng, keyboard, tablet and mouse, sound, GPU, console. The
/// marker is set at the call's first boundary and the wait is reported.
///
/// And one class that is never reported: a network backend that does not opt in to
/// `NetBackend::idle` keeps the marker unset for good — no wait, ever, and the turbo loop never
/// engages either (a property of the quiescence marker that predates this task).
#[test]
fn r3_c4_reports_with_every_ordinary_device_attached_and_never_with_a_polled_net_backend() {
    let image = r3_image(&R3Guest {
        uart: Some((0x81, 1)),
        ..R3Guest::IDLE
    });
    for polled_net in [false, true] {
        for l in R3_LOOPS {
            let at = alloc::format!("polled_net={polled_net} {l:?}");
            let mut m = Machine::new(RAM_BYTES);
            m.enable_clint(10);
            m.enable_syscon();
            m.enable_plic();
            m.enable_virtio_blk(alloc::boxed::Box::new(block::MemBackend::new(
                alloc::vec![0; 4096],
            )));
            if polled_net {
                m.enable_virtio_net(alloc::boxed::Box::new(R3PolledNet));
            } else {
                m.enable_virtio_net(alloc::boxed::Box::new(
                    dev::virtio::net::LoopbackBackend::new(),
                ));
            }
            m.enable_virtio_rng(alloc::boxed::Box::new(R3Entropy));
            m.enable_virtio_keyboard();
            m.enable_virtio_pointer();
            m.enable_virtio_snd();
            assert!(
                m.enable_virtio_gpu(alloc::boxed::Box::new(dev::virtio::gpu::NullSink))
                    .is_some()
            );
            m.enable_virtio_console_at(8);
            m.enable_uart16550();
            m.enable_rtc(alloc::boxed::Box::new(dev::rtc::FixedClock(R3_WALL0)));
            m.hart.csr.pmp.allow_all();
            m.set_block_cache(true);
            m.bus_mut().write_ram_slice(BASE, &image).unwrap();
            m.hart.regs.pc = BASE;
            r3_set_loop(&mut m, l);
            let host = VClock::at(R3_HOST0, 0);
            m.set_paced_icount_clock(host.boxed()).unwrap();
            m.set_paced_idle_policy(true, None);
            host.advance(V_SEC);
            let mut reports = 0u64;
            for _ in 0..50 {
                let retired = m.irq_stats().retired;
                assert_eq!(m.run(20_000), RunOutcome::MaxInstrs);
                let early = m.irq_stats().retired - retired < 20_000;
                let wait = m.take_idle_wait_nanos();
                assert_eq!(wait.is_some(), early, "{at}");
                reports += u64::from(wait.is_some());
            }
            if polled_net {
                assert_eq!(reports, 0, "{at}: never quiescent, never a wait");
                assert_eq!(m.fabric_idle_epoch, None, "{at}");
                assert_eq!(m.turbo_stats().entries, 0, "{at}: nor the turbo loop");
                assert!(
                    m.irq_stats().wfi > 100_000,
                    "{at}: it spins, as before the task"
                );
            } else {
                assert_eq!(reports, 50, "{at}: every call reports");
                assert_eq!(m.fabric_idle_epoch, Some(m.fabric_epoch.get()), "{at}");
            }
        }
    }
}

// ───────────────────────────── Round 2's B4: a rebase, then a wake ─────────────────────────────

/// B4 at parameters of mine. A rebase of the host anchor after the run call that ended on a
/// wait — before or after the host takes the wait, once or several times, with sleeps the
/// rebase discards in between — and then a host event or the guest's own timer: the host time
/// slept AFTER the last rebase is on the guest clock at the handler's first instruction (a host
/// event) or by the next `wfi` (an oversleep past the deadline), with a 50 ms bound, a zero
/// bound and none, although the handler retires more than `IDLE_SPIN_INSTRS`.
#[test]
fn r3_b4_time_slept_after_a_rebase_reaches_the_guest_clock() {
    let g = R2Guest {
        work: 900,
        uart_fcr: None,
        ..R2Guest::WAKE
    };
    for l in R3_LOOPS {
        for bound in [Some(50 * R2_MS), Some(0), None] {
            for rebase_first in [true, false] {
                let at = alloc::format!("{l:?} bound={bound:?} rebase_first={rebase_first}");
                let rig = || {
                    let R2Rig { mut m, host } = r2_m_rig(&g, 10, VLoop::General, bound);
                    r3_set_loop(&mut m, l);
                    host.advance(V_SEC);
                    assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                    (m, host)
                };
                // (i)/(ii) one rebase, a host event.
                let (mut m, host) = rig();
                let deadline = v_mtimecmp(&m);
                if rebase_first {
                    host.advance(70 * V_SEC);
                    m.rebase_guest_clock();
                }
                let first = m.take_idle_wait_nanos().expect("waiting");
                let t0 = v_mtime(&m);
                assert_eq!(
                    first,
                    (deadline - t0) * V_TICK_NS,
                    "{at}: measured from the anchor"
                );
                if !rebase_first {
                    host.advance(70 * V_SEC);
                    m.rebase_guest_clock();
                }
                let reads = host.reads.get();
                host.advance(5 * V_SEC);
                r2_msip(&m);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                assert_eq!(x(&m, 26), 1, "{at}: handled");
                assert_eq!(
                    x(&m, 23),
                    t0 + 50_000_000,
                    "{at}: 5 s at the handler, not 75, not 0"
                );
                assert_eq!(
                    host.reads.get() - reads,
                    2,
                    "{at}: the wake and the next wfi"
                );
                assert_eq!(
                    m.take_idle_wait_nanos(),
                    Some(first - 5 * V_SEC),
                    "{at}: the remaining wait"
                );
                // (iii) sleeps discarded by two rebases, then one second and the event.
                let (mut m, host) = rig();
                assert!(m.take_idle_wait_nanos().is_some());
                let t0 = v_mtime(&m);
                host.advance(3 * V_SEC);
                m.rebase_guest_clock();
                host.advance(2 * V_SEC);
                m.rebase_guest_clock();
                host.advance(V_SEC);
                r2_msip(&m);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                assert_eq!(x(&m, 23), t0 + 10_000_000, "{at}: only the last second");
                // (iv) a rebase, then the host oversleeps the guest's own deadline by 2 s.
                let (mut m, host) = rig();
                let deadline = v_mtimecmp(&m);
                host.advance(9 * V_SEC);
                m.rebase_guest_clock();
                let wait = m.take_idle_wait_nanos().expect("waiting");
                host.advance(wait + 2 * V_SEC);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                assert_eq!(x(&m, 31), 1, "{at}: the timer");
                assert_eq!(x(&m, 24), deadline, "{at}: taken at its deadline");
                assert_eq!(
                    v_mtime(&m),
                    deadline + 20_000_000,
                    "{at}: the 2 s overslept are handed over after the handler worked"
                );
            }
        }
    }
}

// ─────────────────────────────── The pacer's diagnostic flag ───────────────────────────────

/// `IdlePacer::waiting()` (kept by round 3 as a diagnostic nothing in the machine reads): true
/// exactly when the last consultation left guest time short of the deadline; a rebase clears it.
#[test]
fn r3_pacer_waiting_flag_says_whether_the_last_consultation_fell_short() {
    let hz = u64::from(platform::virt::TIMEBASE_FREQ_HZ);
    let mut p = time::IdlePacer::new(0, 1_000, hz);
    assert!(!p.waiting());
    assert_eq!(p.limit_deadline_after(500, 1_000, 2_000, false), 1_005);
    assert!(p.waiting(), "short of the deadline");
    assert_eq!(p.limit_deadline_after(100_000, 1_005, 2_000, false), 2_000);
    assert!(!p.waiting(), "reached it");
    assert_eq!(p.limit_deadline_after(100_000, 2_000, 2_000, true), 2_000);
    assert!(!p.waiting(), "nothing ahead");
    assert_eq!(p.limit_deadline(100_100, 2_000, 9_000), 2_001);
    assert!(p.waiting());
    p.rebase(200_000, 2_001);
    assert!(!p.waiting(), "a rebase starts over");
}

// ────────── Tests written after the mutation run (evidence/e5-t37a/verifier-r3/sabotage.log) ──────────
// B3 and B11 are mutants of changed behaviour that neither the worker's 24 tests nor the earlier
// verifiers' 43 kill; the first and third test below do. The second pins what a zero-budget run
// call does (it turned out not to kill B7, which is an equivalent mutant: see the log). The
// fourth is acceptance bullet "a pending but disabled interrupt does not end a wait" on devices.
// All pass at head 7d25929a7.

/// B3. The S-timer coming due inside the `wfi`'s own block at every distance — including
/// EXACTLY at the `wfi`'s own retirement tick, where `mtime == stimecmp` and only `>=` in the
/// level makes the interrupt pending. The machine timer is the far deadline; `mip` is stale.
#[test]
fn r3_no_wait_when_the_s_timer_comes_due_exactly_at_the_wfi() {
    let mut a = Asm::new();
    a.ws(&[addi(7, 0, 0xA0), csrrs(0, MIE, 7)]); // MTIE | STIE
    a.ws(&[addi(15, 15, 1), addi(15, 15, 1), addi(15, 15, 1), WFI]);
    a.w(JDOT);
    let image = a.finish();
    for l in R3_LOOPS {
        for k in 1..=6u64 {
            let at = alloc::format!("{l:?} stimecmp = mtime + {k}");
            let R3Rig { mut m, .. } = r3_rig(&image, &R3Setup::m(1, false), l, true);
            m.enable_builtin_sbi();
            assert_eq!(m.run(2), RunOutcome::MaxInstrs); // addi, csrrs: at the block's entry
            let mtime = v_mtime(&m);
            m.clint.as_ref().unwrap().borrow_mut().mtimecmp = mtime + 1_000_000;
            m.sbi_state.stimecmp = mtime + k;
            assert_eq!(m.run(4), RunOutcome::MaxInstrs); // exactly the block
            assert_eq!(m.irq_stats().wfi, 1, "{at}");
            assert_eq!(
                v_mtime(&m),
                mtime + 4,
                "{at}: the host clock stands still, no jump"
            );
            let wait = m.take_idle_wait_nanos();
            if k <= 4 {
                assert_eq!(
                    wait, None,
                    "{at}: FALSE WAIT — the S-timer interrupt is due"
                );
            } else {
                // The S-timer is the nearest deadline; the ceiling is where the clock was
                // selected (guest time 0).
                assert_eq!(wait, Some((mtime + k) * V_TICK_NS), "{at}");
            }
        }
    }
}

/// A zero-budget run call is a run call: it drops a wait the host did not take (the task's
/// Boundary: "a new run call ... drop[s] it") — and it leaves a wait the host DID take to be
/// accounted when the guest is next woken.
#[test]
fn r3_a_zero_budget_call_drops_an_untaken_wait_and_keeps_a_taken_one() {
    let g = R2Guest {
        work: 900,
        uart_fcr: None,
        ..R2Guest::WAKE
    };
    for l in R3_LOOPS {
        for taken in [false, true] {
            let at = alloc::format!("{l:?} taken={taken}");
            let R2Rig { mut m, host } = r2_m_rig(&g, 10, VLoop::General, Some(50 * R2_MS));
            r3_set_loop(&mut m, l);
            host.advance(V_SEC);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            let first = if taken {
                m.take_idle_wait_nanos()
            } else {
                None
            };
            assert_eq!(first.is_some(), taken, "{at}");
            let (retired, t0, reads) = (r2_retired(&m), v_mtime(&m), host.reads.get());
            assert_eq!(m.run(0), RunOutcome::MaxInstrs);
            assert_eq!(r2_retired(&m), retired, "{at}: nothing ran");
            assert_eq!(
                m.take_idle_wait_nanos(),
                None,
                "{at}: nothing (left) to report"
            );
            // Five seconds later the host delivers an event.
            host.advance(5 * V_SEC);
            r2_msip(&m);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!(x(&m, 26), 1, "{at}: handled");
            if taken {
                assert_eq!(
                    x(&m, 23),
                    t0 + 50_000_000,
                    "{at}: the wake of the taken wait"
                );
                assert_eq!(
                    host.reads.get() - reads,
                    2,
                    "{at}: the wake and the next wfi"
                );
            } else {
                assert_eq!(
                    x(&m, 23),
                    t0,
                    "{at}: no wake is owed for a wait nobody took"
                );
                assert_eq!(host.reads.get() - reads, 1, "{at}: the next wfi only");
            }
        }
    }
}

/// B11. What a waiting guest is owed is the host time since the PREVIOUS consultation — not
/// since the pacer's anchor. A guest that fell 19 ms behind while it worked (inside the bound,
/// so the anchor stays) and then idles with the host clock standing still is owed nothing;
/// 7 ms of real waiting behind a near deadline leave it owed 6; and the next busy stretch
/// skips those 6 ms plus exactly one bound.
#[test]
fn r3_owed_time_is_the_host_time_since_the_previous_consultation() {
    const T: u64 = 10_000; // ticks per millisecond at the virt timebase
    const N: u64 = 1_000_000; // nanoseconds per millisecond
    const FAR: u64 = u64::MAX - 1;
    let mut p = time::IdlePacer::new(0, 0, u64::from(platform::virt::TIMEBASE_FREQ_HZ));
    p.set_max_busy_lag_ticks(50 * T);
    // Busy: 30 ms of host time, 10 ms of retire-derived guest time, a deadline 1 ms ahead.
    let mut now = 10 * T;
    now = p.limit_deadline_after(30 * N, now, now + T, true);
    assert_eq!(now, 11 * T);
    assert_eq!(
        p.owed_wait_ticks(),
        0,
        "what it fell behind while it worked is not owed"
    );
    // Idle passes, the host clock standing still.
    for _ in 0..3 {
        now = p.limit_deadline_after(30 * N, now, now + T, false);
        assert_eq!(
            p.owed_wait_ticks(),
            0,
            "no host time passed while it waited"
        );
    }
    assert_eq!(now, 14 * T);
    // 7 ms of waiting, of which a deadline 1 ms ahead lets 1 ms through.
    now = p.limit_deadline_after(37 * N, now, now + T, false);
    assert_eq!((now, p.owed_wait_ticks()), (15 * T, 6 * T));
    // A long busy stretch, nothing in the way: the 6 ms it is owed and one bound.
    now += 100 * T;
    assert_eq!(
        p.limit_deadline_after(10_037 * N, now, FAR, true),
        now + 6 * T + 50 * T
    );
    assert_eq!(p.owed_wait_ticks(), 0);
}

/// An interrupt that is pending but not enabled cannot end a `wfi`, so it does not hold a wait
/// back: the host raises `msip` (MSIE clear) and pushes a UART byte that the PLIC presents to
/// the M context (MEIE clear). The guest goes round its idle loop while the UART's timeout
/// clock runs, takes nothing, and then waits again with both still pending.
#[test]
fn r3_pending_but_disabled_interrupts_do_not_hold_a_wait_back() {
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(8, UART);
    a.la(9, R2_PLIC + 0x20_0000);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, 100_000_000));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.la(7, R2_PLIC);
    a.ws(&[addi(5, 0, 1), sw(5, 7, 0x28)]);
    a.la(7, R2_PLIC + 0x2000);
    a.ws(&[addi(5, 0, 0x400), sw(5, 7, 0)]);
    a.w(sw(0, 9, 0));
    a.ws(&[addi(5, 0, 1), sb(5, 8, 2), sb(5, 8, 1)]); // FIFO trigger 1, IER = RX
    a.ws(&[addi(7, 0, 0x80), csrrs(0, MIE, 7)]); // MTIE only
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.label("loop");
    a.w(addi(19, 19, 1));
    a.jal(0, "idle");
    a.label("idle");
    a.w(WFI);
    a.jal(0, "loop");
    a.org(BASE + 0x1000);
    a.label("handler");
    a.ws(&[addi(30, 30, 1), MRET]);
    let image = a.finish();
    for l in R3_LOOPS {
        let R3Rig { mut m, host, .. } = r3_rig(&image, &R3Setup::m(10, true), l, true);
        host.advance(V_SEC);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        let first = m.take_idle_wait_nanos().expect("idle");
        r2_msip(&m);
        r2_push(&m, b"k");
        let wfis = m.irq_stats().wfi;
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert!(
            m.irq_stats().wfi - wfis > 100,
            "{l:?}: no wait while the UART's timeout clock ran"
        );
        assert_eq!(
            m.take_idle_wait_nanos(),
            Some(first),
            "{l:?}: then the same wait"
        );
        assert!(r3_both_pending(&m), "{l:?}: both are still pending");
        assert_eq!((v_ints(&m), x(&m, 30)), (0, 0), "{l:?}: nothing was taken");
    }
}

/// `msip` and the M-context external line are both up.
fn r3_both_pending(m: &Machine) -> bool {
    m.clint.as_ref().unwrap().borrow().msip && m.plic.as_ref().unwrap().borrow().eip(0)
}
