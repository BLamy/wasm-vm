"""Fresh sampler critic: expectations depend only on original words and uploads."""
import math,re,struct

def f32(value):return struct.unpack('<f',struct.pack('<f',value))[0]
def fw(word):return struct.unpack('<f',struct.pack('<I',word))[0]

def packets(text):
    raw=bytes.fromhex(text);offset=0
    while offset<len(raw):
        header,=struct.unpack_from('<I',raw,offset);size=header>>16;end=offset+4*(size+1)
        assert end<=len(raw)
        yield header&255,header>>8&255,list(struct.unpack_from('<'+'I'*size,raw,offset+4))
        offset=end
    assert offset==len(raw)

def sampler(words):
    assert len(words)==9
    b=words[1]
    return dict(handle=words[0],s=b&7,t=b>>3&7,r=b>>6&7,min=b>>9&1,mip=b>>11&3,mag=b>>13&1,compare=b>>15&1,compareFunction=b>>16&7,seamless=bool(b&1<<19),anisotropy=b>>20&31,bias=fw(words[2]),minLod=fw(words[3]),maxLod=fw(words[4]),border=words[5:])

def parameters(p):
    address={0:10497,2:33071,4:33648}
    return dict(wrapS=address[p['s']],wrapT=address[p['t']],wrapR=address[p['r']],minFilter=[[9984,9986,9728],[9985,9987,9729]][p['min']][p['mip']],magFilter=9728+p['mag'],compareMode=0,compareFunction=512+p['compareFunction'],minLod=p['minLod'],maxLod=p['maxLod'])

def original_draws(run,through):
    contexts={};result=[]
    def sub():return dict(objects={},shaders=[None,None],views=[{},{}],samplers=[{},{}],buffers=[],surfaces=[])
    for ordinal,record in enumerate(run['history'][:through+1]):
        ctx=contexts.setdefault(record['ctx'],dict(current=0,subs={0:sub()}))
        for command,(op,kind,w) in enumerate(packets(record['hex'])):
            s=ctx['subs'][ctx['current']]
            if op==1:
                o=dict(kind=kind,token=(record['ctx'],ctx['current'],ordinal,command))
                if kind==7:o['fields']=sampler(w)
                elif kind==6:o['fields']=dict(resource=w[1],format=w[2]&0xffffff,target=w[2]>>24,swizzle=[w[5]>>(3*i)&7 for i in range(4)])
                elif kind==8:o['fields']=dict(resource=w[1],format=w[2])
                elif kind==4:
                    raw=struct.pack('<'+'I'*(len(w)-5),*w[5:]);assert raw[w[2]-1]==0
                    o['text']=raw[:w[2]-1].decode('ascii');o['stage']=w[1]
                s['objects'][w[0]]=o
            elif op==3:
                old=s['objects'].pop(w[0],None)
                if old and old['kind']==7:
                    for slots in s['samplers']:
                        for key,value in list(slots.items()):
                            if value is old:slots[key]=None
            elif op in [10,18]:
                slots=s['views' if op==10 else 'samplers'][w[0]]
                for i,h in enumerate(w[2:]):slots[w[1]+i]=s['objects'].get(h) if h else None
            elif op==31:s['shaders'][w[1]]=s['objects'][w[0]]
            elif op==6:s['buffers']=[dict(stride=w[i],offset=w[i+1],resource=w[i+2]) for i in range(0,len(w),3)]
            elif op==5:s['surfaces']=[s['objects'][h] for h in w[2:]]
            elif op==29:ctx['subs'][w[0]]=sub();ctx['current']=w[0]
            elif op==28:ctx['current']=w[0]
            elif op==30:
                del ctx['subs'][w[0]]
                if ctx['current']==w[0]:ctx['current']=0
            elif op==8:
                vs,fs=[o['text'] for o in s['shaders']]
                def immediate(index):
                    found=re.search(r'IMM\['+str(index)+r'\] FLT32 \{([^}]+)\}',vs);assert found
                    return [f32(float(n.strip())) for n in found[1].split(',')]
                a,b,d=immediate(0),immediate(1),immediate(2)
                assert a[0]==a[1] and a[2:]==b[2:]==d[2:]==[0,0]
                has_vs='TEX OUT[2]' in vs;has_fs='TEX ' in fs
                samples=[]
                for stage,enabled in [(0,has_vs),(1,has_fs)]:
                    if enabled:
                        view=s['views'][stage][0];state=s['samplers'][stage][0];assert view and state
                        samples.append(dict(stage=stage,name='vssamp0' if stage==0 else 'fssamp0',unit=16 if stage==0 else 0,view=view['fields'],sampler=state['fields'],token=state['token']))
                result.append(dict(record=ordinal,words=w,vertex=vs,fragment=fs,scale=a[0],offset=b[:2],vsCoord=d[:2],stage='both' if has_vs and has_fs else 'vertex' if has_vs else 'fragment',sampling=samples,buffers=[dict(x) for x in s['buffers']],target=s['surfaces'][0]['fields']['resource']))
    return result

