import subprocess,sys,time
subprocess.Popen([sys.executable, '-c', "import os,pathlib,signal,time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\npathlib.Path('/Users/blamy/Documents/Codex/wasm-vm/evidence/omarchy-profile/input-kernel-pair-verifier/owned-cleanup-original-r1/fixture/descendant.pid').write_text(str(os.getpid()))\nwhile True: time.sleep(0.05)"])
while True: time.sleep(0.05)
