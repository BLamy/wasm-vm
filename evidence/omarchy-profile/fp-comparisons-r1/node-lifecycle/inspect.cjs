// Diagnostic only: observe the runner's resources without keeping Node alive.
const fs = require('node:fs');
const write = data => fs.writeSync(2, `NODE_LIFECYCLE ${JSON.stringify(data)}\n`);
process.on('beforeExit', code => write({ event: 'beforeExit', code, resources: process.getActiveResourcesInfo() }));
process.on('exit', code => write({ event: 'exit', code }));
for (const delay of [20000, 45000, 75000]) {
  setTimeout(() => write({ elapsedMs: delay, resources: process.getActiveResourcesInfo(), handles: process._getActiveHandles().map(h => h.constructor.name), requests: process._getActiveRequests().map(r => r.constructor.name) }), delay).unref();
}