def wrap(index,size,mode):
    if mode==2:return min(size-1,max(0,index))
    period=size if mode==0 else 2*size;phase=index-period*math.floor(index/period)
    return phase if mode==0 or phase<size else 2*size-1-phase

def lookup(image,width,height,u,v,linear,p,swizzle):
    def texel(x,y):
        at=4*(wrap(y,height,p['t'])*width+wrap(x,width,p['s']));return image[at:at+4]
    if not linear:color=texel(math.floor(u*width),math.floor(v*height))
    else:
        a,b=u*width-.5,v*height-.5;x,y=math.floor(a),math.floor(b);dx,dy=a-x,b-y
        corners=[texel(x,y),texel(x+1,y),texel(x,y+1),texel(x+1,y+1)]
        color=[sum(weight*corner[k] for weight,corner in zip([(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy],corners)) for k in range(4)]
    return [0 if k==4 else 255 if k==5 else color[k] for k in swizzle]

def full_pixels(draw,uploads,metadata,width,height):
    colors={};lambdas={}
    for sample in draw['sampling']:
        p=sample['sampler'];assert p['minLod']<=p['maxLod']
        view=sample['view'];m=metadata[view['resource']];image=uploads[view['resource']]
        lod=0 if sample['stage']==0 else math.log2(max(2*draw['scale']*m['width']/width,2*draw['scale']*m['height']/height))
        clamped=min(p['maxLod'],max(p['minLod'],lod));linear=p['mag'] if clamped<=0 else p['min'];lambdas[sample['stage']]=dict(lod=lod,clamped=clamped,filter=linear)
        if sample['stage']==0:colors[0]=lookup(image,m['width'],m['height'],*draw['vsCoord'],linear,p,view['swizzle'])
        else:colors[1]=(image,m,linear,p,view['swizzle'])
    out=bytearray()
    for y in range(height):
        for x in range(width):
            fragment=None
            if 1 in colors:
                image,m,linear,p,swizzle=colors[1];u=f32(f32((2*(x+.5)/width-1)*draw['scale'])+draw['offset'][0]);v=f32(f32((2*(y+.5)/height-1)*draw['scale'])+draw['offset'][1])
                fragment=lookup(image,m['width'],m['height'],u,v,linear,p,swizzle)
            color=[(a+b)/2 for a,b in zip(colors[0],fragment)] if draw['stage']=='both' else colors[0] if draw['stage']=='vertex' else fragment
            out.extend(max(0,min(255,math.floor(n+.5))) for n in color)
    return bytes(out),lambdas

def specialized_shader(text,samples,stage):
    """The unchanged inherited view transform; input is full actual C/Wasm output."""
    helpers='';lanes=['v.r','v.g','v.b','v.a','0.0','1.0']
    for s in samples:
        if s['stage']!=stage or s['view']['swizzle']==[0,1,2,3]:continue
        name='wv_view_0';text,n=re.subn(r'\btexture\s*\(\s*'+s['name']+r'\s*,',name+'(',text);assert n>0
        helpers+='vec4 '+name+'(vec2 coord){vec4 v=texture('+s['name']+',coord);return vec4('+','.join(lanes[k] for k in s['view']['swizzle'])+');}\n'
    if not helpers:return text
    at=text.index('\nvoid main(')+1
    return text[:at]+helpers+text[at:]
