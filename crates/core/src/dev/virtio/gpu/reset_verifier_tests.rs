// E5-T22e independent verifier attack, included only inside the existing test module.
// Real MMIO queue configuration: old and new rings deliberately use different RAM.
#[test]
fn display_reset_verifier_reconfigured_rings_reject_stale_resources() {
    fn configure(slot: &mut VirtioMmio, index: u32, base: u64) -> QueueState {
        write32(slot, QUEUE_SEL, index);
        write32(slot, 0x038, 8);
        for (low, addr) in [
            (0x080, base),
            (0x090, base + 0x1000),
            (0x0a0, base + 0x2000),
        ] {
            write32(slot, low, addr as u32);
            write32(slot, low + 4, (addr >> 32) as u32);
        }
        write32(slot, 0x044, 1);
        *slot.queue(index as usize)
    }

    fn enqueue(bus: &mut SystemBus, base: u64, index: u16, request: &[u8]) {
        write_bytes(bus, base + 0x3000, request);
        write_desc_at(bus, base, 0, base + 0x3000, request.len() as u32, 1, 1);
        write_desc_at(bus, base, 1, base + 0x4000, EDID_RESPONSE_SIZE as u32, 2, 0);
        bus.store16(base + 0x1000 + 4 + u64::from((index - 1) % 8) * 2, 0)
            .unwrap();
        bus.store16(base + 0x1002, index).unwrap();
    }

    for latched in [false, true] {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let sink = TestSink::new();
        let (gpu, state) = VirtioGpu::new_with_sink_state(Box::new(sink.clone()));
        let (_, untouched) = VirtioGpu::new_with_state();
        let default_edid = untouched.borrow().edid();
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(gpu))));
        negotiate_gpu_edid(&mut slot.borrow_mut());
        let old_control = configure(&mut slot.borrow_mut(), 0, DESC);
        let old_cursor = configure(&mut slot.borrow_mut(), 1, CURSOR_DESC);
        let mut control_cache = Some(Virtqueue::new(&old_control, 256).unwrap());
        let mut cursor_cache = Some(Virtqueue::new(&old_cursor, 256).unwrap());
        enqueue(&mut bus, DESC, 1, &edid_request(0));
        enqueue(
            &mut bus,
            CURSOR_DESC,
            1,
            &cursor_update_request(0, 9, 11, 43, 0, 0),
        );
        bus.store32(USED, 0x1234_5678).unwrap();
        bus.store32(CURSOR_USED, 0x9abc_def0).unwrap();
        bus.store32(RESPONSE, 0x5566_7788).unwrap();
        bus.store32(CURSOR_RESPONSE, 0x1122_3344).unwrap();
        {
            let mut s = state.borrow_mut();
            s.set_display(1373, 907);
            s.resources
                .create(43, protocol::FORMAT_B8G8R8A8_UNORM, 7, 5)
                .unwrap();
            s.resources
                .attach_backing(43, alloc::vec![(DRAM_BASE + 0x60000, 140)])
                .unwrap();
            s.scanout_resource = Some(43);
            s.cursor_states[0] = CursorState {
                resource_id: 43,
                ..CursorState::hidden(0)
            };
        }
        let expected_edid = state.borrow().edid();
        write32(&mut slot.borrow_mut(), 0x050, 0);
        write32(&mut slot.borrow_mut(), 0x050, 1);
        if latched {
            assert!(slot.borrow_mut().sync_backend_config_irq());
            slot.borrow_mut().raise_used_irq();
            assert_eq!(read32(&mut slot.borrow_mut(), 0x060), 3);
        }
        for _ in 0..2 {
            write32(&mut slot.borrow_mut(), STATUS, 0);
            assert_eq!(read32(&mut slot.borrow_mut(), 0x060), 0);
            assert!(!slot.borrow().driver_has_feature(VIRTIO_GPU_F_EDID));
            let s = state.borrow();
            assert_eq!(s.display_size(), (1373, 907));
            assert_eq!(s.display_refresh_hz(), 60);
            assert_eq!(s.edid(), expected_edid);
            assert!(s.resources.get(43).is_none());
            assert_eq!(s.resources.accounted_bytes(), 0);
            assert_eq!(s.scanout_resource, None);
            assert_eq!(s.cursor_state(0), Some(CursorState::hidden(0)));
            assert!(!s.kicked && !s.cursor_kicked && !s.config_irq_pending);
            assert_eq!(s.events_read, 0);
        }
        assert_eq!(sink.cursor_records(), alloc::vec![CursorState::hidden(0)]);
        // Rearm before the reset invalidation is consumed, then install brand-new queues.
        state.borrow_mut().set_display(1373, 907);
        assert!(slot.borrow_mut().sync_backend_config_irq());
        assert!(!slot.borrow_mut().sync_backend_config_irq());
        assert_eq!(read32(&mut slot.borrow_mut(), 0x060), INT_CONFIG_CHANGE);
        write32(&mut slot.borrow_mut(), 0x064, INT_CONFIG_CHANGE);
        let new_control = DRAM_BASE + 0x20000;
        let new_cursor = DRAM_BASE + 0x30000;
        configure(&mut slot.borrow_mut(), 0, new_control);
        configure(&mut slot.borrow_mut(), 1, new_cursor);
        enqueue(&mut bus, new_control, 1, &edid_request(0));
        enqueue(
            &mut bus,
            new_cursor,
            1,
            &cursor_update_request(0, 9, 11, 43, 0, 0),
        );
        write32(&mut slot.borrow_mut(), 0x050, 0);
        write32(&mut slot.borrow_mut(), 0x050, 1);
        service_with_cursor(
            &slot,
            &mut control_cache,
            &mut cursor_cache,
            &state,
            &mut bus,
        );
        assert!(!state.borrow().reset_pending);
        assert_eq!(bus.load16(new_control + 0x2002).unwrap(), 1);
        assert_eq!(bus.load16(new_cursor + 0x2002).unwrap(), 1);
        assert_eq!(
            response_type(&mut bus, new_control + 0x4000),
            RESP_ERR_UNSPEC
        );
        assert_eq!(
            response_type(&mut bus, new_cursor + 0x4000),
            protocol::RESP_ERR_INVALID_RESOURCE_ID
        );
        negotiate_gpu_edid(&mut slot.borrow_mut());
        enqueue(&mut bus, new_control, 2, &edid_request(0));
        write32(&mut slot.borrow_mut(), 0x050, 0);
        service_with_cursor(
            &slot,
            &mut control_cache,
            &mut cursor_cache,
            &state,
            &mut bus,
        );
        assert_eq!(response_type(&mut bus, new_control + 0x4000), RESP_OK_EDID);
        let mut actual_edid = [0u8; 128];
        for (i, byte) in actual_edid.iter_mut().enumerate() {
            *byte = bus
                .load8(new_control + 0x4000 + CTRL_HDR_SIZE as u64 + 8 + i as u64)
                .unwrap();
        }
        assert_eq!(actual_edid, expected_edid);
        assert_eq!(
            u32::from(actual_edid[56]) | (u32::from(actual_edid[58] & 0xf0) << 4),
            1373
        );
        assert_eq!(
            u32::from(actual_edid[59]) | (u32::from(actual_edid[61] & 0xf0) << 4),
            907
        );
        assert_eq!(
            actual_edid.iter().fold(0u8, |sum, b| sum.wrapping_add(*b)),
            0
        );
        let rect = Rect {
            x: 0,
            y: 0,
            width: 7,
            height: 5,
        };
        enqueue(&mut bus, new_control, 3, &scanout_request(43, 0, rect));
        write32(&mut slot.borrow_mut(), 0x050, 0);
        service_with_cursor(
            &slot,
            &mut control_cache,
            &mut cursor_cache,
            &state,
            &mut bus,
        );
        assert_eq!(
            response_type(&mut bus, new_control + 0x4000),
            protocol::RESP_ERR_INVALID_RESOURCE_ID
        );
        // Reusing the numeric id is legal only after a new allocation.
        let create = protocol::ResourceCreate2d {
            header: CtrlHeader {
                ty: protocol::CMD_RESOURCE_CREATE_2D,
                ..CtrlHeader::default()
            },
            resource_id: 43,
            format: protocol::FORMAT_B8G8R8A8_UNORM,
            width: 7,
            height: 5,
        }
        .to_bytes();
        enqueue(&mut bus, new_control, 4, &create);
        write32(&mut slot.borrow_mut(), 0x050, 0);
        service_with_cursor(
            &slot,
            &mut control_cache,
            &mut cursor_cache,
            &state,
            &mut bus,
        );
        assert_eq!(
            response_type(&mut bus, new_control + 0x4000),
            protocol::RESP_OK_NODATA
        );
        enqueue(&mut bus, new_control, 5, &scanout_request(43, 0, rect));
        enqueue(
            &mut bus,
            new_cursor,
            2,
            &cursor_update_request(0, 19, 23, 43, 0, 0),
        );
        write32(&mut slot.borrow_mut(), 0x050, 0);
        write32(&mut slot.borrow_mut(), 0x050, 1);
        service_with_cursor(
            &slot,
            &mut control_cache,
            &mut cursor_cache,
            &state,
            &mut bus,
        );
        assert_eq!(
            response_type(&mut bus, new_control + 0x4000),
            protocol::RESP_OK_NODATA
        );
        assert_eq!(
            response_type(&mut bus, new_cursor + 0x4000),
            protocol::RESP_OK_NODATA
        );
        assert_eq!(bus.load16(new_control + 0x2002).unwrap(), 5);
        assert_eq!(bus.load16(new_cursor + 0x2002).unwrap(), 2);
        assert_eq!(state.borrow().scanout_resource, Some(43));
        assert_eq!(state.borrow().cursor_state(0).unwrap().resource_id, 43);
        assert_eq!(bus.load32(USED).unwrap(), 0x1234_5678);
        assert_eq!(bus.load32(CURSOR_USED).unwrap(), 0x9abc_def0);
        assert_eq!(bus.load32(RESPONSE).unwrap(), 0x5566_7788);
        assert_eq!(bus.load32(CURSOR_RESPONSE).unwrap(), 0x1122_3344);
        let (_, later) = VirtioGpu::new_with_state();
        for fresh in [untouched, later] {
            let s = fresh.borrow();
            assert_eq!(s.display_size(), (1280, 800));
            assert_eq!(s.display_refresh_hz(), 60);
            assert_eq!(s.edid(), default_edid);
            assert_eq!(s.events_read, 0);
            assert!(s.resources.is_empty());
        }
        std::println!(
            "E5-T22e verifier latched={latched}: double reset retained 1373x907/60/128 EDID bytes; new rings completed 5 control + 2 cursor; stale id rejected then recreated; old rings/responses unchanged; fresh devices isolated"
        );
    }
}
