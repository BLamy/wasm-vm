//! Flattened-device-tree builder (E2-T02): serializes the E2-T01 platform definition into a
//! spec-valid DTB blob so the kernel discovers memory, CPUs, and every device from `a1` —
//! no hardcoded driver addresses.
//!
//! Format per the devicetree spec v0.4: header magic `0xd00dfeed`, version 17, every header /
//! token / cell **big-endian**; a memory-reservation block of `(addr, size)` u64 pairs ending
//! with `(0, 0)`; a structure block of 4-byte-aligned tokens (`FDT_BEGIN_NODE` 0x1,
//! `FDT_END_NODE` 0x2, `FDT_PROP` 0x3, `FDT_NOP` 0x4, `FDT_END` 0x9); and a strings block
//! holding property names (deduplicated — the same name is stored once and referenced by
//! offset).
//!
//! [`build_virt_dtb`] emits the tree for the `virt` platform **using only
//! [`crate::platform::virt`] constants** — changing a platform constant changes the blob, so
//! the DTB can never drift from the map (the E2-T01 "no magic numbers" rule extends here).

use alloc::string::String;
use alloc::vec::Vec;

use crate::platform::{Platform, virt};

// Structure-block tokens (§5.4.1).
const FDT_BEGIN_NODE: u32 = 0x1;
const FDT_END_NODE: u32 = 0x2;
const FDT_PROP: u32 = 0x3;
const FDT_END: u32 = 0x9;

/// Header magic (§5.2).
pub const FDT_MAGIC: u32 = 0xd00d_feed;
/// The version we emit / the last version we're compatible with (§5.2).
pub const FDT_VERSION: u32 = 17;
const FDT_LAST_COMP_VERSION: u32 = 16;
/// Fixed header size for version 17: ten big-endian u32 fields.
const HEADER_LEN: usize = 40;

/// Incremental DTB writer: `begin_node`/`prop_*`/`end_node`, then [`FdtBuilder::finish`].
///
/// Property names are deduplicated into the strings block. The builder does no tree
/// validation beyond balancing (callers get spec-valid output iff their begin/end calls
/// balance — `finish` asserts that).
pub struct FdtBuilder {
    structure: Vec<u8>,
    strings: Vec<u8>,
    /// (name, offset) pairs already interned in `strings` — linear scan keeps this
    /// deterministic and no_std-friendly (property-name counts are tiny).
    interned: Vec<(String, u32)>,
    depth: u32,
}

impl Default for FdtBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl FdtBuilder {
    pub fn new() -> Self {
        Self {
            structure: Vec::new(),
            strings: Vec::new(),
            interned: Vec::new(),
            depth: 0,
        }
    }

    fn push_u32(&mut self, v: u32) {
        self.structure.extend_from_slice(&v.to_be_bytes());
    }

    /// Pad the structure block to 4-byte alignment (§5.4.1: tokens are aligned).
    fn pad4(&mut self) {
        while !self.structure.len().is_multiple_of(4) {
            self.structure.push(0);
        }
    }

    /// Offset of `name` in the strings block, interning it on first use.
    fn string_offset(&mut self, name: &str) -> u32 {
        if let Some((_, off)) = self.interned.iter().find(|(n, _)| n == name) {
            return *off;
        }
        let off = self.strings.len() as u32;
        self.strings.extend_from_slice(name.as_bytes());
        self.strings.push(0);
        self.interned.push((String::from(name), off));
        off
    }

    /// Open a node. The root node's name is the empty string.
    pub fn begin_node(&mut self, name: &str) {
        self.push_u32(FDT_BEGIN_NODE);
        self.structure.extend_from_slice(name.as_bytes());
        self.structure.push(0); // NUL terminator
        self.pad4();
        self.depth += 1;
    }

    pub fn end_node(&mut self) {
        debug_assert!(self.depth > 0, "end_node without begin_node");
        self.push_u32(FDT_END_NODE);
        self.depth -= 1;
    }

