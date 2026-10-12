use super::*;

fn critic_split(q: &mut Queue, label: &str, request: Vec<u8>, expected: u32, split: usize) {
    let before = q.state.borrow().control3d_snapshot().unwrap().canonical_bytes();
    let sink = q.recorder.borrow().events.clone();
    let req_len = request.len();
    let cut = split % (req_len - 1) + 1;
    let response_cut = split % 23 + 1;
    let (response, used) = q.submit_split(&request, &[cut, req_len-cut], &[response_cut, 24-response_cut]);
    q.record_case(label, &request, &response);
    assert_eq!(used, 24);
    assert_eq!(response, reply(&request, expected));
    assert_eq!(q.read(RESPONSE+24, 40), vec![0xa5;40]);
    if expected != OK {
        assert_eq!(q.state.borrow().control3d_snapshot().unwrap().canonical_bytes(), before);
        assert_eq!(q.recorder.borrow().events, sink);
    }
}

#[test]
fn desktop_critic_positive_fields_unknown_words_and_independent_budgets() {
    let mut q = Queue::desktop(true);
    let id = 0xd510_0001;
    for format in [1,2,67] {
        for role in [2,8,10] {
            for hint in [0, 1<<18, 1<<20, (1<<18)|(1<<20)] {
                let p=resource(id,2,format,role|hint,3,7);
                critic_split(&mut q,"critic-positive-color",p,OK,(format+role+hint) as usize);
                assert_eq!(q.state.borrow().control3d_snapshot().unwrap().gpu_bytes,84);
                q.expect("critic-positive-color-unref",id_command(0x102,0,id),OK);
            }
        }
        for bit in (0..32).filter(|bit| ![1,3,18,20].contains(bit)) {
            critic_split(&mut q,"critic-unknown-color-bit",resource(id,2,format,2|(1u32<<bit),3,7),INVALID_PARAMETER,bit);
        }
        for role in [0,1,9,1<<18,1<<20,u32::MAX] {
            q.unchanged("critic-invalid-color-role",resource(id,2,format,role,3,7),INVALID_PARAMETER);
        }
    }
    for role in [1,8,9] {
        critic_split(&mut q,"critic-positive-depth",resource(id,2,20,role,3,7),OK,role as usize);
        q.expect("critic-depth-unref",id_command(0x102,0,id),OK);
    }
    for bit in (0..32).filter(|bit| ![0,3].contains(bit)) {
        q.unchanged("critic-unknown-depth-bit",resource(id,2,20,9|(1u32<<bit),3,7),INVALID_PARAMETER);
    }
    for format in [0,3,16,17,18,21,126,233,u32::MAX] {
        q.unchanged("critic-unknown-format",resource(id,2,format,10,3,7),INVALID_PARAMETER);
    }
    for format in [1,2,67,20] {
        let role=if format==20 {9} else {10};
        for (w,h) in [(16384,1),(1,16384),(1024,1024)] {
            q.expect("critic-exact-color-dimension-resource",resource(id,2,format,role,w,h),OK);
            q.expect("critic-exact-color-unref",id_command(0x102,0,id),OK);
        }
        for (w,h,code) in [(0,1,INVALID_PARAMETER),(1,0,INVALID_PARAMETER),(16385,1,INVALID_PARAMETER),(1,16385,INVALID_PARAMETER),(1024,1025,OOM),(u32::MAX,u32::MAX,INVALID_PARAMETER)] {
            q.unchanged("critic-color-boundary-refusal",resource(id,2,format,role,w,h),code);
        }
        for (offset,value) in [(28,u32::MAX),(48,0),(48,2),(52,0),(52,2),(56,1),(60,1),(64,1),(68,u32::MAX),(16,0x31415926),(4,2),(20,1),(21,1)] {
            let mut p=resource(id,2,format,role,3,7);put32(&mut p,offset,value);
            critic_split(&mut q,"critic-malformed-field",p,INVALID_PARAMETER,offset);
        }
    }
    for role in [16,32,524288] {
        q.expect("critic-old-buffer-exact",resource(id,0,64,role,4194304,1),OK);
        q.expect("critic-old-buffer-unref",id_command(0x102,0,id),OK);
        q.unchanged("critic-old-buffer-plus-one",resource(id,0,64,role,4194305,1),OOM);
    }
    for capacity in 1..24 {
        let p=resource(id,2,1,10|(1<<18),3,7);
        let before=q.state.borrow().control3d_snapshot().unwrap().canonical_bytes();
        let sink=q.recorder.borrow().events.clone();
        let (reply,used)=q.submit_split(&p,&[17,55],&[capacity]);
        q.record_case("critic-short-response",&p,&reply);
        assert_eq!(used,0);assert_eq!(q.read(RESPONSE,64),vec![0xa5;64]);
        assert_eq!(q.state.borrow().control3d_snapshot().unwrap().canonical_bytes(),before);
        assert_eq!(q.recorder.borrow().events,sink);
    }
    q.expect("critic-recover-short-response",resource(id,2,1,10|(1<<18),3,7),OK);
    q.expect("critic-recover-short-unref",id_command(0x102,0,id),OK);
    for i in 0..8 { q.expect("critic-GPU-budget-exact",resource(id+i,2,[1,2,67,20][i as usize%4],if i%4==3 {9} else {10},1024,1024),OK); }
    assert_eq!(q.state.borrow().control3d_snapshot().unwrap().gpu_bytes,33554432);
    q.unchanged("critic-GPU-byte-plus-one",resource(id+8,0,64,16,1,1),OOM);
    for i in 0..8 { q.expect("critic-GPU-budget-unref",id_command(0x102,0,id+i),OK); }
    for i in 0..8 {
        q.expect("critic-backing-staging",resource(id+i,0,64,524288,1,1),OK);
        q.expect("critic-backing-exact",backing(id+i,&[(virt::DRAM_BASE,4194304)]),OK);
    }
    assert_eq!(q.state.borrow().control3d_snapshot().unwrap().backing_bytes,33554432);
    q.expect("critic-backing-overflow-staging",resource(id+8,0,64,524288,1,1),OK);
    q.unchanged("critic-backing-aggregate-plus-one",backing(id+8,&[(BACKING2+113,1)]),OOM);
    q.unchanged("critic-backing-resource-plus-one",backing(id+8,&[(virt::DRAM_BASE,4194304),(BACKING2+113,1)]),OOM);
    for i in 0..9 {q.expect("critic-backing-final-unref",id_command(0x102,0,id+i),OK);}
    let empty=q.state.borrow().control3d_snapshot().unwrap();assert!(empty.resources.is_empty());assert_eq!((empty.logical_bytes,empty.gpu_bytes,empty.backing_bytes),(0,0,0));
}

