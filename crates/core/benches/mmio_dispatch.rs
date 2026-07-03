//! E0-T04 hot-path budget: RAM traffic through SystemBus with 100 attached devices
//! must stay within 10% of bare Ram (the dispatch sits under every instruction).
//! Run: `cargo bench -p wasm-vm-core --bench mmio_dispatch`

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::mmio::{RecordingDevice, SystemBus};
use wasm_vm_core::ram::Ram;

const RAM_SIZE: usize = 4 * 1024 * 1024;
const SPAN: u64 = 64 * 1024; // stride window keeps the working set in cache
const OPS: u64 = 32768; // long samples average over host-machine noise spikes

fn ram_workload(bus: &mut impl Bus) -> u64 {
    // Mixed-width load/store pattern over RAM, the shape of fetch/execute traffic.
    let mut acc = 0u64;
    for i in 0..OPS {
        // black_box the reference each iteration: without it LLVM store-forwards the
        // fully-inlined bare-Ram round-trips into nothing and the comparison measures
        // dead-code elimination, not dispatch.
        let bus = core::hint::black_box(&mut *bus);
        let a = DRAM_BASE + (i * 64) % SPAN;
        bus.store64(a, i).unwrap();
        acc = acc.wrapping_add(bus.load64(a).unwrap());
        acc = acc.wrapping_add(u64::from(bus.load8(a + 3).unwrap()));
        bus.store16(a + 8, i as u16).unwrap();
        acc = acc.wrapping_add(u64::from(bus.load32(a + 12).unwrap()));
    }
    acc
}

fn bench(c: &mut Criterion) {
    let mut group = c.benchmark_group("ram_path");

    let mut bare = Ram::new(RAM_SIZE).unwrap();
    group.bench_function("bare_ram", |b| {
        b.iter(|| black_box(ram_workload(&mut bare)))
    });

    let mut bus = SystemBus::new(Ram::new(RAM_SIZE).unwrap());
    for i in 0..100u64 {
        let (dev, _log) = RecordingDevice::new(0);
        bus.attach(0x1000_0000 + i * 0x1000, 0x100, Box::new(dev))
            .unwrap();
    }
    group.bench_function("system_bus_100_devices", |b| {
        b.iter(|| black_box(ram_workload(&mut bus)))
    });

    group.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
