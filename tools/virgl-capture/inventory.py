#!/usr/bin/env python3
"""Derive client-only requirements from authenticated original VirGL packets.

This is an inventory, not an execution backend or capability declaration.
Context IDs, resource IDs and object handles are scoped by their recorded
lifetimes. Supporting compositor submissions cannot establish a client draw.
"""
from collections import Counter, defaultdict
import gzip
import json
from pathlib import Path
import re
import struct

from validate import (ROOT, COMMANDS, OBJECTS, CaptureError, checked_file,
                      load_json, require, sha256, validate_capture)
from gears_check import check_gears


HW = ROOT/'renderer/virgl-shader/vendor/src/virgl_hw.h'
FORMATS = {int(value):name for name,value in
           re.findall(r'VIRGL_FORMAT_([A-Z0-9_]+)\s*=\s*([0-9]+)',HW.read_text())}
BINDS = {0:'depth-stencil',1:'render-target',3:'sampler-view',4:'vertex-buffer',
         5:'index-buffer',6:'constant-buffer',7:'display-target',8:'command-args',
         11:'stream-output',14:'shader-buffer',15:'query-buffer',16:'cursor',
         17:'custom',18:'scanout',19:'staging',20:'shared',21:'prefer-emulated-bgra',
         22:'linear'}
DRAW_BINDS = {'color-surface':2,'depth-stencil-surface':1,'sampler-view':8,
              'vertex-buffer':16,'index-buffer':32,'uniform-buffer':64}
CLIENT_NAMES = {'kmscube':b'kmscube','es2gears':b'es2gears_waylan'}
OLD_MANIFESTS = {'compositor':'22519c071fb65af6c5556bda1c3f4304951f49b8d19141ac40658bcb2d31482c',
                 'glmark2-es2':'28effba207e0c7d5679644e9a5c8d21b5ce30067a8155dfe46f92e417050c263',
                 'kmscube':'f336ce65bbf4827ab6b7f43d76b6be9badbc8c81a3576116095d09615dfbb77f',
                 'textured-scene':'cbe711eb1d57dbaf416d684b351ade01642eff298ecb7869b04063925466f8cf'}


def encoded(value):
    return (json.dumps(value,indent=2,sort_keys=True)+'\n').encode()


def format_name(value):
    require(value in FORMATS,'unknown recorded format '+str(value))
    return FORMATS[value]


def blob(directory, reference):
    path = directory/'blobs'/(reference['sha256']+'.bin')
    packed = path.with_suffix('.bin.gz')
    require(path.is_file()!=packed.is_file(),'missing/ambiguous recorded blob')
    raw = path.read_bytes() if path.is_file() else gzip.decompress(packed.read_bytes())
    require(len(raw)==reference['bytes'] and sha256(raw)==reference['sha256'],'changed original blob')
    return raw


def packets(raw, event, context, subcontext):
    offset = 0
    while offset < len(raw):
        header = struct.unpack_from('<I',raw,offset)[0]
        opcode,kind,length = header&255,(header>>8)&255,header>>16
        end = offset+4*(1+length)
        require(opcode in COMMANDS and kind in OBJECTS and end<=len(raw),'invalid original packet')
        body = raw[offset:end]
        citation = {'event':event['seq'],'line':event['seq'],'contextId':context['id'],
                    'contextCreateEvent':context['createEvent'],'subcontext':subcontext,
                    'blobSha256':event['blobs'][0]['sha256'],'byteOffset':offset,
                    'byteLength':len(body),'packetSha256':sha256(body)}
        yield COMMANDS[opcode],OBJECTS[kind],struct.unpack('<'+'I'*(length+1),body),citation
        offset = end


def state():
    return {'objects':{},'bound':{},'shaders':{},'framebuffer':{'colors':[],'depth':None},
            'vertices':[],'index':None,'views':{},'samplers':{},'uniforms':{},'constants':{},'viewport':None}


