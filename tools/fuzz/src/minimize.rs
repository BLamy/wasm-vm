//! Delta-debugging minimizer (E1-T21): shrink a divergent instruction body to the
//! shortest sub-sequence that still reproduces the divergence.
//!
//! This is the classic ddmin over the body's line list. It is sound here because the
//! stimulus is straight-line: deleting any body line still assembles and still falls
//! through to the halt epilogue, so every candidate is a runnable program. A divergence
//! that depends on a predecessor (a register the diverging instruction reads) is preserved
//! automatically — removing that predecessor makes the divergence vanish, so ddmin keeps
//! it. The result is emitted as a standalone `.S` reproducer (acceptance: ≤ 20
//! instructions, deterministic).

use crate::isagen::Program;

/// Minimize `prog`'s body to a locally-minimal divergent subset. `still_diverges` is called
/// with a candidate body and must return true iff that candidate reproduces the divergence.
/// Returns the minimized program (a clone of `prog` with a shortened body) and the number
/// of oracle calls made (for the log's throughput accounting).
pub fn ddmin(
    prog: &Program,
    mut still_diverges: impl FnMut(&[String]) -> bool,
) -> (Program, usize) {
    let mut body = prog.body.clone();
    let mut calls = 0;
    let mut granularity = 2usize;

    while body.len() >= 2 {
        let chunk = body.len().div_ceil(granularity).max(1);
        let mut reduced = false;
        let mut start = 0;
        while start < body.len() {
            let end = (start + chunk).min(body.len());
            // Candidate = body with [start, end) removed.
            let mut candidate = Vec::with_capacity(body.len() - (end - start));
            candidate.extend_from_slice(&body[..start]);
            candidate.extend_from_slice(&body[end..]);
            calls += 1;
            if !candidate.is_empty() && still_diverges(&candidate) {
                body = candidate;
                // Same granularity, don't advance start: the removed hole closed up.
                granularity = granularity.max(2).min(body.len().max(2));
                reduced = true;
            } else {
                start = end;
            }
        }
        if !reduced {
            if granularity >= body.len() {
                break; // already at single-line granularity with no further reduction
            }
            granularity = (granularity * 2).min(body.len());
        }
    }

    let minimized = Program {
        seed: prog.seed,
        prologue: prog.prologue.clone(),
        body,
    };
    (minimized, calls)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prog_with_body(body: Vec<&str>) -> Program {
        Program {
            seed: 0,
            prologue: vec!["    li t0, 0x0".into()],
            body: body.into_iter().map(String::from).collect(),
        }
    }

    #[test]
    fn shrinks_to_the_single_culprit_line() {
        // Oracle: "diverges" iff the body still contains the culprit marker.
        let prog = prog_with_body(vec![
            "    add t0, t1, t2",
            "    CULPRIT",
            "    sub t3, t4, t5",
            "    xor t0, t0, t0",
        ]);
        let (min, _calls) = ddmin(&prog, |body| body.iter().any(|l| l.contains("CULPRIT")));
        assert_eq!(min.body, vec!["    CULPRIT".to_string()]);
    }

    #[test]
    fn preserves_a_two_line_dependency() {
        // Divergence needs BOTH a setup line and the culprit — ddmin must keep both.
        let prog = prog_with_body(vec![
            "    noise1",
            "    SETUP",
            "    noise2",
            "    CULPRIT",
            "    noise3",
        ]);
        let (min, _) = ddmin(&prog, |body| {
            body.iter().any(|l| l.contains("SETUP")) && body.iter().any(|l| l.contains("CULPRIT"))
        });
        assert_eq!(
            min.body.len(),
            2,
            "must keep exactly the interdependent pair"
        );
        assert!(min.body.iter().any(|l| l.contains("SETUP")));
        assert!(min.body.iter().any(|l| l.contains("CULPRIT")));
    }

    #[test]
    fn a_never_diverging_oracle_leaves_body_untouched_only_if_whole_needed() {
        // If only the FULL body diverges, ddmin cannot remove anything.
        let prog = prog_with_body(vec!["a", "b", "c", "d"]);
        let full = prog.body.clone();
        let (min, _) = ddmin(&prog, |body| body.len() == full.len());
        assert_eq!(min.body, full);
    }
}
