"""Independent framing and immutable current-bank checks for recorded submissions."""
import struct


def verify(rig, mode, helper):
    require=helper['require'];bank=helper['math'].bank
    constants=[[],[]];schedule=rig.get('schedule');counts={'submissions':0,'fences':0,'withheldPolls':0,'rejections':0}
    def packets(raw):
        data=bytes(raw);out=[];at=0
        while at<len(data):
            require(at+4<=len(data),'complete command header');header=struct.unpack_from('<I',data,at)[0];n=header>>16;end=at+4+4*n
            require(end<=len(data),'complete immutable command payload')
            out.append((header&255,(header>>8)&255,list(struct.unpack_from('<'+'I'*n,data,at+4))))
            at=end
        return out
    for record in rig['submissions']:
        commands=packets(record['bytes']);result=record['result'];counts['submissions']+=1
        require(record['contextId']==1 and 0<=record['eventsStart']<=record['eventsEnd']<=len(rig['glEvents']),'bounded actual submission event interval')
        events=rig['glEvents'][record['eventsStart']:record['eventsEnd']]
        applied=result['appliedCommands'];require(type(applied)is int and 0<=applied<=len(commands),'honest applied command prefix')
        invalid=any(op==12 and not all(helper['finite'](word) for word in words[2:]) for op,_,words in commands)
        if invalid and mode=='normal':require(result['ok']is False and result['error']['code']=='invalid-value' and applied==0 and events==[],'normal decoder rejects entire nonfinite packet before effects')
        elif result['ok']:require(applied==len(commands),'successful decoded submission applies all commands')
        for op,kind,words in commands[:applied]:
            if op==12:
                require(words[0]in(0,1) and words[1]==0 and len(words[2:])<=184 and len(words[2:])%4==0,'literal supported complete-bank replacement')
                constants[words[0]]=words[2:]
        for capture in rig['atlases']+rig['draws']:
            if capture['submissionIndex']==counts['submissions']-1:require(capture['bindings']['constants']==constants,'capture uses the current banks from independently framed applied packets')
        if 'inputAfter'in record:require(record['inputAfter']==[255]*len(record['bytes']),'caller mutation occurs after owned original snapshot')
        if schedule:
            require(record['begin']['ok']is True and record['begin']['profile']=='virgl-tiny-async-jobs-v1' and record['begin']['byteLength']==len(record['bytes']) and record['begin']['commandCount']==len(commands) and record['states'] and record['states'][-1]['status']=='done','bounded real async job owns exactly the submitted bytes and commands')
            require(len(record['delays'])==len(record['states'])-1,'one actual browser-task delay between incomplete steps')
            for step,delay in enumerate(record['delays']):require(delay==((schedule['seed']*(step+1))&0xffffffff)%3,'declared varied browser task schedule')
            last=0
            for item in record['states']:
                require(item['status']in('ready','waiting-gpu','done') and last<=item['appliedCommands']<=len(commands),'monotonic bounded asynchronous command progress')
                last=item['appliedCommands']
                jobs=item['jobs']
                if item['status']=='done':require(jobs=={'active':0,'status':'idle','appliedCommands':0,'commandCount':0,'draws':0,'inputBytes':0,'outputBytes':0,'reads':0,'transfers':0,'stagingBytes':0},'completed async job releases ownership')
                else:
                    require(jobs['active']==1 and jobs['appliedCommands']==last and jobs['commandCount']==len(commands) and jobs['inputBytes']==jobs['outputBytes']==jobs['transfers']==0,'same bounded owned job through browser tasks')
                    require(jobs['status'] in ('ready','waiting-index','finishing'),'only index and completion yields')
                    if jobs['status']=='waiting-index':require(jobs['reads']==1 and jobs['stagingBytes']==len(rig['geometry']['indexWords'])*2,'actual bounded index read staging')
            require(last==applied,'async completion reports same applied prefix')
        else:require(record['states']==[],'synchronous proof does not fabricate jobs')
    pending={};serial=0;last_turn=0
    for e in rig['glEvents']:
        require(e['turn']>=last_turn,'monotonic actual browser tasks');last_turn=e['turn']
        if e['call']=='fenceSync':
            require(schedule is not None,'only asynchronous path fences');serial+=1;pending[e['id']]={'last':e['turn'],'remaining':((serial*1664525+schedule['seed']+1013904223)&0xffffffff)%4,'signaled':False};counts['fences']+=1
        elif e['call']=='fenceSchedule':require(e['withheld']==pending[e['id']]['remaining'],'deterministic delayed-signal schedule')
        elif e['call']=='clientWaitSync':
            p=pending[e['id']];require(e['turn']>p['last'] and not p['signaled'] and e['actual']in(37146,37147,37148),'nonblocking poll once per later real browser task');p['last']=e['turn']
            if e['actual']!=37147 and p['remaining']:
                p['remaining']-=1;counts['withheldPolls']+=1;require(e['delivered']==37147,'only true completion withheld')
            else:require(e['actual']==e['delivered'],'other native poll result unchanged');p['signaled']=e['actual']!=37147
        elif e['call']=='deleteSync':p=pending.pop(e['id']);require(p['signaled'] and p['remaining']==0,'actual completed fence released')
    require(not pending,'all native fences released')
    if schedule:require(counts['fences']>0 and counts['withheldPolls']>0,'real async varied completion schedule')
    for attack in rig['attacks']:
        require(attack['pixelsBefore']==attack['pixelsAfter'] and len(attack['pixelsBefore'])==16384,'all rejected work preserves full framebuffer')
        if attack['name']=='invalid bank':
            original=packets(attack['packetBytes']);require(len(original)==2 and original[1][0]==12 and original[1][2][0]==attack['stage'] and original[1][2][2+attack['position']]==attack['word'],'exact nonfinite wire witness')
            require(not helper['finite'](attack['word']),'bad exponent delivered without numeric coercion')
            if mode=='normal':require(attack['result']['error']['code']=='invalid-value' and attack['events']==[] and attack['before']['contexts']==attack['after']['contexts'],'normal invalid packet atomic')
            else:
                require(attack['result']['ok']is True and attack['result']['appliedCommands']==2,'bypassed decoder honestly stores its prefix')
                after=attack['after']['contexts'][0]['subContexts'][0]['bindings']['constants'][attack['stage']]
                require(after==original[1][2][2:],'bypassed invalid CPU bank is not normalized')
                require(not any(e['call']=='uniform4uiv' and not all(map(helper['finite'],e['words'])) for e in attack['events']),'compiler-derived domain blocks invalid nondraw upload')
        else:
            require(attack['result']['ok']is False and attack['result']['appliedCommands']==0 and attack['result']['error']['code']in('incomplete-draw','constant-domain-error'),'strict conditional draw failure')
            require(not any(e['call']in('drawElements','copyBufferSubData','getBufferSubData') for e in attack['events']),'strict failure precedes index work/native draw')
            counts['rejections']+=1
    for e in rig['lifecycle']:
        require(e['name']=='compiler rejection' and e['result']['ok']is False and e['result']['appliedCommands']==0 and e['before']==e['after'] and e['events']==[],'failed conditional retry publishes no renderer/native state')
    for e in rig['yieldAttacks']:
        require(e['before']['jobs']['status']=='waiting-index' and e['before']['contexts']==e['after']['contexts'],'same checked identities across actual index yield')
        require([a['name'] for a in e['attempts']]==['begin','restore','destroy'] and all(a['result']['ok']is False and a['result']['error']['code']=='busy' for a in e['attempts']),'public mutations rejected while draw snapshot is retained')
    for e in rig['poison']:
        require(e['entries'] and all(x['words']==x['observed'] for x in e['entries']),'external native uniforms really poisoned')
        require(e['after']=={'programNull':True,'framebufferNull':True,'vertexArrayNull':True,'viewport':[0,0,1,1],'colorMask':[False]*4},'actual external state poison')
    return counts
