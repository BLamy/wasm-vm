import subprocess,sys,time
subprocess.Popen([sys.executable, '-c', "import os,pathlib,signal,time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\npathlib.Path('/Users/blamy/Documents/Codex/wasm-vm/evidence/omarchy-profile/input-kernel-pair-verifier/owned-cleanup-original-r2/fixture/descendant.pid').write_text(str(os.getpid()))\nwhile True:\n pathlib.Path('/Users/blamy/Documents/Codex/wasm-vm/evidence/omarchy-profile/input-kernel-pair-verifier/owned-cleanup-original-r2/fixture/descendant.heartbeat').write_text(str(time.monotonic_ns()))\n time.sleep(0.01)"])
while True: time.sleep(0.05)
