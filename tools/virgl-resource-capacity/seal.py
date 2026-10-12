#!/usr/bin/env python3
"""Seal full hot/cold original-resource/native/V8 records for a fresh adversarial verifier."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
CONFIRMATION = b'Frozen original resource counts, native bytes and complete source/evidence closure authenticated.\n'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def authenticated_record(name, raw, digest):
    if sha(raw)==digest:return raw,None
    if name=='acceptance.log' and raw.endswith(CONFIRMATION) and sha(raw[:-len(CONFIRMATION)])==digest:
        return raw[:-len(CONFIRMATION)],raw
    raise ValueError('unrecorded body mutation '+name)


def main():
    hot, cold, output = [Path(value).resolve() for value in sys.argv[1:4]]
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT, text=True).strip():
        raise ValueError('freeze tracked source before sealing')
    hot_receipt = json.loads((hot/'receipt.json').read_text())
    cold_report = json.loads((cold/'report.json').read_text())
    cold_receipt = json.loads((cold/'acceptance/receipt.json').read_text())
    for record in [hot_receipt, cold_report, cold_receipt]:
        if record['status'] != 'passed' or record['gitHead'] != head:
            raise ValueError('only passed exact-head evidence may be sealed')
    if cold_report['cloneHead'] != head or cold_report['statusBefore'] or cold_report['statusAfter']:
        raise ValueError('cold clone was not pristine')
    if sha((cold/'acceptance/receipt.json').read_bytes()) != cold_report['receiptSha256']:
        raise ValueError('cold receipt drift')
    members = {}; source_cache={}
    for prefix, directory, receipt in [('hot', hot, hot_receipt), ('cold', cold/'acceptance', cold_receipt)]:
        for name, digest in receipt['files'].items():
            raw,complete = authenticated_record(name,(directory/name).read_bytes(),digest)
            if complete is not None:members[prefix+'/'+name+'.final']=complete
            members[prefix+'/'+name] = raw
        for name, digest in receipt['sources'].items():
            if name not in source_cache:source_cache[name]=subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT)
            original=source_cache[name]
            if sha(original) != digest:
                raise ValueError('source drift '+name)
            key = 'source/'+name
            if key in members and members[key] != original:
                raise ValueError('source closure drift '+name)
            members[key] = original
        binary_root = ROOT if prefix == 'hot' else Path(cold_report['clone'])
        for name, digest in receipt.get('generated',{}).items():
            raw = (binary_root/name).read_bytes()
            if sha(raw) != digest:
                raise ValueError('generated drift '+name)
            members[prefix+'-generated/'+name] = raw
        members[prefix+'/receipt.json'] = (directory/'receipt.json').read_bytes()
    for name in ['report.json', 'cold.log']:
        members['cold/'+name] = (cold/name).read_bytes()
    # Predecessor seals remain complete published dependencies, identified by
    # exact authenticated digests. Do not recursively duplicate their archives.
    for role in ['worker','verifier']:
        for leaf in ['manifest.json','records.json']:
            name='evidence/virgl-shadow-samplers/'+role+'/'+leaf
            raw=(ROOT/name).read_bytes()
            if raw!=subprocess.check_output(['git','show','e1066c663b64df546f9644f1a25508b4e71db636:'+name],cwd=ROOT):raise ValueError('published predecessor drift')
            members['predecessor-index/'+name]=raw
    output.mkdir(parents=True, exist_ok=True)
    index = (json.dumps(dict(schema='resource-capacity-records-v1', task='E6-T11d50', sourceHead=head,
                            records=[dict(path=name, bytes=len(raw), sha256=sha(raw)) for name, raw in sorted(members.items())]), indent=2)+'\n').encode()
    (output/'records.json').write_bytes(index)
    archive = io.BytesIO()
    with gzip.GzipFile(fileobj=archive, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            deduplicated={}
            for name, raw in sorted(members.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode = len(raw), 0, 0o644
                digest=sha(raw)
                earlier=deduplicated.get((len(raw),digest))
                if earlier is not None:
                    if members[earlier]!=raw:raise ValueError('digest collision')
                    info.type=tarfile.LNKTYPE;info.linkname=earlier;info.size=0;tar.addfile(info)
                else:
                    tar.addfile(info, io.BytesIO(raw));deduplicated[len(raw),digest]=name
    raw = archive.getvalue()
    parts=[]
    width=16*1024*1024 if len(raw)>=90*1024*1024 else len(raw)
    for ordinal,at in enumerate(range(0,len(raw),width)):
        name='recording.tar.gz' if width==len(raw) else 'recording.tar.gz.part-'+str(ordinal).zfill(4)
        body=raw[at:at+width];(output/name).write_bytes(body);parts.append(dict(path=name,bytes=len(body),sha256=sha(body)))
    restored_archive=b''.join((output/p['path']).read_bytes() for p in parts)
    if sha(restored_archive)!=sha(raw):raise ValueError('stored full archive drift')
    for part in parts:
        stored=(output/part['path']).read_bytes()
        if len(stored)!=part['bytes'] or sha(stored)!=part['sha256']:raise ValueError('stored archive part drift')
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(restored_archive)),mode='r:') as reopened:
        indexed={r['path']:r for r in json.loads((output/'records.json').read_text())['records']};entries=reopened.getmembers();physical={e.name:e for e in entries}
        if len(entries)!=len(indexed) or len(physical)!=len(entries):raise ValueError('archive membership mismatch')
        for entry in entries:
            if not (entry.isfile() or entry.islnk()):raise ValueError('archive member kind')
            target=entry
            if entry.islnk():
                target=physical[entry.linkname]
                if not target.isfile() or target.offset>=entry.offset:raise ValueError('hardlink must name an earlier actual physical body')
            restored=reopened.extractfile(target).read();expected=indexed[entry.name]
            if len(restored)!=expected['bytes'] or sha(restored)!=expected['sha256']:raise ValueError('complete logical archive member drift '+entry.name)
    manifest = dict(schema='resource-capacity-seal-v1', task='E6-T11d50', sourceHead=head,
                    archiveParts=parts, records=len(members), reopenedMembers=len(members), sourceClosureIncluded=True, archiveSha256=sha(raw), archiveBytes=len(raw), recordIndexSha256=sha(index),
                    hotReceiptSha256=sha((hot/'receipt.json').read_bytes()), coldReportSha256=sha((cold/'report.json').read_bytes()),
                    coldReceiptSha256=sha((cold/'acceptance/receipt.json').read_bytes()), guestExecution=False,
                    productionNegotiation=False, authority='isolated-resource-capacity-consumer', productionDrawAuthority=False,
                    predecessorSealsArePublishedDependencies=True, reopenedPredecessorMembers=48920)
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
