//! Admission rejects malformed replay coordinates before any machine is constructed.
#![cfg(not(feature = "zicsr-stub"))]
use wasm_vm_core::session_clock::sources::{ObservationKind, ObservationValue};
use wasm_vm_core::session_clock::{SessionDelivery, SessionEffect, SessionPhase, SessionPosition};
use wasm_vm_core::session_replay::{
    MAX_INITIAL_BYTES, MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS, ReplayPlan, ReplayReason, StateWitness,
};

fn at(transition: u64, retired: u64, ordinal: u32, sequence: u64) -> SessionPosition {
    SessionPosition {
        transition,
        retired,
        ordinal,
        sequence,
        phase: SessionPhase::Before,
    }
}

fn witness(position: SessionPosition) -> StateWitness {
    StateWitness {
        position,
        resume_sha256: [0; 32],
    }
}

fn plan() -> ReplayPlan {
    let begin = at(0, 0, 0, 0);
    let end = at(1, 1, 0, 0);
    ReplayPlan {
        begin,
        end,
        initial_resume: vec![1],
        events: vec![],
        witnesses: vec![witness(begin), witness(end)],
    }
}

fn with_event() -> ReplayPlan {
    let mut plan = plan();
    plan.events.push(SessionDelivery {
        position: at(0, 0, 1, 1),
        ticket: 1,
        effect: SessionEffect::HostInput {
            channel: 2,
            bytes: vec![1],
        },
        host_result: None,
    });
    plan.end.sequence = 1;
    plan.witnesses[1].position.sequence = 1;
    plan
}

fn rejected(plan: &ReplayPlan, reason: ReplayReason, detail: &str, index: usize) {
    let error = plan.validate().unwrap_err();
    assert_eq!(error.reason, reason);
    assert_eq!(error.detail, detail);
    assert_eq!(error.event_index, index);
}

