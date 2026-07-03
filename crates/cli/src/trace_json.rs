//! JSON-lines trace serializer (E0-T16) — CLI-only, hand-rolled so serde stays out of
//! `wasm-vm-core`. One JSON object per retired instruction, `\n`-separated:
//!
//! ```json
//! {"pc":"0x80000050","insn":"0x00550533","rd":[10,"0x1"]}
//! {"pc":"0x80001000","insn":"0x00e68023","mem":{"addr":"0x10000000","store":true,"len":1,"value":"0xcd"}}
//! ```

use std::io::Write;

use wasm_vm_core::trace::{TraceRecord, TraceSink};

/// Writes each retired instruction as a JSON line to `out`. The CLI `--trace` flag that
/// constructs one over stdout is wired in E0-T18; until then it is exercised by tests.
#[allow(dead_code)]
pub struct JsonLinesSink<W: Write> {
    pub out: W,
}

impl<W: Write> TraceSink for JsonLinesSink<W> {
    fn retire(&mut self, r: &TraceRecord) {
        let _ = write!(self.out, "{}", json_line(r));
        let _ = self.out.write_all(b"\n");
    }
}

#[allow(dead_code)]
pub fn json_line(r: &TraceRecord) -> String {
    let mut s = format!("{{\"pc\":\"{:#x}\",\"insn\":\"{:#010x}\"", r.pc, r.insn);
    if let Some((rd, val)) = r.rd {
        s.push_str(&format!(",\"rd\":[{rd},\"{val:#x}\"]"));
    }
    if let Some(m) = r.mem {
        let masked = if m.len >= 8 {
            m.value
        } else {
            m.value & ((1u64 << (8 * m.len)) - 1)
        };
        s.push_str(&format!(
            ",\"mem\":{{\"addr\":\"{:#x}\",\"store\":{},\"len\":{}",
            m.addr, m.is_store, m.len
        ));
        if m.is_store {
            s.push_str(&format!(",\"value\":\"{masked:#x}\""));
        }
        s.push('}');
    }
    s.push('}');
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_vm_core::trace::MemOp;

    #[test]
    fn json_line_shapes() {
        // rd write
        let r = TraceRecord {
            pc: 0x80000050,
            insn: 0x0055_0533,
            rd: Some((10, 1)),
            mem: None,
        };
        assert_eq!(
            json_line(&r),
            r#"{"pc":"0x80000050","insn":"0x00550533","rd":[10,"0x1"]}"#
        );
        // store, width-masked value
        let r = TraceRecord {
            pc: 0x80001000,
            insn: 0x00e6_8023,
            rd: None,
            mem: Some(MemOp {
                addr: 0x1000_0000,
                len: 1,
                is_store: true,
                value: 0xABCD,
            }),
        };
        assert_eq!(
            json_line(&r),
            r#"{"pc":"0x80001000","insn":"0x00e68023","mem":{"addr":"0x10000000","store":true,"len":1,"value":"0xcd"}}"#
        );
        // load, no value
        let r = TraceRecord {
            pc: 0x80001004,
            insn: 0x0007_c703,
            rd: Some((14, 0x48)),
            mem: Some(MemOp {
                addr: 0x1000_0000,
                len: 1,
                is_store: false,
                value: 0,
            }),
        };
        assert_eq!(
            json_line(&r),
            r#"{"pc":"0x80001004","insn":"0x0007c703","rd":[14,"0x48"],"mem":{"addr":"0x10000000","store":false,"len":1}}"#
        );
    }

    #[test]
    fn sink_writes_newline_separated_lines() {
        let mut buf = Vec::new();
        {
            let mut sink = JsonLinesSink { out: &mut buf };
            sink.retire(&TraceRecord {
                pc: 1,
                insn: 2,
                rd: None,
                mem: None,
            });
            sink.retire(&TraceRecord {
                pc: 3,
                insn: 4,
                rd: None,
                mem: None,
            });
        }
        let s = String::from_utf8(buf).unwrap();
        assert_eq!(s.lines().count(), 2);
        assert!(s.ends_with('\n'));
    }
}
