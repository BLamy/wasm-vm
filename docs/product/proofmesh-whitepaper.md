# ProofMesh

## A passkey-secured browser operating system and verifiable work market

**Status:** Product and protocol proposal
**Working name:** ProofMesh
**Reference implementation:** `wasm-vm`
**Protocol version:** `0.1-draft`

## Abstract

ProofMesh is a browser-native computing network built around a real Linux guest. A
content-addressed operating-system image is streamed on demand into a WebAssembly virtual
machine. Each user gets a writable overlay, unlocked by a passkey and encrypted before it is
cached, replicated, or shared over a peer-to-peer network.

On top of that operating system, ProofMesh introduces a market for **verifiable useful work**.
A requester publishes a task containing a frozen source tree, benchmark, correctness contract,
and verifier. A builder proposes an artifact—such as an optimization that makes a workload
ten times faster. Several independent critics execute the artifact and return signed,
machine-checkable attestations. Settlement occurs only after a quorum of critics accepts the
same immutable artifact or a challenge process resolves a disagreement.

The system is not a claim that every real-world performance result can be proven with a single
cryptographic primitive. It instead makes the acceptance boundary explicit: a result is valid
when a deterministic verifier, operating over a content-addressed environment and workload,
produces an accepted result. Cryptographic proofs, deterministic replay, redundant execution,
and challenge games are complementary verification mechanisms.

ProofMesh therefore combines four ideas:

1. **A Linux computer in a browser.** The user gets a real guest operating system, not only a
   JavaScript API shim.
2. **A distributed image and storage substrate.** Immutable base blocks can come from HTTP,
   WebRTC, or torrent-like peers; private overlay shards are encrypted before distribution.
3. **Passkey-controlled ownership.** WebAuthn authenticates the user. Where the browser and
   authenticator support WebAuthn PRF, its output can unlock a locally generated data key; the
   passkey private key itself is never exported.
4. **A builder/critic work market.** Useful software improvements are paid for only after
   reproducible verification, not merely after a worker claims success.

## 1. The thesis

The cloud currently separates compute, storage, identity, and software delivery. A browser tab
can become a different kind of computer: it can assemble a Linux machine from verified blocks,
keep the user's writes private, and request work from other machines without giving those
machines authority over the user's identity or filesystem.

The central design principle is **content-addressed trust**:

- code, images, task specifications, verifiers, artifacts, and reports are addressed by hashes;
- a peer can transport bytes without being trusted to choose their meaning;
- an artifact is accepted because a verifier reproduces the claimed result;
- a user's encryption key is controlled by the user, not by the block distributor;
- settlement references immutable hashes rather than mutable URLs or informal promises.

ProofMesh does not require one global server to be available for ordinary reads. HTTP remains a
simple fallback; peers improve availability and cost rather than becoming a mandatory trust
anchor.

## 2. Product surfaces

### 2.1 Browser Linux

The reference machine is a Rust RV64 virtual machine compiled to WebAssembly. It boots an
unmodified Linux kernel and userland in a browser tab. The browser owns the execution process;
the network supplies immutable blocks and optional services.

The public browser API is intentionally controller-oriented:

```ts
type GuestController = {
  readonly backend: "main-thread" | "whole-machine-worker";
  readonly restoredFromBootSnapshot: Promise<boolean>;
  readonly whenDone: Promise<GuestExit>;
  sendInput(bytes: Uint8Array): void;
  run(command: string, options?: RunOptions): Promise<CommandResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(reason?: string): Promise<void>;
  stateDigest(): Promise<StateDigest>;
  snapshotSave(options?: SnapshotOptions): Promise<SnapshotManifest>;
};
```

The API is asynchronous at every boundary that may cross a worker, storage backend, or peer.
Synchronous-looking worker proxies are deliberately excluded from the public contract.

### 2.2 User-owned encrypted storage

The base operating system is immutable and deduplicated. User writes are recorded in an overlay
made of encrypted, content-addressed shards. The browser maintains a small write-back cache;
replication happens from stable snapshot generations rather than from every individual block
write.

The storage hierarchy is:

```text
passkey authentication / PRF unlock
              ↓
      key-encryption key (KEK)
              ↓
        random root data key
              ↓
       generation and shard keys
              ↓
       authenticated ciphertext shards
```

Every shard uses an authenticated encryption mode with a fresh nonce. The manifest authenticates
the shard list, generation number, base-image identity, and logical size. A peer can store and
serve ciphertext without learning the plaintext.