#[test]
fn interval_and_count_bounds_are_independently_rejected() {
    assert!(plan().validate().is_ok());
    let changes: [fn(&mut ReplayPlan); 10] = [
        |p: &mut ReplayPlan| p.begin.phase = SessionPhase::Observe,
        |p| p.end.phase = SessionPhase::Observe,
        |p| p.begin.transition = 2,
        |p| p.begin.sequence = 1,
        |p| p.begin.retired = 1,
        |p| p.end.retired = 2,
        |p| p.initial_resume.clear(),
        |p| p.witnesses.clear(),
        |p| {
            p.events
                .resize(MAX_REPLAY_EVENTS + 1, with_event().events[0].clone())
        },
        |p| p.witnesses.resize(MAX_REPLAY_EVENTS + 1, witness(p.end)),
    ];
    for change in changes {
        let mut candidate = plan();
        change(&mut candidate);
        rejected(
            &candidate,
            ReplayReason::InvalidPlan,
            "invalid interval or bound",
            0,
        );
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn oversized_initial_resume_is_rejected_before_decode() {
    let mut candidate = plan();
    candidate.initial_resume = vec![0; MAX_INITIAL_BYTES + 1];
    rejected(
        &candidate,
        ReplayReason::InvalidPlan,
        "invalid interval or bound",
        0,
    );
}

#[test]
fn event_coordinates_report_the_first_bad_index() {
    assert!(with_event().validate().is_ok());
    let changes: [fn(&mut ReplayPlan); 5] = [
        |p: &mut ReplayPlan| p.events[0].position.phase = SessionPhase::Observe,
        |p| p.events[0].position.ordinal = 0,
        |p| p.events[0].position.retired = 1,
        |p| p.events[0].position.sequence = 2,
        |p| p.events[0].position.transition = 2,
    ];
    for change in changes {
        let mut candidate = with_event();
        change(&mut candidate);
        rejected(
            &candidate,
            ReplayReason::InvalidPlan,
            "event order or coordinate",
            0,
        );
    }
    let mut overflow = with_event();
    overflow.begin.sequence = u64::MAX;
    overflow.end.sequence = u64::MAX;
    overflow.witnesses[0].position.sequence = u64::MAX;
    overflow.witnesses[1].position.sequence = u64::MAX;
    overflow.events[0].position.sequence = u64::MAX;
    rejected(&overflow, ReplayReason::InvalidPlan, "sequence overflow", 0);

    let mut same_transition = with_event();
    same_transition.events.push(SessionDelivery {
        position: at(0, 0, 2, 2),
        ..same_transition.events[0].clone()
    });
    same_transition.events[1].position.retired = 1;
    same_transition.end.sequence = 2;
    same_transition.witnesses[1].position.sequence = 2;
    rejected(
        &same_transition,
        ReplayReason::InvalidPlan,
        "event order or coordinate",
        1,
    );

    let mut bytes = with_event();
    bytes.events[0].effect = SessionEffect::HostInput {
        channel: 2,
        bytes: vec![0; MAX_REPLAY_BYTES + 1],
    };
    rejected(
        &bytes,
        ReplayReason::InvalidPlan,
        "event byte bound exceeded",
        0,
    );
}

#[test]
fn remaining_event_order_predicates_reject_the_first_bad_coordinate() {
    let mut at_end = with_event();
    at_end.events[0].position = SessionPosition {
        phase: SessionPhase::Observe,
        ..at(1, 1, 1, 1)
    };
    at_end.events[0].effect = SessionEffect::Observation(ObservationValue {
        kind: ObservationKind::RtcRead,
        requested: 8,
        status: 0,
        bytes: vec![0; 8],
    });
    rejected(
        &at_end,
        ReplayReason::InvalidPlan,
        "event order or coordinate",
        0,
    );

    let mut before_begin = with_event();
    before_begin.begin = at(5, 5, 0, 0);
    before_begin.end = at(6, 6, 0, 1);
    before_begin.events[0].position = at(4, 4, 1, 1);
    before_begin.witnesses[0].position = before_begin.begin;
    before_begin.witnesses[1].position = before_begin.end;
    rejected(
        &before_begin,
        ReplayReason::InvalidPlan,
        "event order or coordinate",
        0,
    );

    let mut ordinal_gap = with_event();
    ordinal_gap.events[0].position.ordinal = 2;
    rejected(
        &ordinal_gap,
        ReplayReason::InvalidPlan,
        "event order or coordinate",
        0,
    );

    let mut retired_regression = with_event();
    retired_regression.events[0].position = at(1, 1, 1, 1);
    retired_regression.events.push(SessionDelivery {
        position: at(2, 0, 1, 2),
        ..retired_regression.events[0].clone()
    });
    retired_regression.end = at(3, 3, 0, 2);
    retired_regression.witnesses[1].position = retired_regression.end;
    rejected(
        &retired_regression,
        ReplayReason::InvalidPlan,
        "event order or coordinate",
        1,
    );
}

#[test]
fn witness_order_and_end_event_errors_are_distinct() {
    let changes: [fn(&mut ReplayPlan); 4] = [
        |p: &mut ReplayPlan| p.witnesses[0].position.phase = SessionPhase::Observe,
        |p| p.witnesses[1].position = p.witnesses[0].position,
        |p| p.witnesses[1].position.transition = 2,
        |p| p.witnesses[1].position.retired = 2,
    ];
    for change in changes {
        let mut candidate = plan();
        change(&mut candidate);
        rejected(&candidate, ReplayReason::InvalidPlan, "witness order", 0);
    }
    let mut no_initial = plan();
    no_initial.witnesses[0].position = at(0, 0, 1, 0);
    rejected(
        &no_initial,
        ReplayReason::InvalidPlan,
        "initial and final witnesses required",
        0,
    );
    let mut no_final = plan();
    no_final.witnesses[1].position = at(1, 1, 1, 0);
    rejected(
        &no_final,
        ReplayReason::InvalidPlan,
        "initial and final witnesses required",
        0,
    );
    let mut extra = with_event();
    extra.end.sequence = 0;
    extra.witnesses[1].position.sequence = 0;
    rejected(
        &extra,
        ReplayReason::ExtraEvent,
        &extra.validate().unwrap_err().detail,
        0,
    );
}
