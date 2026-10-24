// Required v2 witness commitments. Payload residency is one <=16-row, <=8 KiB page.
// Legacy readers must refuse this reference-bearing feature until they implement it.
import init, {SessionSha256, sessionValidateLocalManifest, sessionValidateWitnessPage} from './session-pkg/wasm_vm_session.js';
await init();
export const WITNESS_PAGES_KIND = 'e9-exact-witness-pages-v2';
export const WITNESS_PAGE_ROWS = 16, WITNESS_PAGE_BYTES = 8192, WITNESS_MAX_PAGES = 4096;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
const need = (ok, detail) => {if (!ok) throw Error('Session witness pages: ' + detail);};
const json = value => encoder.encode(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameRef = (a, b) => a?.sha256 === b?.sha256 && a?.length === b?.length;
const position = value => ({transition: value.transition, phase: value.phase, ordinal: value.ordinal, sequence: value.sequence, retired: value.retired});
const samePosition = (a, b) => equal(position(a), position(b));
const compare = (a, b) => {
  for (const [x, y] of [[BigInt(a.transition), BigInt(b.transition)], [a.phase === 'before' ? 0 : 1, b.phase === 'before' ? 0 : 1],
    [a.ordinal, b.ordinal], [BigInt(a.sequence), BigInt(b.sequence)]]) if (x !== y) return x < y ? -1 : 1;
  return 0;
};
const follows = (a, b) => compare(a, b) > 0 && BigInt(a.sequence) >= BigInt(b.sequence) && BigInt(a.retired) >= BigInt(b.retired);
function reference(bytes) {
  const hash = new SessionSha256();
  try { hash.update(bytes); return {sha256: hash.finish(), length: String(bytes.length)}; }
  finally {hash.free();}
}
function own(value) {
  need(value && (value.digest instanceof Uint8Array || Array.isArray(value.digest)), 'owned witness digest');
  const row = {...position(value), digest: [...value.digest]};
  // The same strict native codec owns integer, coordinate, digest and field semantics.
  sessionValidateWitnessPage(json({version: 2, previous: null, before: 0, rows: [row]}));
  return row;
}
export function witnessCommitment(manifest, {finished = false} = {}) {
  if (!manifest.extensions.some(value => value.kind === WITNESS_PAGES_KIND)) return null;
  const canonical = JSON.parse(decoder.decode(sessionValidateLocalManifest(json(manifest))));
  const value = JSON.parse(decoder.decode(Uint8Array.from(canonical.extensions[1].bytes)));
  need(!finished || value.finished, 'finish the paged commitment before transfer');
  return value;
}
export function witnessExtension(value) {
  return {kind: WITNESS_PAGES_KIND, required: true, bytes: [...json(value)]};
}
async function pageBytes(source, ref) {
  need(ref && /^[1-9][0-9]{0,3}$/.test(ref.length) && Number(ref.length) <= WITNESS_PAGE_BYTES, 'page reference bound');
  const bytes = new Uint8Array(Number(ref.length)); let at = 0;
  for await (const part of source.stream(ref)) {
    need(part instanceof Uint8Array && part.length > 0 && at + part.length <= bytes.length, 'page stream bound');
    bytes.set(part, at); at += part.length;
  }
  need(at === bytes.length && sameRef(reference(bytes), ref), 'page digest/length');
  sessionValidateWitnessPage(bytes);
  return bytes;
}

// Walk backwards without accumulating witness payloads. Reference metadata is bounded
// separately; callbacks receive one owned row and must not stand in for replay admission.
export async function authenticateWitnessPages(source, manifest, {previous = null, onReference = () => {}, onWitness = () => {}, onCheckpoint = () => {}} = {}) {
  const commitment = witnessCommitment(manifest); if (!commitment) return null;
  const old = previous ? witnessCommitment(previous) : null, refs = new Map();
  let remaining = commitment.count, pages = commitment.pages, ref = commitment.tail, later = null, checkpoint = manifest.checkpoints.length - 1;
  let prefix = !old, observed = 0, maxPageBytes = 0, maxPageRows = 0;
  while (ref) {
    need(pages > 0 && remaining > 0 && refs.size < WITNESS_MAX_PAGES, 'page chain bound');
    need(!refs.has(ref.sha256), 'duplicate page reference'); refs.set(ref.sha256, {...ref});
    if (old && remaining === old.count) {
      need(pages === old.pages && sameRef(ref, old.tail), 'committed witness prefix rewritten'); prefix = true;
    }
    onReference({...ref});
    const bytes = await pageBytes(source, ref), page = JSON.parse(decoder.decode(bytes));
    need(page.before + page.rows.length === remaining, 'page count/order');
    maxPageBytes = Math.max(maxPageBytes, bytes.length); maxPageRows = Math.max(maxPageRows, page.rows.length);
    for (let index = page.rows.length - 1; index >= 0; index--) {
      const row = page.rows[index];
      if (!later) need(equal(row, commitment.last), 'last witness differs');
      else need(follows(later, row), 'cross-page witness order');
      while (checkpoint >= 0) {
        const point = manifest.checkpoints[checkpoint], order = compare(point.position, row);
        need(order <= 0, 'required checkpoint witness missing');
        if (order < 0) break;
        need(samePosition(point.position, row), 'checkpoint witness counters');
        await onCheckpoint(point, structuredClone(row)); checkpoint--;
      }
      await onWitness(structuredClone(row), remaining - (page.rows.length - index));
      later = row; observed++;
    }
    remaining = page.before; pages--; ref = page.previous;
  }
  need(remaining === 0 && pages === 0 && observed === commitment.count && checkpoint === -1
    && equal(later, commitment.first) && prefix, 'incomplete witness closure/prefix');
  return {commitment, refs: [...refs.values()], count: observed, maxPageBytes, maxPageRows};
}

export class SessionWitnessPages {
  #committed; #pending = []; #peak = 0;
  constructor(committed = null) {this.#committed = committed ? structuredClone(committed) : null;}
  get pending() {return this.#pending.length;}
  get peakRows() {return this.#peak;}
  get last() {return structuredClone(this.#pending.at(-1) ?? this.#committed?.last ?? null);}
  get committed() {return structuredClone(this.#committed);}
  stage(value) {
    need(!this.#committed?.finished && this.#pending.length < WITNESS_PAGE_ROWS, 'resident witness window');
    const row = own(value), previous = this.#pending.at(-1) ?? this.#committed?.last;
    if (previous && samePosition(row, previous)) {need(equal(row, previous), 'conflicting duplicate witness'); return;}
    need(!previous || follows(row, previous), 'staged witness order'); this.#pending.push(row); this.#peak = Math.max(this.#peak, this.#pending.length);
  }
  async prepare(writer, {extra = [], finished = false} = {}) {
    need(!this.#committed?.finished && extra.length <= 1, 'finished witness commitment');
    const rows = this.#pending.slice();
    for (const value of extra) {
      const row = own(value), previous = rows.at(-1) ?? this.#committed?.last;
      if (previous && samePosition(row, previous)) {need(equal(row, previous), 'conflicting duplicate witness'); continue;}
      need(!previous || follows(row, previous), 'appended witness order'); rows.push(row);
    }
    need(rows.length <= WITNESS_PAGE_ROWS && (rows.length || this.#committed), 'resident witness page');
    this.#peak = Math.max(this.#peak, rows.length);
    let next = this.#committed ? structuredClone(this.#committed) : null;
    if (rows.length) {
      need((next?.pages ?? 0) < WITNESS_MAX_PAGES, 'durable witness page count');
      const bytes = json({version: 2, previous: next?.tail ?? null, before: next?.count ?? 0, rows});
      sessionValidateWitnessPage(bytes); const tail = reference(bytes);
      await writer.put(tail, (function* () {yield bytes;})());
      next = {version: 2, count: (next?.count ?? 0) + rows.length, pages: (next?.pages ?? 0) + 1,
        tail, first: next?.first ?? rows[0], last: rows.at(-1), finished: false};
    }
    need(!finished || next.count >= 2, 'finished witness count'); next.finished = finished;
    return next;
  }
  accept(value) {this.#committed = structuredClone(value); this.#pending = [];}
}