    /// Raw property bytes (§5.4.1: len + nameoff + value, padded to 4).
    pub fn prop(&mut self, name: &str, value: &[u8]) {
        let nameoff = self.string_offset(name);
        self.push_u32(FDT_PROP);
        self.push_u32(value.len() as u32);
        self.push_u32(nameoff);
        self.structure.extend_from_slice(value);
        self.pad4();
    }

    /// Empty (boolean-presence) property, e.g. `interrupt-controller`.
    pub fn prop_empty(&mut self, name: &str) {
        self.prop(name, &[]);
    }

    /// One big-endian cell.
    pub fn prop_u32(&mut self, name: &str, v: u32) {
        self.prop(name, &v.to_be_bytes());
    }

    /// One big-endian u64 (two cells).
    pub fn prop_u64(&mut self, name: &str, v: u64) {
        self.prop(name, &v.to_be_bytes());
    }

    /// A list of big-endian cells (`reg`, `interrupts-extended`, ...).
    pub fn prop_cells(&mut self, name: &str, cells: &[u32]) {
        let mut bytes = Vec::with_capacity(cells.len() * 4);
        for c in cells {
            bytes.extend_from_slice(&c.to_be_bytes());
        }
        self.prop(name, &bytes);
    }

    /// NUL-terminated string property.
    pub fn prop_str(&mut self, name: &str, s: &str) {
        let mut bytes = Vec::with_capacity(s.len() + 1);
        bytes.extend_from_slice(s.as_bytes());
        bytes.push(0);
        self.prop(name, &bytes);
    }

    /// String-list property (each entry NUL-terminated), e.g. multi-`compatible`.
    pub fn prop_str_list(&mut self, name: &str, list: &[&str]) {
        let mut bytes = Vec::new();
        for s in list {
            bytes.extend_from_slice(s.as_bytes());
            bytes.push(0);
        }
        self.prop(name, &bytes);
    }

    /// Serialize: header + memory-reservation block + structure + strings.
    ///
    /// `reservations` are `(address, size)` pairs for the mem-rsvmap block; the terminating
    /// `(0, 0)` entry is appended automatically.
    pub fn finish(mut self, reservations: &[(u64, u64)]) -> Vec<u8> {
        assert!(self.depth == 0, "unbalanced begin_node/end_node");
        self.push_u32(FDT_END);

        // Layout: header | mem_rsvmap (8-byte aligned) | struct (4-byte aligned) | strings.
        let off_mem_rsvmap = HEADER_LEN; // 40 is already 8-byte aligned
        let rsv_len = (reservations.len() + 1) * 16;
        let off_dt_struct = off_mem_rsvmap + rsv_len; // 16-byte entries keep 4-alignment
        let size_dt_struct = self.structure.len();
        let off_dt_strings = off_dt_struct + size_dt_struct;
        let size_dt_strings = self.strings.len();
        let totalsize = off_dt_strings + size_dt_strings;

        let mut out = Vec::with_capacity(totalsize);
        for field in [
            FDT_MAGIC,
            totalsize as u32,
            off_dt_struct as u32,
            off_dt_strings as u32,
            off_mem_rsvmap as u32,
            FDT_VERSION,
            FDT_LAST_COMP_VERSION,
            virt::BOOT_HART as u32, // boot_cpuid_phys
            size_dt_strings as u32,
            size_dt_struct as u32,
        ] {
            out.extend_from_slice(&field.to_be_bytes());
        }
        for (addr, size) in reservations {
            out.extend_from_slice(&addr.to_be_bytes());
            out.extend_from_slice(&size.to_be_bytes());
        }
        out.extend_from_slice(&0u64.to_be_bytes());
        out.extend_from_slice(&0u64.to_be_bytes());
        out.extend_from_slice(&self.structure);
        out.extend_from_slice(&self.strings);
        out
    }
}

