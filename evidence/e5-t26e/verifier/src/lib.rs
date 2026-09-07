#[cfg(test)]
mod tests {
    use wasm_vm_core::desktop_restore::{
        ComponentPreparation, DesktopRestoreBackend, DesktopRestoreCoordinator,
        DesktopRestoreEffects, DesktopRestoreError, DisplaySize, RestoreCallbackError,
        ViewportDisposition,
    };
    use wasm_vm_core::desktop_snapshot::{DesktopSnapshotBuilder, FORMAT_VERSION, section};

    fn snapshot(omit: Option<u16>) -> Vec<u8> {
        let mut builder = DesktopSnapshotBuilder::new(0x26e);
        for (tag, payload) in [
            (section::GPU, b"gpu".as_slice()),
            (section::INPUT, b"input".as_slice()),
            (section::SOUND, b"sound".as_slice()),
            (section::AGENT, b"agent".as_slice()),
        ] {
            if omit != Some(tag) {
                builder.section(tag, FORMAT_VERSION, payload).unwrap();
            }
        }
        builder.finish().unwrap()
    }

    #[derive(Debug)]
    struct Backend {
        actions: Vec<&'static str>,
        refuse_component: Option<u16>,
        refuse_agent: bool,
        refuse_viewport: bool,
        refuse_commit: bool,
        scanout: Option<DisplaySize>,
        full_repair: bool,
        publish_live: bool,
        reset_live_on_cold: bool,
        transient: bool,
        live_committed: bool,
        clear_count: u32,
        cold_count: u32,
    }

    impl Default for Backend {
        fn default() -> Self {
            Self {
                actions: Vec::new(),
                refuse_component: None,
                refuse_agent: false,
                refuse_viewport: false,
                refuse_commit: false,
                scanout: Some(DisplaySize::new(1280, 720)),
                full_repair: true,
                publish_live: true,
                reset_live_on_cold: true,
                transient: false,
                live_committed: false,
                clear_count: 0,
                cold_count: 0,
            }
        }
    }

    impl DesktopRestoreBackend for Backend {
        fn prepare_component(
            &mut self,
            tag: u16,
            _payload: &[u8],
        ) -> Result<ComponentPreparation, RestoreCallbackError> {
            self.actions.push(match tag {
                section::GPU => "gpu",
                section::INPUT => "input",
                section::SOUND => "sound",
                _ => "unexpected",
            });
            self.transient = true;
            if self.refuse_component == Some(tag) {
                return Err(RestoreCallbackError::new("forced_component_refusal"));
            }
            Ok(match tag {
                section::GPU => ComponentPreparation {
                    scanout: self.scanout,
                    ..ComponentPreparation::default()
                },
                section::INPUT => ComponentPreparation {
                    input_release_events: 7,
                    // Wrong-component metadata must not leak into the final report.
                    sound_xrun_events: 91,
                    ..ComponentPreparation::default()
                },
                section::SOUND => ComponentPreparation {
                    // Wrong-component metadata must not leak into the final report.
                    input_release_events: 92,
                    sound_xrun_events: 3,
                    ..ComponentPreparation::default()
                },
                _ => unreachable!(),
            })
        }

        fn prepare_agent_rehandshake(
            &mut self,
            _payload: &[u8],
        ) -> Result<(), RestoreCallbackError> {
            self.actions.push("agent");
            if self.refuse_agent {
                return Err(RestoreCallbackError::new("forced_agent_drop"));
            }
            Ok(())
        }

        fn prepare_viewport(
            &mut self,
            scanout: DisplaySize,
            host_viewport: DisplaySize,
            disposition: ViewportDisposition,
        ) -> Result<(), RestoreCallbackError> {
            assert_eq!(scanout, self.scanout.unwrap());
            assert_ne!(host_viewport.width, 0);
            assert_ne!(host_viewport.height, 0);
            self.actions.push(match disposition {
                ViewportDisposition::Native => "viewport-native",
                ViewportDisposition::Letterbox => "viewport-letterbox",
            });
            if self.refuse_viewport {
                return Err(RestoreCallbackError::new("forced_viewport_refusal"));
            }
            Ok(())
        }

