// Observe the real restored factory before application shortcuts or fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";

export async function verifyCleanFactory(page,command,output,{name='factory-guard'}={}) {
  assert.match(name,/^[a-z0-9-]+$/);
  const clients=await command(page,'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients',300000);assert.equal(clients.exit,0);
  const windows=JSON.parse(clients.stdout);
  assert.ok(!windows.some(row=>/chromium|libreoffice|soffice/i.test((row.class??'')+' '+(row.title??''))),'no browser/office window, including a class-empty Chromium first-run dialog');
  const code=`from pathlib import Path;import os,json;assert os.getuid()==1000;rows=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  if p.stat().st_uid!=1000:continue
  s=(p/'stat').read_text();cmd=(p/'cmdline').read_bytes().split(bytes([0]));comm=(p/'comm').read_text().strip()
  try:exe=os.readlink(p/'exe')
  except FileNotFoundError:exe=None
  rows.append(dict(pid=int(p.name),starttime=s.rsplit(')',1)[1].split()[19],state=s.rsplit(')',1)[1].split()[0],comm=comm,exe=exe,args=[x.decode() for x in cmd if x]))
 except FileNotFoundError:continue
print(json.dumps(dict(processes=rows,chromiumEula=(Path.home()/'.config/chromium/EULA Accepted').exists(),chromiumFirstRun=(Path.home()/'.config/chromium/First Run').exists())))`;
  const text='python3 -c '+quote(code);assert.ok(Buffer.byteLength(text)<2500);
  const processes=await command(page,text,300000);assert.equal(processes.exit,0);
  const observed=JSON.parse(processes.stdout);
  assert.equal(observed.chromiumEula,false);assert.equal(observed.chromiumFirstRun,false);
  assert.ok(!observed.processes.some(row=>row.state!=='Z'&&(/\/(?:chromium|libreoffice)\//i.test(row.exe??'')||/^(?:chromium|soffice\.bin)$/.test(row.comm))),'no prelaunched native browser or office process');
  const result={status:'passed',scope:'Read-only complete native uid1000 process/client exclusion on the actual restored factory; no fixture or application profile writes',clients,command:text,processes,observed};
  await fs.writeFile(path.join(output,name+'.json'),JSON.stringify(result,null,2)+'\n');return result;
}
