# ProofMesh product roadmap

This roadmap is the product layer above the existing `wasm-vm` machine roadmap. It intentionally
starts with contracts and verifiers before implementation details.

## North-star outcome

A user opens a URL, unlocks a persistent Linux computer with a passkey, and uses it without
knowing whether an immutable block came from a web seed, a peer, or a local cache. The same
environment can publish a reproducible optimization ticket, accept work from remote builders,
and pay independent critics only when the result survives verification.

## Release tracks

### Track A — product contract

- [ ] Freeze `proofmesh/0.1` schemas for identity, volumes, tickets, artifacts, proofs, critics,
  peers, and settlement.
- [ ] Publish threat model, data-retention model, and recovery policy.
- [ ] Build a reference JSON canonicalizer and hash tool.
- [ ] Define the deterministic verifier image and evidence format.

**Exit gate:** two independent implementations can parse the same ticket and compute identical
hashes.

### Track B — local builder/critic loop

- [ ] Run one builder and three critics against a local `wasm-vm` workload.
- [ ] Freeze a baseline, benchmark, and differential correctness suite before the builder runs.
- [ ] Persist signed reports and replayable traces.
- [ ] Implement quorum, challenge, and idempotent settlement without a token.

**Exit gate:** a deliberately broken optimization is rejected with a replayable counterexample;
an accepted optimization is reproducible from a clean checkout.

### Track C — passkey-owned encrypted volumes

- [ ] Enroll multiple passkeys.
- [ ] Feature-detect WebAuthn PRF and expose its availability in the identity API.
- [ ] Generate random volume keys and wrap them in credential/recovery slots.
- [ ] Encrypt overlay generations and verify every shard before mounting.
- [ ] Implement recovery, credential rotation, revocation, and data-loss warnings.

**Exit gate:** a second authorized device restores the same volume; an unauthorized device sees
only ciphertext and cannot mount it.

### Track D — verified block distribution

- [ ] Define the content-addressed manifest and shard format.
- [ ] Implement demand, cache, verification, and cancellation semantics.
- [ ] Add HTTP fallback and a peer transport behind one `BlockSource` API.
- [ ] Add WebRTC/torrent-like seeding for immutable base and encrypted generations.
- [ ] Measure metadata leakage, peer withholding, stale generations, and cache poisoning.

**Exit gate:** the same guest boots from at least two source classes with identical block and
architectural-state digests.

### Track E — critic network

- [ ] Register critic capabilities, toolchain hashes, stake, and reputation.
- [ ] Add random assignment and commit/reveal verdicts.
- [ ] Add independent runtime/toolchain diversity requirements.
- [ ] Implement critic fees, failure bounties, builder bonds, and challenge escalation.
- [ ] Add optional zkVM/interactive proof bundles for suitable tasks.

**Exit gate:** a five-critic run survives a colluding pair, a crashed critic, a false approval,
and a hidden-test mutation.

### Track F — public marketplace

- [ ] Add reverse auctions and open bounty contests.
- [ ] Add stable accounting and a policy-reviewed staking asset.
- [ ] Publish accepted artifacts, reports, and reproducibility manifests.
- [ ] Add API keys, quotas, abuse controls, and private-ticket support.

**Exit gate:** an external requester can publish, fund, review, challenge, and settle a ticket
without operator intervention.

### Track G — distributed operating environment

- [ ] Replicate encrypted user generations across selected peers.
- [ ] Add conflict-aware snapshot/event-log semantics.
- [ ] Add remote services and process placement across browser nodes.
- [ ] Define failure, partition, and recovery behavior.

**Exit gate:** multiple browser nodes cooperate on a user-visible service while preserving clear
ownership, consistency, and recovery guarantees.

## Product principles

- **Verifier before token.** Payment cannot rescue a weak acceptance contract.
- **Async by default.** No API should hide network, storage, or worker latency.
- **Private by default.** User overlays are local until the user explicitly shares a generation.
- **Transport is replaceable.** HTTP, peers, and torrents are sources, not trust anchors.
- **Evidence is a product feature.** Every accepted artifact should be inspectable and replayable.
- **AI proposes; deterministic code decides.** AI may draft tickets, tests, or critic reports, but
  settlement relies on executable, hashed policy.
- **No accidental distributed-OS claims.** Distributed delivery and storage come before
  distributed process execution.