#[test]
fn desktop_critic_three_fresh_ownership_schedules() {
    for seed in [0x31c7_u32,0xb92d,0xe563] {
        let mut q=Queue::desktop(true);
        let base=0xd520_0000+(seed<<8);let ctx=base+7;
        q.expect("critic-context-A",context(ctx),OK);
        q.expect("critic-context-B",context(ctx+1),OK);
        for i in 0..64u32 {
            let n=(i*37+seed)%64;let id=base+n*23;
            let mut packet=resource(id,2,[1,2,67,20][n as usize%4],if n%4==3 {9} else {2|(1<<18)|(1<<20)},3,2);
            put32(&mut packet,4,1);packet[8..16].copy_from_slice(&(0x5a71_9000_0000_0000u64+u64::from(id)).to_le_bytes());
            critic_split(&mut q,"critic-shuffled64",packet,OK,(seed+i) as usize);
            assert_eq!(q.state.borrow().control3d_snapshot().unwrap().resources.len(),i as usize+1);
        }
        q.unchanged("critic-independent65-refusal",resource(base+0x10000,2,1,2,3,2),OOM);
        let id=base;
        q.expect("critic-membership-A",id_command(0x202,ctx,id),OK);
        q.expect("critic-membership-B",id_command(0x202,ctx+1,id),OK);
        let pattern:Vec<u8>=(0..32).map(|i|(i as u8)^seed as u8).collect();q.write(BACKING+5,&pattern);
        q.expect("critic-overlapping-backing",backing(id,&[(BACKING+5,7),(BACKING+9,8),(BACKING+5,7)]),OK);
        let saved=q.recorder.borrow().events.last().unwrap().clone();
        if let Control3dOperation::AttachBacking{segments,..}=&saved.operation {
            assert_eq!(segments.iter().flat_map(|s|s.bytes.iter().copied()).collect::<Vec<_>>(),[&pattern[..7],&pattern[4..12],&pattern[..7]].concat());
            eprintln!("CRITIC_OWNED_BACKING seed={seed} {saved:?}");
        } else {panic!("expected owned backing");}
        q.write(BACKING+5,&[0xee;32]);q.write(REQUEST,&[0xdd;72]);
        assert_eq!(*q.recorder.borrow().events.last().unwrap(),saved,"guest/request mutations must not mutate owned event");
        let generation=q.state.borrow().control3d_snapshot().unwrap().resources.iter().find(|r|r.identity.id==id).unwrap().identity.generation;
        q.recorder.borrow_mut().fail_next=Some(Control3dError::OutOfMemory);
        q.unchanged("critic-unref-host-failure",id_command(0x102,0,id),OOM);
        q.expect("critic-unref-with-two-memberships",id_command(0x102,0,id),OK);
        q.recorder.borrow_mut().fail_next=Some(Control3dError::OutOfMemory);
        q.unchanged("critic-create-host-failure",resource(id,2,1,2,3,2),OOM);
        critic_split(&mut q,"critic-same-ID-recovery",resource(id,2,1,2,3,2),OK,seed as usize);
        let state=q.state.borrow().control3d_snapshot().unwrap();assert_eq!(state.resources.len(),64);assert_eq!(state.backing_bytes,0);
        assert!(state.resources.iter().find(|r|r.identity.id==id).unwrap().identity.generation>generation);
        assert!(state.contexts.iter().all(|c|c.resources.is_empty()));
        q.unchanged("critic-stale-A",id_command(0x203,ctx,id),INVALID_PARAMETER);
        q.unchanged("critic-stale-B",id_command(0x203,ctx+1,id),INVALID_PARAMETER);
        q.unchanged("critic-duplicate-live-ID",resource(id,2,1,2,3,2),INVALID_RESOURCE);
        q.expect("critic-fresh-membership",id_command(0x202,ctx,id),OK);
        let mut two=header(0x101,0,40);for (off,val) in [(24,id),(28,67),(32,2),(36,2)] {put32(&mut two,off,val);}
        q.unchanged("critic-2D-collision",two.clone(),INVALID_RESOURCE);
        q.expect("critic-release-for-2D",id_command(0x102,0,id),OK);
        q.expect("critic-2D-owns-ID",two,OK);
        q.unchanged("critic-3D-collision",resource(id,2,2,2,3,2),INVALID_RESOURCE);
        q.expect("critic-2D-unref",id_command(0x102,0,id),OK);
        let old=q.state.borrow().control3d_snapshot().unwrap();
        eprintln!("CRITIC_SINK_BEFORE_RESET seed={seed} {:?}",q.recorder.borrow().events);
        q.mmio(0x70,0);assert_eq!(q.machine.run(1),RunOutcome::MaxInstrs);
        let reset=q.state.borrow().control3d_snapshot().unwrap();assert!(reset.epoch>old.epoch);assert!(reset.contexts.is_empty()&&reset.resources.is_empty());assert_eq!((reset.logical_bytes,reset.gpu_bytes,reset.backing_bytes),(0,0,0));
        q.next=0;q.configure();q.negotiate();
        q.expect("critic-reset-retains-selected",resource(id,2,1,2|(1<<18)|(1<<20),3,2),OK);
        q.expect("critic-final-release",id_command(0x102,0,id),OK);
        eprintln!("CRITIC_SINK_AFTER_RESET seed={seed} {:?}",q.recorder.borrow().events);
    }
}
