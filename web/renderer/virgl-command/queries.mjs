/** Original GLES query objects over one physical WebGL2 context. */
export const QUERY_LIMITS = Object.freeze({ nativeParts: 4096 });

export function createBooleanQueries(gl, resources, require, unwrap, check) {
  const objects = new Set();
  let nativeParts = 0;
  const target = type => type === 6 ? gl.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN : type === 1 ? gl.ANY_SAMPLES_PASSED : gl.ANY_SAMPLES_PASSED_CONSERVATIVE;
  const active = object => object.fields.queryType === 6 ? 'activeFeedbackQuery' : 'activeBooleanQuery';
  const clear = object => {
    for (const part of object.queryParts) gl.deleteQuery(part.native);
    nativeParts -= object.queryParts.length;
    object.queryParts.length = 0;
  };
  const measure = (object, draw, divisor = 1) => {
    require(nativeParts < QUERY_LIMITS.nativeParts, 'limit-exceeded', 'Native query part budget exceeded.');
    unwrap(resources.validateQueryStorage(object.lease));
    const native = gl.createQuery();
    require(native, 'backend-error', 'Native query allocation failed.');
    object.queryParts.push({ native, divisor, available: false, result: 0 }); nativeParts++;
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
    destroy(sub, object) { if (sub[active(object)] === object) sub[active(object)] = null; clear(object); objects.delete(object); },
    begin(sub, object) {
      require(!sub[active(object)] && object.queryState !== 'active', 'invalid-query-state', 'A query for this target is already active.');
      unwrap(resources.validateQueryStorage(object.lease)); clear(object);
      object.queryState = 'active'; object.queryRequested = false; sub[active(object)] = object;
    },
    end(sub, object) {
      require(sub[active(object)] === object && object.queryState === 'active', 'invalid-query-state', 'The query is not active in this subcontext.');
      // Empty queries also receive an actual native measurement.
      if (!object.queryParts.length) measure(object, () => {});
      unwrap(resources.publishQueryStorage(object.lease, 2));
      sub[active(object)] = null; object.queryState = 'ended';
    },
    measure(sub, draw) { if (sub.activeBooleanQuery) measure(sub.activeBooleanQuery, draw); else draw(); },
    measureFeedback(sub, divisor, capture) {
      require([1, 2, 3].includes(divisor), 'invalid-input', 'Invalid original primitive divisor.');
      if (sub.activeFeedbackQuery) measure(sub.activeFeedbackQuery, capture, divisor); else capture();
    },
    invalidateFeedback(sub) {
      const object = sub.activeFeedbackQuery;
      if (object) { sub.activeFeedbackQuery = null; object.queryState = 'invalid'; object.queryRequested = false; clear(object); }
    },
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
        const available = gl.getQueryParameter(part.native, gl.QUERY_RESULT_AVAILABLE); check();
        require(typeof available === 'boolean', 'backend-error', 'Invalid native query availability.');
        if (available) {
          const result = gl.getQueryParameter(part.native, gl.QUERY_RESULT); check();
          require(object.fields.queryType === 6 ? Number.isInteger(result) && result >= 0 && result <= 0xffffffff && result % part.divisor === 0 : result === 0 || result === 1,
            'backend-error', 'Invalid native query counter.');
          // Commit neither field until both actual native reads validate.
          // A rejected read must remain pending and be re-read on retry.
          part.result = result; part.available = true;
        }
      }
      if (object.queryParts.some(part => !part.available)) return false;
      const value = object.fields.queryType === 6 ? object.queryParts.reduce((sum, part) => sum + part.result / part.divisor, 0) : object.queryParts.some(part => part.result) ? 1 : 0;
      if (!Number.isInteger(value) || value > 0xffffffff) {
        // The available native parts cannot represent an original result.
        // Quarantine this logical query before refusing it once; a cached
        // invalid aggregate must not fail unrelated owners' later jobs.
        object.queryRequested = false; object.queryState = 'invalid'; clear(object);
      }
      require(Number.isInteger(value) && value <= 0xffffffff, 'backend-error', 'Original query counter exceeds its result width.');
      unwrap(resources.publishQueryStorage(object.lease, 1, value)); object.queryValue = value;
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
