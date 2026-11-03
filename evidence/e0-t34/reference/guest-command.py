#!/usr/bin/env python3
"""Run a validation script through the VM's private serial shell."""
import argparse
import base64
from pathlib import Path
import re
import socket
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('script', type=Path)
parser.add_argument('--timeout', type=float, default=120)
parser.add_argument('--log', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
token = uuid.uuid4().hex
payload = base64.b64encode(args.script.read_bytes()).decode()
command = (f"printf '%s' '{payload}' | base64 -d > /tmp/replay-{token}.sh; "
           f"bash /tmp/replay-{token}.sh; replay_result=$?; "
           f"printf '\\n__REPLAY_END_{token}:%s\\n' \"$replay_result\"\n")
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.settimeout(0.25)
sock.connect(str(root / 'gui/run/serial.sock'))
sock.sendall(command.encode())
output = bytearray()
pattern = re.compile(rb'__REPLAY_END_' + token.encode() + rb':([0-9]+)\r?\n')
deadline = time.monotonic() + args.timeout
while time.monotonic() < deadline:
    try:
        data = sock.recv(65536)
        if not data:
            break
        output.extend(data)
    except socket.timeout:
        pass
    match = pattern.search(output)
    if match:
        if args.log:
            args.log.parent.mkdir(parents=True, exist_ok=True)
            args.log.write_bytes(output)
        print(output.decode(errors='replace')[-12000:])
        raise SystemExit(int(match.group(1)))
if args.log:
    args.log.parent.mkdir(parents=True, exist_ok=True)
    args.log.write_bytes(output)
print(output.decode(errors='replace')[-4000:])
raise SystemExit('Guest command did not finish before the deadline')