        fn commit(&mut self) -> Result<DesktopRestoreEffects, RestoreCallbackError> {
            self.actions.push("commit");
            if self.publish_live {
                self.live_committed = true;
            }
            self.transient = false;
            if self.refuse_commit {
                return Err(RestoreCallbackError::new("forced_commit_refusal"));
            }
            Ok(DesktopRestoreEffects {
                full_repair_frame: self.full_repair,
            })
        }

        fn clear_transient_reconciliation(&mut self) {
            self.actions.push("clear");
            self.transient = false;
            self.clear_count += 1;
        }

        fn cold_boot_fallback(&mut self) {
            self.actions.push("cold");
            self.cold_count += 1;
            if self.reset_live_on_cold {
                self.live_committed = false;
            }
        }
    }

    #[test]
    fn complete_branch_matrix_and_cross_tag_metadata() {
        for tag in [section::GPU, section::INPUT, section::SOUND] {
            let mut coordinator = DesktopRestoreCoordinator::new();
            let mut backend = Backend {
                refuse_component: Some(tag),
                ..Backend::default()
            };
            let error = coordinator
                .restore(&snapshot(None), DisplaySize::new(1280, 720), &mut backend)
                .unwrap_err();
            assert!(matches!(
                error,
                DesktopRestoreError::ComponentRefused { tag: found, .. } if found == tag
            ));
            assert_eq!(backend.clear_count, 1);
            assert_eq!(backend.cold_count, 1);
            assert!(!backend.transient);
            assert!(!backend.actions.contains(&"commit"));
        }

        for missing in [section::GPU, section::INPUT, section::SOUND, section::AGENT] {
            let mut coordinator = DesktopRestoreCoordinator::new();
            let mut backend = Backend::default();
            let error = coordinator
                .restore(
                    &snapshot(Some(missing)),
                    DisplaySize::new(1280, 720),
                    &mut backend,
                )
                .unwrap_err();
            assert_eq!(error, DesktopRestoreError::MissingSection { tag: missing });
            assert_eq!(backend.actions, ["clear", "cold"]);
        }

        let mut coordinator = DesktopRestoreCoordinator::new();
        let mut backend = Backend::default();
        let native = coordinator
            .restore(&snapshot(None), DisplaySize::new(1280, 720), &mut backend)
            .unwrap();
        assert_eq!(native.viewport, ViewportDisposition::Native);
        assert_eq!(native.input_release_events, 7);
        assert_eq!(native.sound_xrun_events, 3);
        assert_eq!(
            backend.actions,
            [
                "gpu",
                "input",
                "sound",
                "agent",
                "viewport-native",
                "commit"
            ]
        );

        let mut backend = Backend::default();
        let letterbox = coordinator
            .restore(&snapshot(None), DisplaySize::new(1024, 768), &mut backend)
            .unwrap();
        assert_eq!(letterbox.scanout, DisplaySize::new(1280, 720));
        assert_eq!(letterbox.viewport, ViewportDisposition::Letterbox);
        assert_eq!(backend.scanout, Some(DisplaySize::new(1280, 720)));
    }

