# ProofMesh API contract

**Status:** Proposed public API; design before implementation
**Version:** `proofmesh/0.1`

This document is intentionally written for the desired product boundary. Existing internal
functions may differ. Implementations should adapt to this contract rather than exposing current
storage, worker, or Rust details directly to applications.

## Design rules

1. Every cross-worker, storage, network, or peer operation is asynchronous.
2. Every object is content-addressed and versioned.
3. Byte ownership is explicit: callers retain their input buffers; returned buffers are owned by
   the caller and may be transferred.
4. Errors are typed and serializable.
5. Long work reports progress and supports cancellation.
6. Verifiers operate on immutable ticket hashes, not mutable URLs.

## Browser entry point

```ts
export type ProofMesh = {
  readonly version: "proofmesh/0.1";
  readonly identity: IdentityClient;
  readonly storage: EncryptedStorage;
  readonly guests: GuestClient;
  readonly work: WorkClient;
  readonly peers: PeerClient;
};

export async function createProofMesh(options: ClientOptions): Promise<ProofMesh>;
```

## Identity

```ts
type IdentityClient = {
  enroll(options: EnrollOptions): Promise<IdentityProfile>;
  authenticate(options?: AuthenticateOptions): Promise<Session>;
  listCredentials(): Promise<CredentialInfo[]>;
  addRecoverySlot(options: RecoverySlotOptions): Promise<RecoverySlot>;
  revokeCredential(id: string): Promise<void>;
  lock(): Promise<void>;
};
```

`authenticate()` proves possession of a passkey. `unlockStorage()` is a separate operation and
may use WebAuthn PRF when available. The API must expose whether the selected authenticator can
perform PRF derivation instead of silently falling back to a weaker scheme.

## Encrypted storage

```ts
type EncryptedStorage = {
  createVolume(options: VolumeOptions): Promise<VolumeHandle>;
  openVolume(ref: ManifestRef): Promise<VolumeHandle>;
  listVolumes(): Promise<VolumeInfo[]>;
  publish(volume: VolumeHandle, options?: PublishOptions): Promise<PublishReceipt>;
  restore(ref: ManifestRef): Promise<VolumeHandle>;
};

type VolumeHandle = {
  readonly manifest: Promise<ShardManifest>;
  read(path: string, options?: ReadOptions): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array, options?: WriteOptions): Promise<void>;
  commit(message?: string): Promise<ManifestRef>;
  share(policy: SharePolicy): Promise<ShareGrant>;
  close(): Promise<void>;
};
```

The storage API never exposes plaintext shards to a peer adapter. `publish()` creates an
immutable generation and returns a manifest reference; it does not imply that the generation is
publicly readable.

## Guest execution

```ts
type GuestClient = {
  boot(options: GuestBootOptions): Promise<GuestController>;
  listImages(): Promise<ImageInfo[]>;
  inspect(image: ArtifactRef): Promise<ImageInspection>;
};

type GuestController = {
  readonly id: string;
  readonly status: Promise<GuestStatus>;
  readonly whenDone: Promise<GuestExit>;
  readonly events: AsyncIterable<GuestEvent>;
  sendInput(bytes: Uint8Array): void;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(reason?: string): Promise<void>;
  snapshot(options?: SnapshotOptions): Promise<SnapshotManifest>;
};
```

## Work tickets

```ts
type WorkClient = {
  createTicket(spec: TicketDraft): Promise<WorkTicket>;
  publish(ticket: WorkTicket): Promise<TicketRef>;
  bid(ref: TicketRef, bid: BuilderBid): Promise<BidReceipt>;
  submit(ref: TicketRef, submission: BuilderSubmission): Promise<SubmissionReceipt>;
  watch(ref: TicketRef): AsyncIterable<WorkEvent>;
  challenge(ref: TicketRef, challenge: Challenge): Promise<ChallengeReceipt>;
  settle(ref: TicketRef): Promise<SettlementReceipt>;
};
```

```ts
type BuilderSubmission = {
  artifact: ArtifactRef;
  source: ArtifactRef;
  build: ReproducibilityManifest;
  proof: ProofBundle;
  measurements: Measurement[];
  builderSignature: string;
};

type CriticAttestation = {
  critic: PublicKey;
  ticket: TicketRef;
  artifact: ArtifactRef;
  verdict: "accept" | "reject" | "inconclusive";
  checks: CheckResult[];
  evidence: EvidenceRef[];
  environment: EnvironmentRef;
  signature: string;
};
```

## Peer transport

```ts
type PeerClient = {
  addSource(source: PeerSource): Promise<void>;
  removeSource(sourceId: string): Promise<void>;
  request(block: BlockRequest): Promise<VerifiedBlock>;
  stats(): Promise<PeerStats>;
};
```

Peer sources are interchangeable transports. Verification is performed after retrieval and before
cache insertion. A source that returns invalid bytes is quarantined and cannot satisfy future
requests for that digest.

## Settlement states

```text
draft → frozen → bidding → building → review → challenged → accepted | rejected | expired
```

Only `frozen` tickets may receive bids. Only artifacts attached to the exact ticket hash may be
reviewed. Settlement is monotonic and idempotent.
