import json, socket, time
from pathlib import Path
root=Path('/Users/blamy/Documents/Codex/replay-chromium')
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(10);s.connect(str(root/'gui/run/qmp.sock'));f=s.makefile('rwb',buffering=0)
greeting=json.loads(f.readline());seq=0;actions=[]
def call(name,args=None):
 global seq
 seq+=1;m={'execute':name,'id':seq}
 if args is not None:m['arguments']=args
 f.write((json.dumps(m)+'\n').encode())
 while True:
  r=json.loads(f.readline())
  if r.get('id')==seq:
   if 'error'in r:raise RuntimeError(r['error'])
   actions.append(m);return r['return']
call('qmp_capabilities')
call('send-key',{'keys':[{'type':'qcode','data':'tab'}],'hold-time':30});time.sleep(1)
call('send-key',{'keys':[{'type':'qcode','data':'ret'}],'hold-time':30});time.sleep(3)
path=root/'gui/chromium-gui-build20-input.png';call('screendump',{'filename':str(path),'format':'png'})
(root/'logs/qemu-build20-keyboard.json').write_text(json.dumps({'prediction':'The actual browser button reruns JS/WASM/canvas and displays runs:2','actions':actions,'image':str(path)},indent=2)+'\n')
print(path)
