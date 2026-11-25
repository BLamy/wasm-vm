
/// Round-2 verifier scratch test (E4-T40b). Appended to `crates/core/src/turbo_equivalence_tests.rs`
/// for one run, then removed (`git checkout`); it uses that file's assembler and `equivalent`.
///
/// A CSR op is a block terminator, so every block that reads `time` ends in a system op. Before
/// the rework such a block was settled on entry; now its first settle — the one that applies the
/// block boundary to the `time` shadow — is whatever comes first inside it. Each block below ends
/// in `csrr time` and makes that first settle a different thing: the CSR op itself (alone in its
/// block, and after inline ops), an inline store that hits a stale code-filter record, an inline
/// store that drops another cached block (the next instruction then starts a new block), a
/// misaligned load, a CLINT `mtime` load, and an FP op. A timer handler re-arms the deadline every
/// 53 ticks and reads `time` itself, so the loop is left at the horizon and re-entered with each
/// of those blocks as its first.
#[test]
fn verifier_r2_time_shadow_in_blocks_that_end_in_a_system_op() {
    const PMPADDR5: u32 = 0x3B5;
    const PASSES: i32 = 200;
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(8, DATA);
    a.la(20, BASE + 0x800); // a data slot on the entry code page (stale filter record later)
    a.la(21, BASE + 0x2800); // a data slot on the page that holds `leaf`
    a.la(24, CLINT + 0xBFF8); // mtime
    a.la(25, CLINT + 0x4000); // mtimecmp
    a.ws(&[ld(5, 24, 0), addi(5, 5, 50), sd(5, 25, 0), addi(5, 0, 0)]);
    a.ws(&[lui(7, 2), csrrs(0, MSTATUS, 7)]); // FS = Initial
    a.ws(&[addi(7, 0, 0x80), csrrs(0, MIE, 7)]); // MTIE
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7), addi(7, 0, 0)]); // MIE
    a.w(addi(9, 0, PASSES));
    a.jal(0, "main");
    a.org(BASE + 0x1000);
    a.label("main");
    a.w(csrrw(0, PMPADDR5, 9)); // every cached block is dropped; the filter keeps the entry page
    a.label("loop");
    a.w(csrrs(10, TIME, 0)); // alone in its block, entered from the all-inline tail block
    a.ws(&[
        addi(5, 5, 1),
        sd(5, 8, 0),
        ld(6, 8, 0),
        add(7, 7, 6),
        csrrs(11, TIME, 0), // first settle: the CSR op
    ]);
    a.ws(&[
        addi(5, 5, 1),
        sd(5, 20, 0), // first settle: a code-filter hit that drops nothing
        ld(6, 20, 0),
        add(7, 7, 6),
        csrrs(12, TIME, 0),
    ]);
    a.jal(1, "leaf");
    a.ws(&[
        addi(5, 5, 1),
        sd(5, 21, 0), // drops `leaf`'s cached block: the next instruction starts a new block
        ld(6, 21, 0),
        add(7, 7, 6),
        csrrs(13, TIME, 0),
    ]);
    a.ws(&[
        addi(5, 5, 1),
        ld(6, 8, 1), // first settle: a misaligned load
        add(7, 7, 6),
        sd(7, 8, 8),
        csrrs(15, TIME, 0),
    ]);
    a.ws(&[
        addi(5, 5, 1),
        ld(16, 24, 0), // first settle: a CLINT load (a device access)
        add(7, 7, 16),
        sd(7, 8, 16),
        csrrs(17, TIME, 0),
    ]);
    a.ws(&[
        addi(5, 5, 1),
        fmv_w_x(1, 5), // first settle: an FP op
        fadd_s(2, 2, 1),
        fmv_x_w(18, 2),
        add(7, 7, 18),
        sd(7, 8, 24),
        csrrs(19, TIME, 0),
    ]);
    a.ws(&[
        add(22, 22, 10),
        slli(23, 22, 3),
        add(22, 22, 23),
        add(22, 22, 11),
        add(22, 22, 12),
        add(22, 22, 13),
        add(22, 22, 15),
        add(22, 22, 17),
        add(22, 22, 19),
        sd(22, 8, 32),
        addi(9, 9, -1),
    ]);
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    a.org(BASE + 0x2000);
    a.label("leaf");
    a.ws(&[addi(28, 28, 1), jalr(0, 1, 0)]);
    a.org(BASE + 0x3000);
    a.label("handler");
    a.ws(&[
        csrrs(26, MEPC, 0),
        slli(27, 30, 5),
        add(30, 30, 27),
        add(30, 30, 26), // x30 = x30 * 33 + mepc
        addi(4, 4, 1),
        csrrs(26, TIME, 0),
        add(30, 30, 26), // … + `time` as the handler's block saw it
        ld(26, 24, 0),
        addi(26, 26, 53),
        sd(26, 25, 0),
        MRET,
    ]);
    let image = a.finish();
    for div in [1, 3] {
        equivalent(
            "r2-time-shadow",
            Cfg::m_mode(div),
            &image,
            400_000,
            &|m, stats, slices| {
                assert!(powered_off(m), "div={div}");
                assert_eq!(x(m, 9), 0);
                assert_eq!(x(m, 28), PASSES as u64, "`leaf` ran every pass");
                assert!(x(m, 4) > 40, "div={div}: interrupts taken: {}", x(m, 4));
                assert!(x(m, 19) > 1_000, "div={div}: `time` advanced: {}", x(m, 19));
                assert!(
                    m.block_cache.may_hold_code((BASE + 0x800) >> 12),
                    "the entry page is still filter-positive"
                );
                if slices == [1_000_000] {
                    assert!(
                        stats.exit_horizon > 5 && stats.inline_ops > 3_000 && stats.slow_ops > 1_500,
                        "div={div}: {stats:?}"
                    );
                }
            },
        );
    }
}
