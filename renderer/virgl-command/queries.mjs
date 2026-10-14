/** Original boolean query objects over one physical WebGL2 context. */
export const QUERY_LIMITS = Object.freeze({ nativeParts: 4096 });

export function createBooleanQueries(gl, resources, require, unwrap, check) {
  const objects = new Set();
  let nativeParts = 0;
  const target = type => type === 1 ? gl.ANY_SAMPLES_PASSED : gl.ANY_SAMPLES_PASSED_CONSERVATIVE;
  const clear = object => {
    for (const part of object.queryParts) gl.deleteQuery(part.native);
    nativeParts -= object.queryParts.length;
    object.queryParts.length = 0;
  };
  const measure = (object, draw) => {
    require(nativeParts < QUERY_LIMITS.nativeParts, 'limit-exceeded', 'Native query part budget exceeded.');
    unwrap(resources.validateQueryStorage(object.lease));
    const native = gl.createQuery();
    require(native, 'backend-error', 'Native query allocation failed.');
    object.queryParts.push({ native, available: false, result: false }); nativeParts++;
    let begun = false;
    try {
      gl.beginQuery(target(object.fields.queryType), native); check(); begun = true;
      draw();
    } finally {
      if (begun) { gl.endQuery(target(object.fields.queryType)); check(); }
    }
  };
  return Object.freeze({
    create(object) { object.queryParts = []; object.queryState = 'new'; object.queryRequested = false; objects.add(object); },
    destroy(sub, object) { if (sub.activeBooleanQuery === object) sub.activeBooleanQuery = null; clear(object); objects.delete(object); },
    begin(sub, object) {
      require(!sub.activeBooleanQuery && object.queryState !== 'active', 'invalid-query-state', 'A boolean query is already active.');
      unwrap(resources.validateQueryStorage(object.lease)); clear(object);
      object.queryState = 'active'; object.queryRequested = false; sub.activeBooleanQuery = object;
    },
    end(sub, object) {
      require(sub.activeBooleanQuery === object && object.queryState === 'active', 'invalid-query-state', 'The query is not active in this subcontext.');
      // Empty queries also receive an actual native measurement.
      if (!object.queryParts.length) measure(object, () => {});
      unwrap(resources.publishQueryStorage(object.lease, 2));
      sub.activeBooleanQuery = null; object.queryState = 'ended';
    },
    measure(sub, draw) { if (sub.activeBooleanQuery) measure(sub.activeBooleanQuery, draw); else draw(); },
    get(object) {
      require(object.queryState === 'ended' || object.queryState === 'ready', 'invalid-query-state', 'A query result requires a completed query.');
      if (object.queryState === 'ready') { unwrap(resources.publishQueryStorage(object.lease, 1, object.queryValue)); return true; }
      object.queryRequested = true;
      return this.poll(object);
    },
    poll(object) {
      if (!object.queryRequested) return false;
      unwrap(resources.validateQueryStorage(object.lease));
      for (const part of object.queryParts) if (!part.available) {
        part.available = gl.getQueryParameter(part.native, gl.QUERY_RESULT_AVAILABLE); check();
        require(typeof part.available === 'boolean', 'backend-error', 'Invalid native query availability.');
        if (part.available) {
          part.result = gl.getQueryParameter(part.native, gl.QUERY_RESULT); check();
          require(part.result === 0 || part.result === 1, 'backend-error', 'Invalid native boolean query counter.');
        }
      }
      if (object.queryParts.some(part => !part.available)) return false;
      object.queryValue = object.queryParts.some(part => part.result) ? 1 : 0;
      unwrap(resources.publishQueryStorage(object.lease, 1, object.queryValue));
      object.queryRequested = false; object.queryState = 'ready'; clear(object); return true;
    },
    pollPending() {
      for (const object of objects) if (object.queryRequested) {
        // A detached/replaced owner cancels publication; it must not prevent
        // the guest from destroying the stale object or using other contexts.
        const owner = resources.validateQueryStorage(object.lease);
        if (!owner.ok) { object.queryRequested = false; object.queryState = 'invalid'; clear(object); continue; }
        this.poll(object);
      }
    },
    inspect() { return { objects: objects.size, nativeParts, pending: [...objects].filter(o => o.queryRequested).length }; },
  });
}