// Phandles for the two interrupt parents. Fixed, small, documented.
const PHANDLE_CPU_INTC: u32 = 1;
const PHANDLE_PLIC: u32 = 2;
const PHANDLE_TEST: u32 = 3;

// RISC-V local interrupt numbers used in `interrupts-extended` (privileged spec / QEMU virt):
// M-soft 3, M-timer 7, S-ext 9, M-ext 11 (S-soft 1 / S-timer 5 unused here).
const IRQ_M_SOFT: u32 = 3;
const IRQ_M_TIMER: u32 = 7;
const IRQ_S_EXT: u32 = 9;
const IRQ_M_EXT: u32 = 11;

/// Optional initrd placement advertised via `/chosen`.
#[derive(Debug, Clone, Copy)]
pub struct Initrd {
    pub start: u64,
    /// One past the last byte (`linux,initrd-end` convention).
    pub end: u64,
}

/// Build the DTB for the `virt` platform: memory, one hart (+ cpu-intc), CLINT, PLIC, UART,
/// the 8 virtio-mmio slots, rtc, the syscon test device (+ poweroff/reboot), and `/chosen`.
///
/// Every address, size, and IRQ comes from [`virt`] / the passed [`Platform`] — nothing is
/// hardcoded, so a platform change propagates to the DTB by construction.
pub fn build_virt_dtb(platform: &Platform, bootargs: &str, initrd: Option<Initrd>) -> Vec<u8> {
    let mut f = FdtBuilder::new();

    f.begin_node(""); // root
    f.prop_u32("#address-cells", 2);
    f.prop_u32("#size-cells", 2);
    f.prop_str("compatible", "riscv-virtio");
    f.prop_str("model", "riscv-virtio,qemu");

    // poweroff/reboot live at the ROOT (they carry no reg — putting them under the
    // simple-bus /soc draws a dtc simple_bus_reg warning; QEMU also roots them).
    f.begin_node("poweroff");
    f.prop_str("compatible", "syscon-poweroff");
    f.prop_u32("regmap", PHANDLE_TEST);
    f.prop_u32("offset", 0);
    f.prop_u32("value", 0x5555);
    f.end_node();

    f.begin_node("reboot");
    f.prop_str("compatible", "syscon-reboot");
    f.prop_u32("regmap", PHANDLE_TEST);
    f.prop_u32("offset", 0);
    f.prop_u32("value", 0x7777);
    f.end_node();

    // /chosen — boot arguments + console. stdout-path names the UART node by path.
    f.begin_node("chosen");
    f.prop_str("bootargs", bootargs);
    f.prop_str(
        "stdout-path",
        &alloc::format!("/soc/serial@{:x}", virt::UART0_BASE),
    );
    if let Some(rd) = initrd {
        f.prop_u64("linux,initrd-start", rd.start);
        f.prop_u64("linux,initrd-end", rd.end);
    }
    f.end_node();

    // /memory@80000000
    f.begin_node(&alloc::format!("memory@{:x}", virt::DRAM_BASE));
    f.prop_str("device_type", "memory");
    f.prop_cells(
        "reg",
        &[
            (virt::DRAM_BASE >> 32) as u32,
            virt::DRAM_BASE as u32,
            (platform.dram_size() >> 32) as u32,
            platform.dram_size() as u32,
        ],
    );
    f.end_node();

    // /cpus — timebase is the single-source TIMEBASE_FREQ_HZ (acceptance #3).
    f.begin_node("cpus");
    f.prop_u32("#address-cells", 1);
    f.prop_u32("#size-cells", 0);
    f.prop_u32("timebase-frequency", virt::TIMEBASE_FREQ_HZ);
    f.begin_node("cpu@0");
    f.prop_str("device_type", "cpu");
    f.prop_u32("reg", virt::BOOT_HART as u32);
    f.prop_str("status", "okay");
    f.prop_str("compatible", "riscv");
    // The ISA string matches misa (rv64imafdc + S/U); mmu-type advertises the deepest
    // paging mode the MMU implements (Sv57 since E1-T28 — deeper than the task text's
    // pre-T28 "sv39"; kernels cap themselves via the satp probe regardless).
    f.prop_str("riscv,isa", "rv64imafdc");
    f.prop_str("mmu-type", "riscv,sv57");
    f.begin_node("interrupt-controller");
    f.prop_u32("#interrupt-cells", 1);
    f.prop_empty("interrupt-controller");
    f.prop_str("compatible", "riscv,cpu-intc");
    f.prop_u32("phandle", PHANDLE_CPU_INTC);
    f.end_node(); // interrupt-controller
    f.end_node(); // cpu@0
    f.end_node(); // cpus

    // /soc — simple-bus with identity ranges.
    f.begin_node("soc");
    f.prop_u32("#address-cells", 2);
    f.prop_u32("#size-cells", 2);
    f.prop_str("compatible", "simple-bus");
    f.prop_empty("ranges");

    let reg2 = |base: u64, len: u64| {
        [
            (base >> 32) as u32,
            base as u32,
            (len >> 32) as u32,
            len as u32,
        ]
    };

    // syscon test device (poweroff/reboot target).
    f.begin_node(&alloc::format!("test@{:x}", virt::TEST_BASE));
    f.prop_str_list("compatible", &["sifive,test1", "sifive,test0", "syscon"]);
    f.prop_cells("reg", &reg2(virt::TEST_BASE, virt::TEST_LEN));
    f.prop_u32("phandle", PHANDLE_TEST);
    f.end_node();

    // goldfish-rtc.
    f.begin_node(&alloc::format!("rtc@{:x}", virt::RTC_BASE));
    f.prop_str("compatible", "google,goldfish-rtc");
    f.prop_cells("reg", &reg2(virt::RTC_BASE, virt::RTC_LEN));
    f.prop_cells("interrupts", &[virt::RTC_IRQ]);
    f.prop_u32("interrupt-parent", PHANDLE_PLIC);
    f.end_node();

    // CLINT — M-mode soft + timer lines into the cpu-intc.
    f.begin_node(&alloc::format!("clint@{:x}", virt::CLINT_BASE));
    f.prop_str_list("compatible", &["sifive,clint0", "riscv,clint0"]);
    f.prop_cells("reg", &reg2(virt::CLINT_BASE, virt::CLINT_LEN));
    f.prop_cells(
        "interrupts-extended",
        &[PHANDLE_CPU_INTC, IRQ_M_SOFT, PHANDLE_CPU_INTC, IRQ_M_TIMER],
    );
    f.end_node();

    // PLIC — external interrupt controller; contexts = hart0 M-ext + hart0 S-ext.
    f.begin_node(&alloc::format!("plic@{:x}", virt::PLIC_BASE));
    f.prop_str_list("compatible", &["sifive,plic-1.0.0", "riscv,plic0"]);
    f.prop_cells("reg", &reg2(virt::PLIC_BASE, virt::PLIC_LEN));
    f.prop_u32("#interrupt-cells", 1);
    f.prop_u32("#address-cells", 0);
    f.prop_empty("interrupt-controller");
    f.prop_u32("riscv,ndev", virt::PLIC_NDEV);
    f.prop_cells(
        "interrupts-extended",
        &[PHANDLE_CPU_INTC, IRQ_M_EXT, PHANDLE_CPU_INTC, IRQ_S_EXT],
    );
    f.prop_u32("phandle", PHANDLE_PLIC);
    f.end_node();

    // UART — ns16550a on the PLIC.
    f.begin_node(&alloc::format!("serial@{:x}", virt::UART0_BASE));
    f.prop_str("compatible", "ns16550a");
    f.prop_cells("reg", &reg2(virt::UART0_BASE, virt::UART0_LEN));
    f.prop_u32("clock-frequency", virt::UART_CLOCK_HZ);
    f.prop_cells("interrupts", &[virt::UART0_IRQ]);
    f.prop_u32("interrupt-parent", PHANDLE_PLIC);
    f.end_node();

    // 8 virtio-mmio transports, slot i at VIRTIO_BASE + i*stride, IRQ = VIRTIO_IRQ_BASE + i.
    for i in 0..virt::VIRTIO_COUNT {
        let base = Platform::virtio_base(i);
        // Node names use lowercase hex per convention.
        let name = alloc::format!("virtio_mmio@{base:x}");
        f.begin_node(&name);
        f.prop_str("compatible", "virtio,mmio");
        f.prop_cells("reg", &reg2(base, virt::VIRTIO_LEN));
        f.prop_cells("interrupts", &[Platform::virtio_irq(i)]);
        f.prop_u32("interrupt-parent", PHANDLE_PLIC);
        f.end_node();
    }

    f.end_node(); // soc
    f.end_node(); // root

    f.finish(&[])
}

