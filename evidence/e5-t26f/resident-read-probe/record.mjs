// One offline native run; existing source container is copied from, never started.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const source = 'e5-t26f-ash-write-probe-native';
const image = 'sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc';
const container = `e5-t26f-ash-read-probe-native-${Date.now()}`;
const log = path.join(directory, 'transcript.log');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.ok(!existsSync(log), 'refusing to overwrite an existing recording');
writeFileSync(log, `Started ${new Date().toISOString()}\n`, { flag: 'wx' });
function run(command, args, { input, binary = false, timeout = 15000 } = {}) {
  appendFileSync(log, `$ ${[command, ...args].map(x => JSON.stringify(x)).join(' ')}${input ? ' [copied tar on stdin]' : ''}\n`);
  const result = spawnSync(command, args, { cwd: root, input, timeout, maxBuffer: 32 * 1024 * 1024 });
  appendFileSync(log, binary ? `[tar bytes=${result.stdout?.length ?? 0}, sha256=${sha(result.stdout ?? Buffer.alloc(0))}]\n` : (result.stdout ?? ''));
  appendFileSync(log, `${result.stderr ?? ''}\nexit=${result.status} signal=${result.signal ?? 'none'}${result.error ? ` error=${result.error.message}` : ''}\n`);
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
  return result.stdout;
}
const before = run('docker', ['inspect', '--format', '{{.State.Status}} {{.Image}}', source]).toString().trim();
assert.equal(before, `exited ${image}`);
const head = run('git', ['rev-parse', 'HEAD']).toString().trim();
const helperPath = path.join(root, 'tools/guest/e5-t26f-resident-aplay.sh');
const helperSha256 = sha(readFileSync(helperPath));
assert.equal(helperSha256, '2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c');
const input = path.join(directory, 'input');
mkdirSync(input);
copyFileSync(path.join(root, 'tools/verify/e5-t26f-ash-read-probe.sh'), path.join(input, 'run.sh'));
copyFileSync(path.join(input, 'run.sh'), path.join(directory, 'run.sh'));
run('docker', ['create', '--pull', 'never', '--network', 'none', '--cpus', '1', '--memory', '128m', '--pids-limit', '32', '--name', container, image, '/bin/sh', '/work/run.sh']);
run('docker', ['cp', input, `${container}:/work`]);
for (const file of ['/usr/bin/strace', '/lib/libz.so.1', '/usr/lib/libbz2.so.1', '/usr/lib/libdw.so.1', '/usr/lib/libelf.so.1', '/usr/lib/libfts.so.0', '/usr/lib/liblzma.so.5', '/usr/lib/libzstd.so.1']) {
  const tar = run('docker', ['cp', '-L', `${source}:${file}`, '-'], { binary: true });
  run('docker', ['cp', '-', `${container}:${path.posix.dirname(file)}`], { input: tar });
  // Docker -L archives the resolved basename; retain the original SONAME symlink too.
  if (file !== '/usr/bin/strace') {
    const alias = run('docker', ['cp', `${source}:${file}`, '-'], { binary: true });
    run('docker', ['cp', '-', `${container}:${path.posix.dirname(file)}`], { input: alias });
  }
}
const startedAt = new Date().toISOString();
run('docker', ['start', '-a', container], { timeout: 20000 });
const finishedAt = new Date().toISOString();
const exitCode = run('docker', ['inspect', '--format', '{{.State.ExitCode}}', container]).toString().trim();
assert.equal(exitCode, '0');
run('docker', ['cp', `${container}:/work/results/.`, directory]);
assert.equal(run('docker', ['inspect', '--format', '{{.State.Status}} {{.Image}}', source]).toString().trim(), before);
assert.equal(sha(readFileSync(helperPath)), helperSha256);
assert.equal(run('git', ['rev-parse', 'HEAD']).toString().trim(), head);
writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify({ acceptance: false, head, source, sourceStateBeforeAndAfter: before, image, container, network: 'none', cpuLimit: 1, memoryMiB: 128, pidsLimit: 32, startedAt, finishedAt, exitCode: Number(exitCode), helperSha256 }, null, 2) + '\n', { flag: 'wx' });
run(process.execPath, ['tools/verify/e5-t26f-ash-read-probe.mjs', path.relative(root, directory)]);
appendFileSync(log, `Finished ${new Date().toISOString()}\n`);
console.log(`Recorded and validated ${container}: ${path.relative(root, directory)}`);
