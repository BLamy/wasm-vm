import concurrent.futures, hashlib, json, pathlib, subprocess
root=pathlib.Path.cwd(); out=root/'target/e9-t04-base-publication'; image=json.loads((root/'web/session-alpine-image.json').read_text()); base='https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/chunked-alpine/chunks/'
def check(sha):
 path=out/(sha+'.download'); url=base+sha+'.bin'
 result=subprocess.run(['curl','--silent','--show-error','--location','--connect-timeout','10','--max-time','60','--output',str(path),'--write-out','%{http_code}',url],capture_output=True,text=True)
 record={'sha256':sha,'url':url,'http_status':result.stdout,'exit_code':result.returncode}
 if result.returncode==0 and result.stdout=='200':
  data=path.read_bytes(); record.update(bytes=len(data),actual_sha256=hashlib.sha256(data).hexdigest()); record['status']='passed' if len(data)==131072 and record['actual_sha256']==sha else 'corrupt'
 elif result.returncode==0 and result.stdout=='404':record['status']='missing'
 else:record.update(status='error',error=result.stderr)
 path.unlink(missing_ok=True);return record
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:files=list(pool.map(check,sorted(set(image['chunks']))))
report={'status':'passed' if all(x['status']=='passed' for x in files) else 'incomplete','files':files}
(out/'public-chunks.json').write_text(json.dumps(report,indent=2)+'\n')
print(report['status'],len(files),'unique objects')
for r in files:
 if r['status']!='passed':print(r['status'],r['sha256'],r['http_status'],r.get('error',''))