/// Where to place a DTB of `dtb_len` bytes in DRAM: at the top, 8-byte aligned downward —
/// outside the kernel image (loaded at the bottom of DRAM) and below nothing else. Returns
/// `None` if the blob doesn't fit.
///
/// `DTB_SLACK` bytes of headroom are left ABOVE the blob: firmware fixups edit the DTB in
/// place and grow it (OpenSBI's reserved-memory fixup — the ADR 0002 option-(b) probe took a
/// store access fault 21 bytes past top-of-RAM when the DTB sat flush against the end).
pub const DTB_SLACK: u64 = 16 * 1024;

pub fn dtb_placement(platform: &Platform, dtb_len: u64) -> Option<u64> {
    let dram_end = virt::DRAM_BASE.checked_add(platform.dram_size())?;
    let addr = dram_end.checked_sub(dtb_len.checked_add(DTB_SLACK)?)? & !7;
    if addr < virt::DRAM_BASE {
        return None;
    }
    Some(addr)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn be32(b: &[u8], off: usize) -> u32 {
        u32::from_be_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]])
    }

    /// Minimal structure-block walker: validates token stream, 4-byte alignment, prop name
    /// offsets inside the strings block, and returns (node names, property names).
    fn walk(blob: &[u8]) -> (Vec<String>, Vec<String>) {
        let off_struct = be32(blob, 8) as usize;
        let off_strings = be32(blob, 12) as usize;
        let size_strings = be32(blob, 32) as usize;
        let size_struct = be32(blob, 36) as usize;
        let mut nodes = Vec::new();
        let mut props = Vec::new();
        let mut pos = off_struct;
        let end = off_struct + size_struct;
        let mut depth = 0i32;
        loop {
            assert!(pos.is_multiple_of(4), "token at unaligned offset {pos}");
            assert!(pos < end, "ran past structure block");
            let tok = be32(blob, pos);
            pos += 4;
            match tok {
                FDT_BEGIN_NODE => {
                    let start = pos;
                    while blob[pos] != 0 {
                        pos += 1;
                    }
                    nodes.push(String::from_utf8(blob[start..pos].to_vec()).unwrap());
                    pos += 1; // NUL
                    pos = (pos + 3) & !3;
                    depth += 1;
                }
                FDT_END_NODE => depth -= 1,
                FDT_PROP => {
                    let len = be32(blob, pos) as usize;
                    let nameoff = be32(blob, pos + 4) as usize;
                    assert!(nameoff < size_strings, "prop nameoff past strings block");
                    let name_start = off_strings + nameoff;
                    let mut name_end = name_start;
                    while blob[name_end] != 0 {
                        name_end += 1;
                    }
                    props.push(String::from_utf8(blob[name_start..name_end].to_vec()).unwrap());
                    pos += 8 + len;
                    pos = (pos + 3) & !3;
                }
                FDT_END => {
                    assert_eq!(depth, 0, "unbalanced tree");
                    assert_eq!(pos, end, "FDT_END not at end of structure block");
                    break;
                }
                t => panic!("unknown token {t:#x} at {}", pos - 4),
            }
        }
        (nodes, props)
    }

    #[test]
    fn header_is_spec_valid() {
        let blob = build_virt_dtb(&Platform::default(), "console=ttyS0", None);
        assert_eq!(be32(&blob, 0), FDT_MAGIC);
        assert_eq!(be32(&blob, 4) as usize, blob.len(), "totalsize");
        assert_eq!(be32(&blob, 20), FDT_VERSION);
        assert_eq!(be32(&blob, 24), 16, "last_comp_version");
        assert_eq!(be32(&blob, 28), 0, "boot_cpuid_phys = hart 0");
        // mem-rsvmap terminator right after the header (no reservations).
        let off_rsv = be32(&blob, 16) as usize;
        assert_eq!(&blob[off_rsv..off_rsv + 16], &[0u8; 16]);
    }

    #[test]
    fn tree_has_every_required_node_and_link() {
        let blob = build_virt_dtb(&Platform::default(), "root=/dev/vda", None);
        let (nodes, props) = walk(&blob);
        for required in [
            "memory@80000000",
            "cpus",
            "cpu@0",
            "interrupt-controller",
            "soc",
            "clint@2000000",
            "plic@c000000",
            "serial@10000000",
            "chosen",
            "rtc@101000",
            "test@100000",
        ] {
            assert!(
                nodes.iter().any(|n| n == required),
                "missing node {required}"
            );
        }
        // All 8 virtio slots present, derived from the platform constants.
        for i in 0..virt::VIRTIO_COUNT {
            let name = alloc::format!("virtio_mmio@{:x}", Platform::virtio_base(i));
            assert!(nodes.iter().any(|n| n == &name), "missing {name}");
        }
        for required in [
            "timebase-frequency",
            "riscv,ndev",
            "interrupts-extended",
            "interrupt-parent",
            "stdout-path",
            "bootargs",
        ] {
            assert!(
                props.iter().any(|p| p == required),
                "missing prop {required}"
            );
        }
    }

    /// Anti-stale-hardcoding: the DTB is a pure function of the platform — a different DRAM
    /// size must change the memory reg; initrd props appear only when passed.
    #[test]
    fn dtb_tracks_platform_and_args() {
        let a = build_virt_dtb(&Platform::new(128 * 1024 * 1024), "a", None);
        let b = build_virt_dtb(&Platform::new(256 * 1024 * 1024), "a", None);
        assert_ne!(a, b, "DRAM size must flow into the blob");
        let c = build_virt_dtb(
            &Platform::default(),
            "a",
            Some(Initrd {
                start: 0x8800_0000,
                end: 0x8810_0000,
            }),
        );
        let (_, props) = walk(&c);
        assert!(props.iter().any(|p| p == "linux,initrd-start"));
        let (_, props_no) = walk(&a);
        assert!(!props_no.iter().any(|p| p == "linux,initrd-start"));
    }

    #[test]
    fn placement_top_of_dram_aligned_outside_kernel() {
        let p = Platform::default();
        let blob = build_virt_dtb(&p, "x", None);
        let addr = dtb_placement(&p, blob.len() as u64).unwrap();
        assert_eq!(addr % 8, 0, "8-byte aligned");
        assert!(addr >= virt::DRAM_BASE);
        assert!(addr + blob.len() as u64 <= virt::DRAM_BASE + p.dram_size());
        // Top-of-DRAM: leaves the bottom (kernel load range) untouched.
        assert!(addr > virt::DRAM_BASE + p.dram_size() / 2);
        // Doesn't fit → None, never a bogus address.
        assert_eq!(dtb_placement(&Platform::new(4096), 8192), None);
    }
}