class Inventory:
    def __init__(self,directory,summary):
        self.directory = directory
        self.summary = summary
        self.live_contexts = {}
        self.contexts = []
        self.live_resources = {}
        self.all_resources = {}
        self.resources = []
        self.objects = []
        self.client_packets = []
        self.client_transfers = []
        self.backings = {}
        self.draws = []
        self.shader_completions = {}
        for digest,shader in summary['shaders'].items():
            for occurrence in shader['occurrences']:
                last = occurrence['packets'][-1]
                self.shader_completions[(last['event'],last['byteOffset'])] = {
                    'sha256':digest,'stage':shader['stage'],'bytes':shader['bytes'],
                    'packets':occurrence['packets'],'handle':occurrence['handle']}

    def resource(self,rid):
        require(rid in self.live_resources,'packet references missing live resource '+str(rid))
        return self.live_resources[rid]

    def mark(self,rid,role,context,draw=False):
        resource = self.resource(rid)
        return self.mark_key(resource['key'],role,context,draw)

    def mark_key(self,key,role,context,draw=False):
        require(key in self.all_resources,'missing retained resource lifetime')
        resource = self.all_resources[key]
        require(not draw or not context['selected'] or resource['bind']&DRAW_BINDS[role],
                f"actual client role {role} contradicts resource {resource['key']} bind {resource['bind']} at context {context['key']}")
        use = resource['uses'].setdefault(context['key'],{'roles':set(),'drawRoles':set()})
        use['roles'].add(role)
        if draw:
            use['drawRoles'].add(role)
        return resource['key']

    @staticmethod
    def lookup(sub,kind,handle):
        if handle==0:
            return None
        require((kind,handle) in sub['objects'],'packet references missing live object')
        return sub['objects'][(kind,handle)]

    def object(self,context,sub,kind,w,cite):
        handle = w[1]
        require(handle>0,'zero created object handle')
        fields = {}
        resource = None
        if kind in ('SURFACE','MSAA_SURFACE','SAMPLER_VIEW'):
            require(len(w)==(7 if kind in ('MSAA_SURFACE','SAMPLER_VIEW') else 6),'wrong surface/view size')
            rid = w[2]
            resource = self.mark(rid,'surface-created' if kind!='SAMPLER_VIEW' else 'view-created',context)
            if kind=='SAMPLER_VIEW':
                fmt,target = w[3]&0xFFFFFF,w[3]>>24
                fields = {'format':fmt,'formatName':format_name(fmt),'target':target,
                          'layerWord':w[4],'levelWord':w[5],'swizzleWord':w[6],
                          'swizzle':[(w[6]>>(3*i))&7 for i in range(4)]}
                if self.resource(rid)['target']==0:
                    fields.update(firstElement=w[4],lastElement=w[5])
                else:
                    fields.update(firstLayer=w[4]&0xFFFF,lastLayer=w[4]>>16,
                                  firstLevel=w[5]&0xFF,lastLevel=(w[5]>>8)&0xFF)
            else:
                fields = {'format':w[3],'formatName':format_name(w[3]),'level':w[4],
                          'firstLayer':w[5]&0xFFFF,'lastLayer':w[5]>>16}
                if kind=='MSAA_SURFACE':
                    fields['sampleCount'] = w[6]
        elif kind=='SAMPLER_STATE':
            require(len(w)==10,'wrong sampler state size')
            bits = w[2]
            fields = {'stateWord':bits,'wrapS':bits&7,'wrapT':(bits>>3)&7,'wrapR':(bits>>6)&7,
                      'minImageFilter':(bits>>9)&1,'minMipFilter':(bits>>11)&3,
                      'magImageFilter':(bits>>13)&1,'compareMode':(bits>>15)&1,
                      'compareFunc':(bits>>16)&7,'seamlessCube':(bits>>19)&1,
                      'maxAnisotropy':(bits>>20)&31,'lodBiasBits':w[3],
                      'minLodBits':w[4],'maxLodBits':w[5],'borderColorBits':list(w[6:10])}
        elif kind=='VERTEX_ELEMENTS':
            require((len(w)-2)%4==0,'wrong vertex elements size')
            fields = {'elements':[{'sourceOffset':w[i],'instanceDivisor':w[i+1],
                                    'bufferIndex':w[i+2],'format':w[i+3],
                                    'formatName':format_name(w[i+3])}
                                   for i in range(2,len(w),4)]}
        elif kind=='SHADER':
            complete = self.shader_completions.get((cite['event'],cite['byteOffset']))
            if complete is None:
                return  # retained CommandDecoder has checked the continuation
            fields = complete
        else:
            fields = {'words':list(w[2:])}
        key = f"{context['key']}/{context['subcontext']}/{kind}/{handle}@{cite['event']}:{cite['byteOffset']}"
        obj = {'key':key,'context':context['key'],'subcontext':context['subcontext'],
               'kind':kind,'handle':handle,'resource':resource,'fields':fields,'citation':cite}
        sub['objects'][(kind,handle)] = obj
        self.objects.append(obj)

    def packet(self,context,name,kind,w,cite):
        selected = context['selected']
        context['opcodes'][name] += 1
        if selected:
            self.client_packets.append({'opcode':name,'objectType':kind,'words':list(w),'citation':cite})
        sub = context['states'].setdefault(context['subcontext'],state())
        if name=='SET_SUB_CTX':
            require(len(w)==2,'wrong subcontext selection size')
            context['subcontext'] = w[1]
            return
        if name=='CREATE_SUB_CTX':
            require(len(w)==2,'wrong subcontext create size')
            context['states'].setdefault(w[1],state())
            return
        if name=='DESTROY_SUB_CTX':
            require(len(w)==2,'wrong subcontext destroy size')
            context['states'].pop(w[1],None)
            return
        if name=='CREATE_OBJECT':
            self.object(context,sub,kind,w,cite)
        elif name=='DESTROY_OBJECT':
            require(len(w)==2,'wrong object destroy size')
            sub['objects'].pop((kind,w[1]),None)
        elif name=='BIND_OBJECT':
            require(len(w)==2,'wrong object bind size')
            sub['bound'][kind] = self.lookup(sub,kind,w[1])
        elif name=='BIND_SHADER':
            require(len(w)==3,'wrong shader bind size')
            shader = self.lookup(sub,'SHADER',w[1])
            if shader:
                require(shader['fields']['stage']==('VERT','FRAG','GEOM','TESS_CTRL','TESS_EVAL','COMP')[w[2]],
                        'bound shader stage differs')
            sub['shaders'][w[2]] = shader
        elif name=='SET_FRAMEBUFFER_STATE':
            require(len(w)==w[1]+3,'wrong framebuffer size')
            # Ordinary surfaces are used in the required clients. MSAA remains
            # visible in object records and is not a claimed renderer mapping.
            sub['framebuffer'] = {'colors':[self.lookup(sub,'SURFACE',h) for h in w[3:]],
                                  'depth':self.lookup(sub,'SURFACE',w[2])}
        elif name=='SET_VERTEX_BUFFERS':
            require((len(w)-1)%3==0,'wrong vertex buffer size')
            sub['vertices'] = [{'stride':w[i],'offset':w[i+1],'resource':self.resource(w[i+2])['key'],
                                'resourceId':w[i+2],'citation':cite}
                               if w[i+2] else None for i in range(1,len(w),3)]
        elif name=='SET_INDEX_BUFFER':
            require(len(w)==(4 if w[1] else 2),'wrong index buffer size')
            sub['index'] = ({'resource':self.resource(w[1])['key'],'resourceId':w[1],
                             'indexBytes':w[2],'offset':w[3],'citation':cite} if w[1] else None)
        elif name in ('SET_SAMPLER_VIEWS','BIND_SAMPLER_STATES'):
            require(len(w)>=3,'wrong sampler binding size')
            table = sub['views' if name=='SET_SAMPLER_VIEWS' else 'samplers']
            object_kind = 'SAMPLER_VIEW' if name=='SET_SAMPLER_VIEWS' else 'SAMPLER_STATE'
            for index,handle in enumerate(w[3:],w[2]):
                table[(w[1],index)] = self.lookup(sub,object_kind,handle)
        elif name=='SET_UNIFORM_BUFFER':
            require(len(w)==6,'wrong uniform buffer size')
            sub['uniforms'][(w[1],w[2])] = ({'resource':self.resource(w[5])['key'],'resourceId':w[5],
                                           'offset':w[3],'length':w[4],'citation':cite} if w[5] else None)
        elif name=='SET_CONSTANT_BUFFER':
            require(len(w)>=3,'wrong constant buffer size')
            raw = struct.pack('<'+'I'*len(w[3:]),*w[3:])
            sub['constants'][(w[1],w[2])] = {'stage':w[1],'slot':w[2],'words':len(w)-3,
                                            'sha256':sha256(raw),'citation':cite}
        elif name=='SET_VIEWPORT_STATE':
            require((len(w)-2)%6==0,'wrong viewport size')
            sub['viewport'] = {'startSlot':w[1],'words':list(w[2:]),'citation':cite}
        elif name in ('TRANSFER3D','COPY_TRANSFER3D','RESOURCE_INLINE_WRITE'):
            require(len(w)>=(14 if name=='TRANSFER3D' else 15 if name=='COPY_TRANSFER3D' else 12),
                    'truncated transfer packet')
            self.mark(w[1],'inline-write' if name=='RESOURCE_INLINE_WRITE' else 'transfer',context)
            if name=='COPY_TRANSFER3D':
                self.mark(w[12],'copy-transfer-source',context)
            if selected:
                transfer = {'opcode':name,'resource':self.resource(w[1])['key'],'level':w[2],
                            'usage':w[3],'stride':w[4],'layerStride':w[5],
                            'box':dict(zip(('x','y','z','w','h','d'),w[6:12])),
                            'citation':cite,'backingAtSubmit':self.backings.get(self.resource(w[1])['key'])}
                if name=='TRANSFER3D':
                    transfer.update(dataOffset=w[12],direction=w[13])
                elif name=='COPY_TRANSFER3D':
                    source = self.resource(w[12])['key']
                    transfer.update(sourceResource=source,sourceOffset=w[13],flags=w[14],
                                    sourceBackingAtSubmit=self.backings.get(source))
                else:
                    payload = struct.pack('<'+'I'*len(w[12:]),*w[12:])
                    transfer.update(inlineBytes=len(payload),inlineSha256=sha256(payload))
                self.client_transfers.append(transfer)
        elif name=='DRAW_VBO':
            self.draw(context,sub,w,cite)
        elif selected and name in ('BLIT','RESOURCE_COPY_REGION','SET_SHADER_BUFFERS','SET_SHADER_IMAGES','SET_ATOMIC_BUFFERS',
                                   'SET_STREAMOUT_TARGETS','SET_FRAMEBUFFER_STATE_NO_ATTACH'):
            # These clients only emit empty atomic/streamout bindings and a
            # no-attach size hint. Fail rather than silently miss a new resource.
            require((name=='SET_FRAMEBUFFER_STATE_NO_ATTACH' and len(w)==3)
                    or (name=='SET_ATOMIC_BUFFERS' and len(w)>=2 and (len(w)-2)%3==0 and not any(w[2:]))
                    or (name=='SET_SHADER_BUFFERS' and len(w)>=3 and (len(w)-3)%3==0 and not any(w[3:]))
                    or (name=='SET_SHADER_IMAGES' and len(w)>=3 and (len(w)-3)%5==0 and not any(w[3:]))
                    or (name=='SET_STREAMOUT_TARGETS' and len(w)==2),
                    'unhandled active client resource-use command: '+name)

    def draw(self,context,sub,w,cite):
        require(len(w) in (13,15,21),'wrong original draw size')
        framebuffer = sub['framebuffer']
        for role,objects in (('color-surface',framebuffer['colors']),
                             ('depth-stencil-surface',[framebuffer['depth']])):
            for obj in objects:
                if obj:
                    self.mark_key(obj['resource'],role,context,draw=True)
        elements = sub['bound'].get('VERTEX_ELEMENTS')
        require(elements is not None,'draw has no original vertex elements')
        for element in elements['fields']['elements']:
            index = element['bufferIndex']
            require(index<len(sub['vertices']) and sub['vertices'][index] is not None,'draw has no vertex buffer')
            self.mark_key(sub['vertices'][index]['resource'],'vertex-buffer',context,draw=True)
        if w[4]:
            require(sub['index'] is not None,'indexed draw has no index resource')
            self.mark_key(sub['index']['resource'],'index-buffer',context,draw=True)
        active_views = []
        for (stage,slot),view in sorted(sub['views'].items()):
            if view:
                sampler = sub['samplers'].get((stage,slot))
                require(sampler is not None,'draw has no sampler for bound view')
                self.mark_key(view['resource'],'sampler-view',context,draw=True)
                active_views.append({'stage':stage,'slot':slot,'view':view['key'],'sampler':sampler['key']})
        for uniform in sub['uniforms'].values():
            if uniform:
                self.mark_key(uniform['resource'],'uniform-buffer',context,draw=True)
        context['drawCount'] += 1
        if not context['selected']:
            return
        shaders = {str(stage):obj['key'] for stage,obj in sub['shaders'].items() if obj}
        require('0' in shaders and '1' in shaders and any(framebuffer['colors']),
                'client draw lacks its original VS/FS/color attachment')
        self.draws.append({'citation':cite,'words':list(w[1:]),'shaders':shaders,
                          'colors':[obj['key'] if obj else None for obj in framebuffer['colors']],
                          'depth':framebuffer['depth']['key'] if framebuffer['depth'] else None,
                          'vertexElements':elements['key'],'vertexBuffers':sub['vertices'],
                          'indexBuffer':sub['index'] if w[4] else None,'samplerBindings':active_views,
                          'uniformBuffers':[u for u in sub['uniforms'].values() if u],
                          'constantBuffers':list(sub['constants'].values()),'viewport':sub['viewport'],
                          'rasterizer':sub['bound'].get('RASTERIZER',{}).get('key') if sub['bound'].get('RASTERIZER') else None,
                          'dsa':sub['bound'].get('DSA',{}).get('key') if sub['bound'].get('DSA') else None})

    def run(self,events):
        for event in events:
            kind,phase = event['type'],event.get('phase')
            if kind=='backing_snapshot':
                resource = self.resource(event['resourceId'])
                self.backings[resource['key']] = {'event':event['seq'],'line':event['seq'],
                                                'reason':event['reason'],'iovLengths':event['iovLengths'],
                                                'blob':event['blobs'][0]}
                continue
            if phase!='enter':
                continue
            if kind in ('context_create','context_create_with_flags') and event['parentCallSeq']==0:
                name = blob(self.directory,event['blobs'][0])
                require(event['ctxId'] not in self.live_contexts,'overlapping context inventory lifetime')
                context = {'id':event['ctxId'],'key':f"{event['ctxId']}@{event['seq']}",
                           'createEvent':event['seq'],'nameHex':name.hex(),'name':name.decode('ascii'),
                           'selected':name==CLIENT_NAMES[self.summary['workload']],
                           'nameBlob':event['blobs'][0],'subcontext':0,'states':{},'opcodes':Counter(),'drawCount':0}
                self.live_contexts[event['ctxId']] = context
                self.contexts.append(context)
            elif kind=='context_destroy':
                self.live_contexts.pop(event['ctxId'],None)
            elif kind=='resource_create':
                rid = event['resourceId']
                require(rid not in self.live_resources,'overlapping resource inventory lifetime')
                resource = {k:event[k] for k in ('resourceId','target','format','bind','width','height',
                                                'depth','arraySize','lastLevel','nrSamples','flags')}
                resource.update(key=f"{rid}@{event['seq']}",createEvent=event['seq'],
                                formatName=format_name(event['format']),
                                y0Top=bool(event['flags']&1),mapPersistent=bool(event['flags']&2),
                                mapCoherent=bool(event['flags']&4),unknownFlagBits=event['flags']&~7,
                                declaredBinds=[name for bit,name in BINDS.items() if event['bind']&(1<<bit)],
                                unknownBindBits=event['bind']&~sum(1<<bit for bit in BINDS),uses={})
                self.resources.append(resource)
                self.all_resources[resource['key']] = resource
                self.live_resources[rid] = resource
            elif kind=='resource_unref':
                self.live_resources.pop(event['resourceId'],None)
            elif kind=='ctx_attach_resource':
                context = self.live_contexts[event['ctxId']]
                self.mark(event['resourceId'],'context-attachment',context)
            elif kind in ('transfer_write_iov','transfer_read_iov') and event['ctxId'] in self.live_contexts:
                self.mark(event['resourceId'],kind,self.live_contexts[event['ctxId']])
            elif kind=='submit_cmd':
                require(event['ctxId'] in self.live_contexts,'submission lacks its live inventory context')
                context = self.live_contexts[event['ctxId']]
                raw = blob(self.directory,event['blobs'][0])
                for name,obj,w,cite in packets(raw,event,context,context['subcontext']):
                    cite['subcontext'] = context['subcontext']
                    self.packet(context,name,obj,w,cite)
            elif kind in ('reset','cleanup'):
                self.live_contexts.clear()
                self.live_resources.clear()
        return self.finish()

    def finish(self):
        selected = [c for c in self.contexts if c['selected']]
        require(selected and sum(c['drawCount'] for c in selected)>=3
                and any(d['words'][1]>0 and d['words'][4]>0 for d in self.draws),
                'no positive draws from the actual named client')
        selected_keys = {c['key'] for c in selected}
        rows = defaultdict(lambda:{'roles':set(),'resources':set(),'contexts':set(),'flags':set(),'targets':set()})
        for resource in self.resources:
            for key,use in resource['uses'].items():
                use['roles'] = sorted(use['roles'])
                use['drawRoles'] = sorted(use['drawRoles'])
                if key in selected_keys:
                    row = rows[resource['format']]
                    row['roles'].update(use['drawRoles'])
                    row['resources'].add(resource['key'])
                    row['contexts'].add(key)
                    row['flags'].add(resource['flags'])
                    row['targets'].add(resource['target'])
        required_formats = [{'format':fmt,'formatName':format_name(fmt),
                             'channelSpelling':format_name(fmt).split('_')[0],
                             **{name:sorted(value) for name,value in row.items()},
                             'mappingStatus':'unproven'} for fmt,row in sorted(rows.items())]
        client_objects = [obj for obj in self.objects if obj['context'] in selected_keys]
        shaders = sorted({obj['fields']['sha256'] for obj in client_objects if obj['kind']=='SHADER'})
        vertex_formats = sorted({element['format'] for obj in client_objects if obj['kind']=='VERTEX_ELEMENTS'
                                 for element in obj['fields']['elements']})
        contexts = [{key:value for key,value in context.items() if key not in ('states','subcontext','opcodes')}
                    | {'opcodes':dict(sorted(context['opcodes'].items()))} for context in self.contexts]
        return {'schema':'virgl-required-client-inventory-v1','workload':self.summary['workload'],
                'captureManifestSha256':self.summary['manifestSha256'],
                'boundary':'Observed original client requirements; no renderer mapping, admission, caps or performance proof.',
                'channelSpellingMeaning':'Nominal VirGL enum components only; actual byte/bit conversion remains to be proven.',
                'contexts':contexts,'resources':self.resources,'clientObjects':client_objects,
                'clientPackets':self.client_packets,'clientDraws':self.draws,'clientShaderSha256':shaders,
                'clientTransfers':self.client_transfers,
                'clientInlineWriteCount':sum(t['opcode']=='RESOURCE_INLINE_WRITE' for t in self.client_transfers),
                'clientVertexFormats':[{'format':f,'formatName':format_name(f)} for f in vertex_formats],
                'clientResourceFormats':required_formats,
                'supportingDraws':sum(c['drawCount'] for c in self.contexts if not c['selected'])}


