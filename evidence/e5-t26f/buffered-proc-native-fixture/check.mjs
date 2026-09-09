// Four tiny read-only-container checks; this is a shared-fixture diagnosis, not guest evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const helper = path.join(root, 'tools/guest/e5-t26f-resident-aplay.sh');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const helperSha256 = sha(readFileSync(helper));
assert.equal(helperSha256, '324e0acddd88bd2d41b0310444e32e2262dedd3129132240134dac857d4eec2e');
const scratch = mkdtempSync(path.join(directory, 'scratch-'));
copyFileSync(helper, path.join(scratch, 'helper.sh'));
const image = 'sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc';
const q = text => `'${text.replaceAll("'", "'\\''")}'`;
const transcript = path.join(directory, 'check.log');
writeFileSync(transcript, `Started ${new Date().toISOString()}\n`, { flag: 'wx' });
const results = [];
for (const [index, [name, bytes, flag]] of [
  ['reused.data', '', 'wx'], ['reused.data', 'pipe_read', 'w'],
  ['unique-empty.data', '', 'wx'], ['unique-pipe.data', 'pipe_read', 'wx'],
].entries()) {
  const file = path.join(scratch, name);
  writeFileSync(file, bytes, { flag });
  const host = { at: new Date().toISOString(), size: statSync(file).size, inode: statSync(file).ino, hex: readFileSync(file).toString('hex'), sha256: sha(readFileSync(file)) };
  const command = `set -eu
printf 'containerSize='
/bin/busybox stat -c %s ${q(file)}
printf 'containerInode='
/bin/busybox stat -c %i ${q(file)}
printf 'containerHex='
/bin/busybox od -An -tx1 ${q(file)}
printf '\\nhelperSha='
/bin/busybox sha256sum ${q(path.join(scratch, 'helper.sh'))}
. ${q(path.join(scratch, 'helper.sh'))}
if e5_capture ${q(file)} 128; then capture_status=0; else capture_status=$?; fi
printf 'captureStatus=%s\\ncaptureLength=%s\\ncaptureHex=' "$capture_status" "${'${#e5_text}'}"
printf '%s' "$e5_text" | /bin/busybox od -An -tx1
printf '\\n'
`;
  const container = `e5t26f-buffered-fixture-${process.pid}-${index}`;
  const args = ['run', '--rm', '--pull=never', '--network=none', '--cpus=1', '--memory=128m', '--pids-limit=32', '--name', container,
    '--mount', `type=bind,src=${scratch},dst=${scratch}`, '--workdir', scratch, image, '/bin/busybox', 'ash', '-c', command];
  appendFileSync(transcript, `\nHOST ${JSON.stringify({ index, name, host })}\n$ docker ${args.map(q).join(' ')}\n`);
  const run = spawnSync('docker', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
  appendFileSync(transcript, `${run.stdout}${run.stderr}\nexit=${run.status} signal=${run.signal}\n`);
  if (run.error || run.signal) spawnSync('docker', ['rm', '--force', container], { timeout: 5000 });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(helperSha256));
  const value = key => run.stdout.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1].trim();
  results.push({ index, name, host, container: { size: Number(value('containerSize')), inode: Number(value('containerInode')), hex: value('containerHex').replaceAll(' ', '') },
    capture: { status: Number(value('captureStatus')), length: Number(value('captureLength')), hex: value('captureHex').replaceAll(' ', '') }, stdout: run.stdout });
}
assert.equal(sha(readFileSync(helper)), helperSha256);
const result = { acceptance: false, scope: 'Native shared-host-file visibility versus unchanged capture helper; not real proc, ALSA or browser timing.', image, helperSha256, scratch, results };
writeFileSync(path.join(directory, 'check.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(results.map(({ stdout, ...value }) => value), null, 2));
