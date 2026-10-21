// The two v1 extensions contain only coordinates and 32-byte state digests, never CAS references.
const decoder = new TextDecoder('utf-8', {fatal: true});
const need = (value, detail) => { if (!value) throw Error('Session witnesses: ' + detail); };
const same = (a, b) => ['transition', 'retired', 'phase', 'ordinal', 'sequence'].every(key => a[key] === b[key]);
const equal = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const compare = (a, b) => {
  for (const [x, y] of [[BigInt(a.transition), BigInt(b.transition)], [a.phase === 'before' ? 0 : 1, b.phase === 'before' ? 0 : 1],
    [a.ordinal, b.ordinal], [BigInt(a.sequence), BigInt(b.sequence)]]) if (x !== y) return x < y ? -1 : 1;
  return 0;
};
export function validateSessionWitnesses(manifest, {finished = false} = {}) {
  const allowed = new Set(['e9-exact-initial-witness-v1', 'e9-exact-state-witnesses-v1']), seen = new Set();
  let states, initial;
  for (const extension of manifest.extensions) {
    need(extension && Object.keys(extension).sort().join(',') === 'bytes,kind,required'
      && allowed.has(extension.kind) && !seen.has(extension.kind) && extension.required === false, 'unsupported extension');
    seen.add(extension.kind);
    need(Array.isArray(extension.bytes) && extension.bytes.length <= 1048576
      && extension.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'extension bytes');
    const rows = JSON.parse(decoder.decode(Uint8Array.from(extension.bytes)));
    need(Array.isArray(rows) && rows.length >= 1 && rows.length <= (manifest.machine.gpu ? 64 : 4096), 'witness count');
    let previous = null;
    for (const row of rows) {
      need(row && Object.keys(row).sort().join(',') === 'digest,ordinal,phase,retired,sequence,transition'
        && ['transition', 'retired', 'sequence'].every(key => typeof row[key] === 'string'
          && /^(0|[1-9][0-9]{0,19})$/.test(row[key]) && BigInt(row[key]) <= 0xffffffffffffffffn)
        && ['before', 'observe'].includes(row.phase) && Number.isInteger(row.ordinal)
        && row.ordinal >= (row.phase === 'observe' ? 1 : 0) && row.ordinal <= 0xffffffff
        && BigInt(row.retired) <= BigInt(row.transition)
        && Array.isArray(row.digest) && row.digest.length === 32
        && row.digest.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'witness shape');
      if (previous) need(compare(previous, row) <= 0 && BigInt(previous.retired) <= BigInt(row.retired)
        && (compare(previous, row) !== 0 || same(previous, row) && equal(previous.digest, row.digest)), 'witness ordering');
      previous = row;
    }
    if (extension.kind === 'e9-exact-initial-witness-v1') {
      need(rows.length === 1 && same(rows[0], manifest.begin), 'initial witness'); initial = rows[0];
    } else {
      need(rows.length >= 2 && same(rows[0], manifest.begin) && same(rows.at(-1), manifest.end), 'state witness endpoints'); states = rows;
    }
  }
  if (finished) need(states, 'finish and save this recording before export');
  if (initial && states) need(same(initial, states[0]) && equal(initial.digest, states[0].digest), 'initial witness differs');
  return states ?? (initial ? [initial] : []);
}