def inventory(directory):
    directory = Path(directory)
    summary,_ = validate_capture(directory)
    manifest = load_json((directory/'manifest.json').read_bytes())
    artifacts = {r['role']:checked_file(directory,r) for r in manifest['artifacts']}
    events = [load_json(raw) for raw in checked_file(directory,manifest['events']).splitlines()]
    result = Inventory(directory,summary).run(events)
    result['eventsSha256'] = manifest['events']['sha256']
    result['protocolSha256'] = sha256((ROOT/'renderer/virgl-shader/vendor/src/virgl_protocol.h').read_bytes())
    result['formatEnumSha256'] = sha256(HW.read_bytes())
    if manifest['workload']=='es2gears':
        result['guestClient'] = check_gears(manifest,artifacts)
    else:
        require(sha256((directory/'manifest.json').read_bytes())==OLD_MANIFESTS['kmscube'],
                'verified original kmscube capture changed')
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--write',action='store_true')
    args = parser.parse_args()
    result = inventory(args.capture)
    raw = encoded(result)
    if args.write:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_bytes(raw)
    else:
        require(args.output.is_file() and args.output.read_bytes()==raw,'derived client inventory differs')
    print(json.dumps({'workload':result['workload'],'draws':len(result['clientDraws']),
                      'supportingDraws':result['supportingDraws'],'formats':result['clientResourceFormats'],
                      'shaderSha256':result['clientShaderSha256'],'inventorySha256':sha256(raw)}))


if __name__=='__main__':
    try:
        main()
    except (CaptureError,OSError,ValueError,KeyError,TypeError,IndexError) as error:
        import sys
        print('client inventory failed: '+str(error),file=sys.stderr)
        raise SystemExit(1)
