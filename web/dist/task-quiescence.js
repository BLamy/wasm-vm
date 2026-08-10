// A tiny, environment-neutral single-flight task barrier used by the Linux scheduler.
// `stop()` first closes admission, then joins the currently active task. Callers may therefore
// release storage only after it resolves: a fetch/persist await cannot still be using that storage.
export function createTaskQuiescence(onIdle = () => {}) {
  let active = null;
  let stopping = false;

  const run = (task) => {
    if (stopping) return Promise.resolve(false);
    if (active) return active;
    let current;
    current = Promise.resolve()
      .then(task)
      .finally(() => {
        if (active === current) active = null;
        onIdle();
      });
    active = current;
    return current;
  };

  const stop = async () => {
    stopping = true;
    const current = active;
    if (current) await current;
    onIdle();
  };

  return {
    run,
    stop,
    isActive: () => active != null,
    isStopping: () => stopping,
  };
}
