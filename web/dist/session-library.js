// E9-T06: a visible library over the real immutable checkpoint store.
// Names and wall-clock capture labels are display metadata, never execution identity.
import {GPU_CHECKPOINT_BUILD_ID, SOFTWARE_CHECKPOINT_WASM_SHA256} from './gpu-checkpoint-build.js';

const META_KEY = 'wasm-vm.session-library.v1';
const decoder = new TextDecoder();
const uid = prefix => prefix + crypto.randomUUID();
const bytesLabel = bytes => `${(bytes / 1048576).toFixed(1)} MiB`;
const errorState = error => /runtime unavailable|incompatible|software checkpoint profile/.test(error.message)
  ? 'incompatible' : /Corrupt|MissingObject|unavailable|checkpoint identity|historical disk/.test(error.message)
    ? 'incomplete' : 'storage-error';

export async function mountSessionLibrary(root, adapter) {
  if (!root) return null;
  const library = new SessionLibrary(root, adapter);
  await library.initialize();
  return library;
}

class SessionLibrary {
  constructor(root, adapter) {
    this.root = root; this.adapter = adapter;
    this.controls = Object.fromEntries([...root.querySelectorAll('[data-session]')].map(el => [el.dataset.session, el]));
    this.rows = new Map(); this.metadata = new Map(); this.selected = ''; this.preview = null;
    this.generation = 0; this.refreshGeneration = 0; this.busy = false; this.active = null; this.recording = null;
    this.state('loading', 'Reading local checkpoints…');
    const c = this.controls;
    for (const [key, action, progress] of [
      ['new', () => this.newGuest(), 'restoring'], ['start', () => this.start(), 'capturing'],
      ['checkpoint', () => this.capture(), 'capturing'], ['stop', () => this.stop(), 'capturing'],
      ['open', () => this.open(), 'restoring'],
      ['refresh', () => this.refresh(), 'loading'], ['resume', () => this.resume(), 'resuming'],
    ]) c[key].addEventListener('click', () => void this.run(action, progress));
    c.sessions.addEventListener('change', () => void this.select(c.sessions.value));
    c.points.addEventListener('change', () => this.render());
    root.querySelector('form').addEventListener('submit', event => {event.preventDefault(); void this.run(() => this.rename(), 'saving');});
    window.addEventListener('wvm:guest-ready', () => this.render());
  }
  state(value, message) {
    this.root.dataset.state = value; this.controls.status.textContent = message; this.render();
  }
  async initialize() {
    try {
      const [{SessionStore}, {SessionCheckpoints, readCheckpointObject}, {SessionDiskRoots}] = await Promise.all([
        import('./session-store.js'), import('./session-checkpoints.js'), import('./session-disk-roots.js'),
      ]);
      this.store = await SessionStore.open(); this.checkpoints = new SessionCheckpoints(this.store);
      this.readObject = readCheckpointObject; this.diskRoots = new SessionDiskRoots(this.store);
      let metadataError = null;
      try {
        const stored = JSON.parse(localStorage.getItem(META_KEY) ?? '{"version":1,"rows":[]}');
        if (stored.version !== 1 || !Array.isArray(stored.rows) || stored.rows.length > 256) throw Error('Invalid session labels');
        for (const row of stored.rows) {
          if (typeof row.id !== 'string' || !/^[A-Za-z0-9_.:/-]{1,64}$/.test(row.id)
            || typeof row.name !== 'string' || row.name.length > 96 || !Array.isArray(row.points)
            || row.points.length > 4096 || !row.points.every(p => typeof p.id === 'string' && Number.isSafeInteger(p.at))
            || !Number.isSafeInteger(row.started) || !Number.isSafeInteger(row.updated)) throw Error('Invalid session labels');
          this.metadata.set(row.id, row);
        }
      } catch (error) {this.metadata.clear(); metadataError = error;}
      await this.refresh();
      if (metadataError) this.state('storage-error', `Saved checkpoints are intact; local labels could not be read: ${metadataError.message}`);
    } catch (error) {this.state('storage-error', `Local sessions unavailable: ${error.message}`);}
    this.render();
  }
  persistMetadata(next) {
    if (next.size > 256) throw Error('Session label limit reached');
    localStorage.setItem(META_KEY, JSON.stringify({version: 1, rows: [...next.values()]}));
    this.metadata = next;
  }
  async run(action, progress) {
    if (this.busy || !this.store) return;
    this.busy = true; this.generation++;
    this.state(progress, `${progress === 'capturing' ? 'Capturing a coherent checkpoint' : progress === 'restoring' ? 'Preparing the guest' : 'Updating local sessions'}…`);
    try {await action();}
    catch (error) {this.state(errorState(error), `${error.message}. The last committed checkpoint is preserved.`);}
    finally {this.busy = false; this.render();}
  }
  async refresh(preferred = this.selected) {
    const generation = ++this.refreshGeneration, listed = await this.store.list();
    if (generation !== this.refreshGeneration) return;
    this.rows = new Map(listed.sessions.map(row => [row.id, {...row, state: 'saved'}]));
    for (const row of listed.unavailable) this.rows.set(row.id, {...row, state: 'incomplete'});
    for (const [id, row] of this.metadata) if (!this.rows.has(id) && row.draft) this.rows.set(id, {id, state: 'incomplete'});
    const select = this.controls.sessions; select.replaceChildren();
    for (const row of this.rows.values()) {
      const option = document.createElement('option'); option.value = row.id;
      option.textContent = `${this.metadata.get(row.id)?.name || row.id}${row.state === 'incomplete' ? ' · incomplete' : ''}`;
      select.append(option);
    }
    this.selected = this.rows.has(preferred) ? preferred : this.rows.keys().next().value ?? '';
    select.value = this.selected;
    await this.select(this.selected);
  }
  async select(id) {
    if (this.busy && this.controls.sessions.value !== this.selected) return;
    const token = ++this.generation; this.selected = id; this.preview = null;
    this.controls.sessions.value = id; this.controls.points.replaceChildren(); this.controls.name.value = this.metadata.get(id)?.name ?? id;
    if (!id) {this.state('ready', 'No saved sessions yet. Start an offline checkpoint guest, then start recording.'); return;}
    if (this.rows.get(id)?.state === 'incomplete') {
      this.state('incomplete', 'This session is incomplete or its browser data is missing. It cannot be opened.'); return;
    }
    this.state('loading', 'Reading selected preview; the active guest is unchanged…');
    try {
      const opened = await this.store.openSession(id);
      if (!opened) throw Error('session unavailable');
      const manifest = JSON.parse(decoder.decode(opened.manifest)), vm = manifest.assets.find(asset => asset.role === 'vm');
      const configuration = JSON.parse(decoder.decode(await this.readObject(this.store, vm.content, 1048576)));
      const references = new Map();
      for (const ref of [...manifest.assets.map(asset => asset.content), ...manifest.checkpoints.map(point => point.machine),
        ...await this.diskRoots.liveReferences(manifest.checkpoints.map(point => point.disk_root))]) references.set(ref.sha256, ref);
      if (token !== this.generation) return;
      const compatible = configuration.version === 1 && manifest.machine.initramfs === null && manifest.policy.mode === 'checkpoints-only' && manifest.policy.profile === 'rv64-linux-software-v1'
        && configuration.runtime === GPU_CHECKPOINT_BUILD_ID && manifest.machine.wasm_build === SOFTWARE_CHECKPOINT_WASM_SHA256
        && configuration.wasm.sha256 === SOFTWARE_CHECKPOINT_WASM_SHA256 && manifest.machine.gpu === null;
      this.preview = {id, manifest, compatible, runtime: configuration.runtime, bytes: [...references.values()].reduce((sum, ref) => sum + Number(ref.length), opened.manifest.length)};
      for (const point of manifest.checkpoints) {
        const option = document.createElement('option'); option.value = point.id;
        const at = this.metadata.get(id)?.points.find(item => item.id === point.id)?.at;
        option.textContent = `${point.id}${at ? ' · ' + new Date(at).toLocaleString() : ''}`;
        this.controls.points.append(option);
      }
      this.controls.points.value = manifest.checkpoints.at(-1)?.id ?? '';
      this.state(compatible ? 'ready' : 'incompatible', compatible
        ? 'Selected preview only. Open restores the chosen exact checkpoint and leaves it paused.'
        : 'Incompatible saved build or profile. Opening is disabled; the active guest is unchanged.');
    } catch (error) {if (token === this.generation) this.state(errorState(error), error.message);}
  }
  render() {
    const c = this.controls; if (!c) return;
    const owner = this.adapter.current(), ready = Boolean(this.store), busy = this.busy;
    const qualified = owner?.profile && owner.ready;
    c.new.disabled = !ready || busy || Boolean(this.recording);
    c.start.disabled = !ready || busy || !qualified || Boolean(this.recording);
    c.checkpoint.disabled = c.stop.disabled = busy || !this.recording || owner?.controller !== this.recording.controller;
    c.sessions.disabled = busy || !ready || !this.rows.size; c.points.disabled = busy || !this.preview;
    c.open.disabled = busy || Boolean(this.recording) || !this.preview?.compatible || !c.points.value;
    c.name.disabled = c.rename.disabled = busy || !this.selected || !ready;
    c.refresh.disabled = !ready || busy; c.resume.disabled = busy || !qualified;
    this.root.setAttribute('aria-busy', String(busy));
    c.active.dataset.id = this.active?.id ?? ''; c.active.dataset.point = this.active?.point ?? '';
    c.active.textContent = this.active
      ? `Active: ${this.metadata.get(this.active.id)?.name || this.active.id} · ${this.active.point}${this.recording ? ' · recording checkpoints' : this.active.running ? ' · running; later changes are unsaved' : ' · paused at saved point'}`
      : owner?.profile ? 'Active: offline checkpoint guest · no saved session selected for this machine' : 'Active: no checkpoint guest';
    const preview = this.preview, meta = this.metadata.get(this.selected);
    c.details.replaceChildren();
    if (preview) {
      const span = Math.max(0, (meta?.updated ?? 0) - (meta?.started ?? 0));
      const lines = [
        `${preview.manifest.checkpoints.length} exact restore points · ${bytesLabel(preview.bytes)} referenced data (shared data may be counted by other sessions)`,
        meta?.started > 0 ? `Capture window ${(span / 1000).toFixed(1)} seconds` : 'Capture duration unavailable',
        `Runtime ${preview.runtime} · Wasm ${preview.manifest.machine.wasm_build} · image ${preview.manifest.machine.base_image}`,
        'Checkpoints only. No event replay or history from before recording was enabled.',
      ];
      for (const text of lines) {const line = document.createElement('p'); line.textContent = text; c.details.append(line);}
    }
  }
  ownerChanged() {
    const controller = this.adapter.current()?.controller;
    if (this.active?.controller !== controller) this.active = null;
    if (this.recording && this.recording.controller !== controller) {
      void this.recording.writer.release(); this.recording = null;
      this.state('ready', 'Recording ended because its guest stopped. Committed checkpoints remain saved.');
    }
    this.render();
  }
  async newGuest() {
    await this.adapter.replace(null); this.active = null;
    this.state('ready', 'Offline checkpoint guest is starting. Start recording when its shell is ready.');
  }
  async start() {
    const owner = this.adapter.current();
    if (!owner?.profile || !owner.ready || this.recording) throw Error('Start a ready offline checkpoint guest first');
    const id = uid('session-'), now = Date.now(), next = new Map(this.metadata);
    next.set(id, {id, name: `Session ${new Date(now).toLocaleString()}`, started: now, updated: now, points: [], draft: true});
    this.persistMetadata(next);
    const writer = await this.store.writer(id);
    this.recording = {id, writer, controller: owner.controller};
    try {await this.capture();}
    catch (error) {await writer.release(); this.recording = null; await this.refresh(id); throw error;}
  }
  async capture() {
    const recording = this.recording, owner = this.adapter.current();
    if (!recording || owner?.controller !== recording.controller) throw Error('Recording guest is no longer active');
    const controller = recording.controller, wasPaused = await controller.isPaused(), point = uid('point-');
    await controller.pause();
    try {
      const configuration = await controller.softwareCheckpointConfiguration(), frame = await controller.captureSoftwareCheckpoint();
      if (this.adapter.current()?.controller !== controller) throw Error('Recording guest changed during capture');
      await this.checkpoints.save(recording.writer, point, frame, configuration);
      if (this.adapter.current()?.controller !== controller) throw Error('Recording guest stopped after checkpoint publication');
      this.active = {id: recording.id, point, controller, running: !wasPaused};
      const next = new Map(this.metadata), meta = next.get(recording.id);
      next.set(recording.id, {...meta, draft: false, updated: Date.now(), points: [...meta.points, {id: point, at: Date.now()}]});
      this.persistMetadata(next);
    } finally {
      if (!wasPaused && this.adapter.current()?.controller === controller) await controller.resume();
    }
    await this.refresh(recording.id);
    this.state('ready', 'Checkpoint committed. Only explicit saved points can be restored.');
  }
  async stop() {
    const recording = this.recording;
    try {await this.capture();}
    finally {if (recording) await recording.writer.release(); this.recording = null;}
    this.state('ready', 'Recording stopped. Saved checkpoints remain available; later guest changes are unsaved.');
  }
  async rename() {
    const name = this.controls.name.value.trim();
    if (!name || name.length > 96) throw Error('Choose a name from 1 to 96 characters');
    const next = new Map(this.metadata), old = next.get(this.selected);
    next.set(this.selected, old ? {...old, name} : {id: this.selected, name, started: 0, updated: 0, points: []});
    this.persistMetadata(next); await this.refresh();
    this.controls.status.textContent = 'Session renamed. Its checkpoint identity is unchanged. ' + this.controls.status.textContent;
  }
  async open() {
    const preview = this.preview, point = this.controls.points.value;
    if (!preview?.compatible || this.recording) throw Error('Choose a compatible checkpoint and stop recording first');
    // Authenticate before retiring the current machine. The adapter additionally preflights the
    // actual topology in a disposable paused controller before it replaces the page owner.
    await this.checkpoints.admit(preview.id, point, GPU_CHECKPOINT_BUILD_ID, SOFTWARE_CHECKPOINT_WASM_SHA256);
    const controller = await this.adapter.replace({id: preview.id, checkpoint: point});
    if (this.adapter.current()?.controller !== controller) throw Error('Restored guest is no longer active');
    this.active = {id: preview.id, point, controller, running: false};
    this.state('ready', 'Exact checkpoint restored paused. Preview selection never changes the active guest. Choose Resume to continue.');
  }
  async resume() {
    const owner = this.adapter.current();
    if (!owner?.profile || !owner.ready) throw Error('No ready checkpoint guest');
    await owner.controller.resume(); if (this.active) this.active.running = true;
    this.state('ready', 'Guest running. Use Checkpoint while recording to save a new restore point.');
  }
}