The passkey is an authentication credential, not a portable password. WebAuthn normally proves
possession of a public-key credential; implementations must feature-detect the PRF extension
and provide recovery enrollment for devices or authenticators that do not expose a stable
derivation output. A user's recovery key, second passkey, or encrypted export is part of the
product contract, not an afterthought.

### 2.3 Distributed delivery

Immutable base blocks and encrypted overlay shards are content-addressed. A client requests a
block by its digest and can choose a source by policy:

1. in-memory cache;
2. local persistent cache;
3. same-origin or trusted HTTP seed;
4. WebRTC/torrent-like peer;
5. an authenticated fallback service.

Demand paging remains smart in a peer network. The guest asks for the specific block it faults
on; the scheduler can prefetch adjacent or profiled blocks; verification happens before the
block enters the guest cache. Prefetch is advisory and cancellable: it must never delay the
critical demand block indefinitely.

Encrypted user snapshots can be seeded across the network, but encryption does not hide all
metadata. Peers may still observe object sizes, timing, popularity, and availability unless an
additional traffic-shaping layer is added.

### 2.4 Verifiable work market

A requester publishes a **work ticket**. The ticket is a signed, content-addressed contract that
describes exactly what counts as success.

```ts
type WorkTicket = {
  ticketId: string;
  protocolVersion: "proofmesh/0.1";
  requester: PublicKey;
  source: ArtifactRef;
  baseline: ArtifactRef;
  verifier: ArtifactRef;
  benchmark: BenchmarkSpec;
  correctness: CorrectnessSpec;
  allowedChanges: ChangePolicy;
  acceptance: AcceptanceRule;
  privacy: PrivacyPolicy;
  escrow: EscrowRef;
  deadlines: DeadlinePolicy;
};
```

For an optimization ticket, the acceptance rule might state:

```ts
{
  metric: "median_guest_cycles",
  baseline: 1000000000,
  maximum: 100000000,
  repetitions: 7,
  confidence: { kind: "bootstrap", maxSpread: 0.05 },
  requiredCorrectness: "differential-trace-equal"
}
```

The phrase “make this ten times faster” is therefore translated into a reproducible metric,
not left as a subjective claim.

## 3. Builder and critic protocol

### 3.1 Roles

- **Requester:** supplies the problem, freezes the verifier, and funds escrow.
- **Builder:** produces a candidate artifact and proof bundle.
- **Critic:** independently checks the artifact and reports a signed verdict.
- **Challenge critic:** investigates disagreements or suspicious approvals.
- **Settlement service or chain:** records the ticket, attestations, disputes, and payment.

“Miner” is a useful metaphor, but “builder” or “provider” is clearer: the participant is doing
useful work rather than burning energy to win a hash race.

### 3.2 Ticket lifecycle

1. The requester creates a ticket and deposits the reward, critic fees, and challenge reserve.
2. The verifier, benchmark, base image, policy, and acceptance rule are frozen and hashed.
3. Builders bid a price, completion estimate, or stake. The requester selects a builder, or the
   network runs an open bounty contest.
4. The builder submits an artifact, reproducibility manifest, and result bundle.
5. Critics independently obtain the artifact and run their assigned checks.
6. Critics commit to verdict hashes before seeing other verdicts, then reveal reports.
7. A quorum accepts, rejects, or escalates the ticket.
8. A challenge window allows a replayable counterexample. A successful challenge changes the
   settlement outcome and may slash a false attestation.
9. The accepted artifact, verifier reports, and final state transition become permanent records.

### 3.3 What critics test

Critics should be specialized rather than identical copies of one AI prompt:

- semantic equivalence and differential traces;
- benchmark integrity and anti-cheating properties;
- performance measurement and variance;
- memory safety, sandbox escape, and dependency policy;
- reproducible rebuilds from source;
- license and supply-chain constraints;
- proof validity and manifest/hash consistency.

The final decision is a structured vector of attestations, not just a natural-language “looks
good.” AI may help generate a report, but an executable verifier, replay trace, or proof checker
must be the authority.

### 3.4 Quorum and independence

Unanimity is usually the wrong rule. One crashed or dishonest critic should not block a valid
ticket. A policy such as four approvals out of five, plus an available challenge slot, is easier
to operate while preserving detection power.

The quorum policy must account for:

- Sybil identities;
- colluding builders and critics;
- correlated bugs from the same verifier implementation;
- machine-specific benchmark noise;
- unavailable or censoring critics.

Random assignment, stake, reputation, independent toolchains, hidden test seeds, and occasional
re-verification all reduce correlated failure. No economic mechanism can make a bad specification
good; specification quality remains the requester's responsibility.

### 3.5 Payment model

Critics should be paid for completing a valid review, not only for voting “approve.” A sound
default is:

