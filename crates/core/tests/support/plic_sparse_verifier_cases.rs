use std::cell::RefCell;
use std::rc::Rc;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::PLIC_BASE;
use wasm_vm_core::dev::plic::PlicState;
use wasm_vm_core::resume::ComponentSnapshot;

// Independent wire-layout model: 32 priorities, 2 enables, 2 thresholds, level, 2 claims.
const WORDS: usize = 39;
const SEED: u64 = 0x260f_0031;

fn bytes(words: &[u32; WORDS]) -> Vec<u8> {
    words.iter().flat_map(|word| word.to_le_bytes()).collect()
}

// Deliberately scans all real IDs; no production selector or sparse-mask helper is reused.
fn winner(words: &[u32; WORDS], context: usize) -> usize {
    let mut result = 0;
    let mut priority = 0;
    for id in 1..32 {
        let bit = 1u32 << id;
        if words[36] & bit != 0
            && words[37] & bit == 0
            && words[38] & bit == 0
            && words[32 + context] & bit != 0
            && words[id] > words[34 + context]
            && words[id] > priority
        {
            result = id;
            priority = words[id];
        }
    }
    result
}

struct Fixture {
    machine: Machine,
    plic: Rc<RefCell<PlicState>>,
    words: [u32; WORDS],
    counts: [u64; 32],
    hits: u64,
}

impl Fixture {
    fn new() -> Self {
        let mut machine = Machine::new(4096);
        let plic = machine.enable_plic();
        Self {
            machine,
            plic,
            words: [0; WORDS],
            counts: [0; 32],
            hits: 0,
        }
    }

    fn actual_hits(&mut self) -> u64 {
        self.machine
            .bus_mut()
            .device_hits()
            .into_iter()
            .find(|(base, _)| *base == PLIC_BASE)
            .expect("PLIC bus window")
            .1
    }

    fn restore(&mut self, words: [u32; WORDS]) {
        let payload = bytes(&words);
        assert_eq!(payload.len(), 156);
        self.plic.borrow_mut().restore(&payload).unwrap();
        self.words = words;
        self.counts = [0; 32];
        self.check("restore");
    }

    fn check(&mut self, stop: &str) {
        assert_eq!(self.actual_hits(), self.hits, "{stop}: bus hits");
        let plic = self.plic.borrow();
        let expected = bytes(&self.words);
        assert_eq!(plic.to_snapshot(), expected, "{stop}: behavioral bytes");
        assert_eq!(*plic.claim_counts(), self.counts, "{stop}: counts");
        assert_eq!(
            plic.pending(),
            self.words[36] & !(self.words[37] | self.words[38]),
            "{stop}: pending"
        );
        for _ in 0..3 {
            for context in 0..2 {
                assert_eq!(
                    plic.eip(context),
                    winner(&self.words, context) != 0,
                    "{stop}: context{context}"
                );
            }
        }
        assert_eq!(plic.to_snapshot(), expected, "{stop}: query purity");
        assert_eq!(*plic.claim_counts(), self.counts, "{stop}: query counts");
        drop(plic);
        assert_eq!(self.actual_hits(), self.hits, "{stop}: queries bypass MMIO");
    }

    fn claim(&mut self, context: usize) -> usize {
        let predicted = winner(&self.words, context);
        let actual = self
            .machine
            .bus_mut()
            .load32(PLIC_BASE + 0x20_0004 + context as u64 * 0x1000)
            .unwrap();
        self.hits += 1;
        assert_eq!(actual as usize, predicted, "context{context}: claim");
        if predicted != 0 {
            self.words[37 + context] |= 1 << predicted;
            self.counts[predicted] += 1;
        }
        self.check("claim");
        predicted
    }

    fn complete31(&mut self, context: usize, stop: &str) {
        self.machine
            .bus_mut()
            .store32(PLIC_BASE + 0x20_0004 + context as u64 * 0x1000, 31)
            .unwrap();
        self.hits += 1;
        self.words[37 + context] &= !(1 << 31);
        self.check(stop);
    }

    fn directed_stop(&mut self, stop: &str, expected_id: usize) {
        for context in 0..2 {
            assert_eq!(winner(&self.words, context), expected_id, "{stop}: model");
            assert_eq!(self.plic.borrow().eip(context), expected_id != 0, "{stop}");
        }
        self.check(stop);
        println!(
            "P6 {stop}: winner_both={expected_id} claimed={:08x}/{:08x} pending={:08x} count31={} hits={}",
            self.words[37],
            self.words[38],
            self.plic.borrow().pending(),
            self.counts[31],
            self.hits
        );
    }
}

pub fn reserved_seed_and_reversed_completion() {
    let mut fixture = Fixture::new();
    let mut seed = SEED;
    let mut nonempty = 0;
    for row in 0..64 {
        let mut words = [0; WORDS];
        for word in &mut words {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            *word = (seed >> 16) as u32;
        }
        for context in 0..2 {
            fixture.restore(words);
            let id = fixture.claim(context);
            nonempty += usize::from(id != 0);
            println!("P6 seed=0x{SEED:08x} row={row} context={context} claim={id}");
        }
    }
    assert!(
        nonempty > 0 && nonempty < 128,
        "seed exercises both outcomes"
    );
    println!("P6 seed rows=64 contexts=128 nonempty={nonempty} final_seed=0x{seed:016x}");

    // Complete the frozen P1 tie prediction: after claiming1, tied source31 remains eligible.
    let mut tie = [0; WORDS];
    tie[1] = 7;
    tie[31] = 7;
    tie[32] = (1 << 1) | (1 << 31);
    tie[33] = tie[32];
    tie[36] = tie[32];
    for context in 0..2 {
        fixture.restore(tie);
        assert_eq!(fixture.claim(context), 1);
        assert_eq!(fixture.claim(context), 31);
        assert_eq!(fixture.claim(context), 0);
    }
    println!("P1 tied1+31: claims1,31,0 in both contexts");

    let mut hostile = [0; WORDS];
    hostile[0] = u32::MAX;
    hostile[31] = u32::MAX - 1;
    hostile[32] = 1 | (1 << 31);
    hostile[33] = hostile[32];
    hostile[34] = 0;
    hostile[35] = u32::MAX - 2;
    hostile[36] = hostile[32];
    hostile[37] = 1 << 31;
    hostile[38] = 1 << 31;
    fixture.restore(hostile);
    fixture.directed_stop("both-claimed restored", 0);
    fixture.complete31(1, "complete context1 first");
    fixture.directed_stop("context0 still owns claim", 0);
    fixture.complete31(0, "complete context0 second");
    fixture.directed_stop("both banks released", 31);
    assert_eq!(fixture.claim(1), 31);
    fixture.directed_stop("context1 owns new claim", 0);
    fixture.complete31(0, "wrong-context completion");
    fixture.directed_stop("context1 still owns claim", 0);
    fixture.complete31(1, "owner completion");
    fixture.directed_stop("held-high reopened", 31);
    assert_eq!(fixture.counts[31], 1);
    assert_eq!(fixture.hits, 139); // 128 seeded claims + 6 tie claims + 5 directed operations.
}
