-- Offline, package-owned browser desktop; no architecture-specific installers.
hl.on("hyprland.start", function()
  hl.exec_cmd("systemctl --user import-environment $(env | cut -d'=' -f 1)")
  hl.exec_cmd("dbus-update-activation-environment --systemd --all")
  hl.exec_cmd("systemctl --user start wayland-wm-app-daemon.service")
  hl.exec_cmd("omarchy-launch-shell")
  hl.exec_cmd("/usr/local/bin/omarchy-demo-session")
end)