- a fixed review fee for an on-time, reproducible report;
- a failure bounty for a replayable counterexample;
- an approval bonus when the ticket reaches quorum;
- a stake that can be slashed for a false acceptance;
- a builder reward only after acceptance;
- a builder bond covering reproducibility failures or malicious submissions.

The protocol can begin with stable credits or escrowed fiat-denominated accounting. A native
token can be introduced later for staking, reputation, and settlement, but the token should not
be confused with the security proof. A token cannot make an invalid benchmark valid.

## 4. Proof model

There are three useful proof levels.

### Level A: deterministic replay

The verifier runs the artifact in a fixed sandbox and compares outputs, guest traces, state
digests, and resource counters. This is the preferred first implementation because it is easy to
inspect and handles arbitrary software.

### Level B: redundant and challenged execution

Several critics run the same verifier independently. A disagreement opens a challenge game or
additional replay. This is more flexible than requiring every workload to fit a zero-knowledge
circuit, but it requires economic assumptions and enough independent capacity.

### Level C: cryptographic execution proofs

A builder can supply a SNARK, STARK, or zkVM proof that a specified verifier executed over a
specified input and produced a result. This can reduce the amount of work a critic must repeat.
It does not, by itself, prove that a wall-clock benchmark is representative of every machine.
The benchmark's measurement policy remains part of the statement being proved.

The protocol should support all three levels through one `ProofBundle` interface rather than
forcing every task into one proof system:

```ts
type ProofBundle = {
  execution?: TraceRef;
  cryptographic?: ProofRef;
  measurements: Measurement[];
  reproducibility: ReproducibilityManifest;
  signatures: SignedAttestation[];
};
```

## 5. Security and privacy

### 5.1 Passkeys

WebAuthn authentication and encryption unlock are separate operations. The browser verifies the
credential locally or through the relying-party service, then requests a PRF output only when a
supported authenticator and user-verification policy are present. The PRF output is used as key
material for a KDF and key unwrap, never as a raw password.

The system must support:

- two or more enrolled passkeys;
- an encrypted recovery export;
- credential rotation without re-encrypting every shard;
- revocation of a key-encryption slot;
- clear warnings that peers may retain old ciphertext forever;
- origin pinning and release integrity for the browser application.

If the application JavaScript itself is compromised, it may observe plaintext while the user is
working. Storage encryption protects caches and peers; it does not turn an untrusted page into a
trusted operating-system kernel. Stronger deployments need signed releases, a browser extension,
or a hardware-backed application boundary.

### 5.2 Peer threats

Peers are untrusted transport nodes. Every block must be checked against its digest before use.
Manifests and generations must be signed. A peer can withhold, replay, or reorder ciphertext, but
it must not be able to alter accepted plaintext without detection.

Availability is not the same as confidentiality. A private shard that has been uploaded to a
public swarm remains recoverable by anyone who obtains the key. Users need explicit controls for
whether a generation is local-only, invited-peer, or public-seedable.

### 5.3 Builder threats

Builders may:

- change the benchmark instead of optimizing the target;
- return a precomputed answer for a narrow visible input;
- omit a required side effect;
- exploit nondeterminism or measurement noise;
- hide a dependency or supply-chain payload;
- submit an artifact that passes one critic's environment but not another's.

The ticket must therefore lock the input, verifier, output contract, environment, dependency
policy, and random seeds. Hidden and metamorphic tests are valuable, but they must be generated
from a committed policy so the requester cannot change the rules after seeing a result.

## 6. Network and storage protocol

Every immutable object is identified by a multihash. A manifest maps logical blocks to digests,
sizes, encryption metadata, and generation parents.

```ts
type ShardManifest = {
  format: "proofmesh/shards/1";
  owner: PublicKey;
  baseImage: ArtifactRef;
  generation: number;
  parent?: ManifestRef;
  shards: Array<{
    index: number;
    digest: Digest;
    ciphertextBytes: number;
    nonce: string;
  }>;
  signature: string;
};
```

The browser scheduler exposes priority but not transport identity to the guest:

```ts
type BlockRequest = {
  digest: Digest;
  priority: "fault" | "read-ahead" | "snapshot";
  deadline?: number;
};

type BlockSource = {
  get(request: BlockRequest): Promise<VerifiedBlock>;
  announce(ref: ArtifactRef): Promise<void>;
  cancel(requestId: string): void;
};
```

Demand blocks have strict deadlines. Read-ahead requests are cancellable and must be bounded so
they cannot create the kind of sequential network stall that makes a browser guest feel frozen.

## 7. Governance and settlement

