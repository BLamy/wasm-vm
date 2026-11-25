
// Do not invoke result accessors or assimilate promises. The Rust sink is synchronous.
export function invokeVirglControl(callback, event) {
  try {
    const result = callback(event);
    const data = (value, keys) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || 'then' in value) throw 0;
      const fields = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(fields).length !== keys.length) throw 0;
      const out = {};
      for (const key of keys) {
        if (!Object.hasOwn(fields, key) || !Object.hasOwn(fields[key], 'value')) throw 0;
        out[key] = fields[key].value;
      }
      return out;
    };
    const descriptors = Object.getOwnPropertyDescriptors(result);
    if (Object.hasOwn(descriptors, 'ok') && Object.hasOwn(descriptors.ok, 'value') && descriptors.ok.value === true) {
      data(result, ['ok']); return 0;
    }
    const failed = data(result, ['ok', 'error']);
    if (failed.ok !== false) return 6;
    const error = data(failed.error, ['code', 'message']);
    if (typeof error.message !== 'string') return 6;
    const code = ['invalid-context-id', 'invalid-resource-id', 'invalid-parameter', 'out-of-memory', 'unspecified', 'bridge-poisoned'].indexOf(error.code);
    return code < 0 ? 6 : code + 1;
  } catch { return 6; }
}
