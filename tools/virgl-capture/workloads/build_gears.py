#!/usr/bin/env python3
"""Fetch the pinned official archive and cross-build the unchanged guest client."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container',default='wasm-vm-virgl-reference-research')
    parser.add_argument('--rootfs',default='/reference/omarchy.ext4')
    parser.add_argument('--output',default='/capture/gears-workload')
    parser.add_argument('--archive',type=Path,help='existing official archive; still hash checked')
    parser.add_argument('--cache',type=Path,default=Path(tempfile.gettempdir())/'wasm-vm-graphics-workload-sources')
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    pin = json.loads((here/'gears-pins.json').read_text())['mesa_demos']
    args.cache.mkdir(parents=True,exist_ok=True)
    archive = args.archive or args.cache/pin['archive']
    if not archive.exists():
        urllib.request.urlretrieve(pin['url'],archive)
    if archive.stat().st_size != pin['bytes'] or hashlib.sha256(archive.read_bytes()).hexdigest() != pin['sha256']:
        raise SystemExit('original official Mesa demos archive pin differs')
    def run(*command):
        subprocess.run(command,check=True)
    run('docker','exec',args.container,'mkdir','-p','/workload-build/control','/workload-build/inputs')
    for name in ('build_gears_in_container.py','gears-pins.json','pins.json'):
        run('docker','cp',str(here/name),args.container+':/workload-build/control/'+name)
    target = '/workload-build/inputs/'+pin['archive']
    run('docker','cp',str(archive),args.container+':'+target)
    run('docker','exec',args.container,'python3','/workload-build/control/build_gears_in_container.py',
        '--rootfs',args.rootfs,'--archive',target,'--output',args.output)


if __name__ == '__main__':
    main()
