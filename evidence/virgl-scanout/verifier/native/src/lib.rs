// Worker acceptance replay, independently instrumented for changed-source coverage.
#[cfg(test)]
#[path = "../../../../../crates/core/tests/virtio_gpu_scanout3d.rs"]
mod worker_scanout_acceptance;
#[cfg(test)]
#[path = "../../../../../crates/core/tests/virtio_gpu_submit3d.rs"]
mod prior_submit_acceptance;

#[cfg(test)]
mod independent {
    use wasm_vm_core::dev::virtio::gpu::{Rect,control3d::{Control3dError as E,Control3dId},protocol::CtrlHeader,scanout3d::*,submit3d::*};
    #[test]
    fn legacy_sink_fails_closed_for_both_new_display_methods() {
        struct Legacy;
        impl Submit3dSink for Legacy {
            fn begin_job(&mut self,_:&Submit3dRequest)->Result<(),E>{Ok(())}
            fn cancel_job(&mut self,_:Submit3dKey)->Result<(),E>{Ok(())}
        }
        let binding=Scanout3dBinding{generation:1,rect:Rect{x:0,y:0,width:0,height:0},target:Scanout3dTarget::Disabled};
        let mut sink=Legacy;
        assert_eq!(sink.bind_scanout(&Scanout3dEvent{epoch:1,binding}),Err(E::Unspecified));
        assert_eq!(sink.begin_scanout(&Scanout3dRequest{key:Submit3dKey{epoch:1,sequence:1},header:CtrlHeader{ty:0x104,flags:0,fence_id:0,ctx_id:0,ring_idx:0,padding:[0;3]},binding}),Err(E::Unspecified));
        println!("INDEPENDENT_LEGACY_DISPLAY_DEFAULTS unspecified/unspecified");
    }
    #[test]
    fn global_and_context_pending_digests_encode_distinct_authority() {
        for context in [None,Some(Control3dId{id:0x12345678,generation:0xfedcba9876543210})] {
            let s=Submit3dSnapshot{next_sequence:9,counters:Submit3dCounters::default(),pending:Some(PendingSubmit3dSnapshot{key:Submit3dKey{epoch:3,sequence:8},context,command_type:0x104,fence_id:u64::MAX,flags:1,byte_length:24,backing_entries:0,last_exchange:0,completion_ready:false})};
            let bytes=s.canonical_bytes();assert_eq!(&bytes[..8],b"WV3DSUB2");assert_eq!(bytes.len(),163);
            assert_eq!(&bytes[113..121],&context.map_or(0,|c|c.generation).to_le_bytes());
            assert_eq!(bytes[145],u8::from(context.is_some()));assert_eq!(&bytes[146..150],&context.map_or(0,|c|c.id).to_le_bytes());assert_eq!(&bytes[121..129],&[255;8]);
            println!("INDEPENDENT_PENDING_AUTHORITY context={context:?} bytes={bytes:?}");
        }
    }
}