    #[test]
    fn malformed_forward_and_all_invalid_sizes_fail_before_later_callbacks() {
        let mut malformed = snapshot(None);
        *malformed.last_mut().unwrap() ^= 1;
        let mut forward = snapshot(None);
        forward[30..32].copy_from_slice(&(FORMAT_VERSION + 1).to_le_bytes());

        for blob in [malformed, forward] {
            let mut coordinator = DesktopRestoreCoordinator::new();
            let mut backend = Backend::default();
            let error = coordinator
                .restore(&blob, DisplaySize::new(1280, 720), &mut backend)
                .unwrap_err();
            assert!(matches!(error, DesktopRestoreError::Snapshot(_)));
            assert_eq!(backend.actions, ["clear", "cold"]);
        }

        for host in [
            DisplaySize::new(0, 720),
            DisplaySize::new(1280, 0),
            DisplaySize::new(4096, 720),
            DisplaySize::new(1280, 4096),
        ] {
            let mut coordinator = DesktopRestoreCoordinator::new();
            let mut backend = Backend::default();
            let error = coordinator
                .restore(&snapshot(None), host, &mut backend)
                .unwrap_err();
            assert!(matches!(
                error,
                DesktopRestoreError::InvalidDisplaySize {
                    field: "host_viewport",
                    ..
                }
            ));
            assert_eq!(backend.actions, ["clear", "cold"]);
        }

        for scanout in [
            None,
            Some(DisplaySize::new(0, 720)),
            Some(DisplaySize::new(1280, 0)),
            Some(DisplaySize::new(4096, 720)),
            Some(DisplaySize::new(1280, 4096)),
        ] {
            let mut coordinator = DesktopRestoreCoordinator::new();
            let mut backend = Backend {
                scanout,
                ..Backend::default()
            };
            let error = coordinator
                .restore(&snapshot(None), DisplaySize::new(1280, 720), &mut backend)
                .unwrap_err();
            assert!(matches!(
                error,
                DesktopRestoreError::MissingScanout
                    | DesktopRestoreError::InvalidDisplaySize {
                        field: "guest_scanout",
                        ..
                    }
            ));
            assert_eq!(backend.actions, ["gpu", "clear", "cold"]);
        }
    }

    #[test]
    fn refusal_cleanup_then_bounded_retry_is_clean() {
        let mut coordinator = DesktopRestoreCoordinator::new();
        let mut backend = Backend {
            refuse_agent: true,
            ..Backend::default()
        };
        coordinator
            .restore(&snapshot(None), DisplaySize::new(1280, 720), &mut backend)
            .unwrap_err();
        assert!(!backend.transient);
        assert!(!backend.live_committed);
        assert_eq!(backend.clear_count, 1);
        assert_eq!(backend.cold_count, 1);

        backend.refuse_agent = false;
        let report = coordinator
            .restore(&snapshot(None), DisplaySize::new(1280, 720), &mut backend)
            .unwrap();
        assert!(report.full_repair_frame);
        assert!(backend.live_committed);
        assert!(!backend.transient);
        assert_eq!(coordinator.restore_epoch(), 2);
    }

    #[test]
    fn viewport_commit_and_missing_repair_refusals_reach_fallback() {
        for mut backend in [
            Backend {
                refuse_viewport: true,
                ..Backend::default()
            },
            Backend {
                refuse_commit: true,
                ..Backend::default()
            },
            Backend {
                full_repair: false,
                ..Backend::default()
            },
        ] {
            let mut coordinator = DesktopRestoreCoordinator::new();
            coordinator
                .restore(&snapshot(None), DisplaySize::new(1280, 720), &mut backend)
                .unwrap_err();
            assert_eq!(backend.clear_count, 1);
            assert_eq!(backend.cold_count, 1);
            assert!(!backend.transient);
            assert!(!backend.live_committed);
        }
    }

    #[test]
    fn contract_allows_false_success_attestation() {
        let mut coordinator = DesktopRestoreCoordinator::new();
        let mut backend = Backend {
            publish_live: false,
            full_repair: true,
            ..Backend::default()
        };
        let report = coordinator
            .restore(&snapshot(None), DisplaySize::new(1280, 720), &mut backend)
            .unwrap();
        assert!(report.full_repair_frame);
        assert!(
            !backend.live_committed,
            "callback attestation was not tied to publication"
        );
        assert_eq!(backend.cold_count, 0);
    }

    #[test]
    fn contract_allows_half_live_state_after_missing_repair() {
        let mut coordinator = DesktopRestoreCoordinator::new();
        let mut backend = Backend {
            full_repair: false,
            reset_live_on_cold: false,
            ..Backend::default()
        };
        let error = coordinator
            .restore(&snapshot(None), DisplaySize::new(1280, 720), &mut backend)
            .unwrap_err();
        assert_eq!(error.code(), "commit_refused");
        assert!(
            backend.live_committed,
            "commit published before repair refusal"
        );
        assert_eq!(backend.actions.last(), Some(&"cold"));
    }
}