The first version should use a small, inspectable coordinator that stores signed tickets and
reports. Later versions can anchor hashes and escrow state to a public chain or a replicated
ledger. Governance should distinguish:

- protocol upgrades;
- verifier registry updates;
- token and treasury policy;
- emergency revocation of compromised verifiers;
- dispute decisions.

Verifier upgrades must never silently reinterpret old tickets. A ticket names the exact verifier
version and acceptance rules that apply to it.

## 8. Roadmap

### Phase 0 — specification

- [ ] Freeze `proofmesh/0.1` schemas for identity, volumes, tickets, artifacts, proofs, critics,
  peers, and settlement.
- [ ] Publish threat model, data-retention model, and recovery policy.
- [ ] Build a reference JSON canonicalizer and hash tool.
- [ ] Define the deterministic verifier image and evidence format.

### Phase 1 — local proof loop

- [ ] Run one builder and three critics on one machine.
- [ ] Use real `wasm-vm` workloads and guest instruction/state traces.
- [ ] Accept optimization tickets only after exact replay and differential tests.
- [ ] No token; use local escrow records.

**Exit gate:** a deliberately broken optimization is rejected with a replayable counterexample;
an accepted optimization is reproducible from a clean checkout.

### Phase 2 — browser storage identity

- [ ] Add passkey enrollment and recovery slots.
- [ ] Feature-detect WebAuthn PRF and expose its availability in the identity API.
- [ ] Generate random volume keys and wrap them in credential/recovery slots.
- [ ] Encrypt overlay generations and verify every shard before mounting.
- [ ] Implement recovery, credential rotation, revocation, and data-loss warnings.

**Exit gate:** a second authorized device restores the same volume; an unauthorized device sees
only ciphertext and cannot mount it.

### Phase 3 — peer-assisted delivery

- [ ] Define the content-addressed manifest and shard format.
- [ ] Implement demand, cache, verification, and cancellation semantics.
- [ ] Add HTTP fallback and a peer transport behind one `BlockSource` API.
- [ ] Add WebRTC/torrent-like seeding for immutable base and encrypted generations.
- [ ] Measure metadata leakage, peer withholding, stale generations, and cache poisoning.

**Exit gate:** the same guest boots from at least two source classes with identical block and
architectural-state digests.

### Phase 4 — critic network

- [ ] Register critic capabilities, toolchain hashes, stake, and reputation.
- [ ] Add random assignment and commit/reveal verdicts.
- [ ] Add independent runtime/toolchain diversity requirements.
- [ ] Implement critic fees, failure bounties, builder bonds, and challenge escalation.
- [ ] Add optional zkVM/interactive proof bundles for suitable tasks.

**Exit gate:** a five-critic run survives a colluding pair, a crashed critic, a false approval,
and a hidden-test mutation.

### Phase 5 — public marketplace

- [ ] Add reverse auctions and open bounty contests.
- [ ] Add stable accounting and a policy-reviewed staking asset.
- [ ] Publish accepted artifacts, reports, and reproducibility manifests.
- [ ] Add API keys, quotas, abuse controls, and private-ticket support.

**Exit gate:** an external requester can publish, fund, review, challenge, and settle a ticket
without operator intervention.

### Phase 6 — multi-node collaboration

- [ ] Replicate encrypted user generations across selected peers.
- [ ] Add conflict-aware snapshot/event-log semantics.
- [ ] Add remote services and process placement across browser nodes.
- [ ] Define failure, partition, and recovery behavior.

### Phase 7 — distributed operating environment

- [ ] Explore process placement, remote execution, shared service discovery, and fault-tolerant
  coordination across browser nodes.
- [ ] Only at this stage should the project claim that the operating system itself—not merely its
  image delivery and storage—is distributed.

## 9. Non-goals

ProofMesh is not initially:

- a replacement for a general cloud provider;
- a promise of universal hardware-independent speedups;
- a way to recover data after every lost passkey;
- a proof that an AI-generated specification is correct;
- a requirement that every block be served by a peer;
- a permission to run untrusted builder artifacts outside a sandbox.

## 10. Success criteria

The project is successful when a new user can:

1. open a URL and boot a real Linux environment;
2. enroll two passkeys and create an encrypted writable overlay;
3. reload on another authorized device and restore the same state;
4. receive required base and private blocks from multiple verified sources;
5. publish an optimization ticket with a frozen verifier;
6. watch several independent critics reproduce the result;
7. inspect the signed evidence and settlement decision;
8. reproduce the accepted artifact locally without trusting a single operator.

The central promise is not that the network makes trust disappear. It is that trust is moved into
small, explicit, replayable contracts that can be inspected, challenged, and improved.
