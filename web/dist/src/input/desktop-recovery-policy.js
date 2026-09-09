// Host-only fault enablement. The guest additionally requires its explicit kernel opt-in.
export function desktopRecoveryOptions(search, hostname) {
  const query = new URLSearchParams(search);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const test = local && query.get("recoveryTest") === "1";
  const configFault = test && query.get("recoveryFault") === "config";
  return { test, configFault, bootargs: "root=/dev/vda rw console=ttyS0 earlycon=sbi" +
    (test ? " wasmvm.desktop_test=1" : "") + (configFault ? " wasmvm.desktop_fault=config" : "") };
}

export function desktopRecoveryCommandAllowed(test, verb) {
  return test === true && ["status", "crash", "config-fail", "tty", "log"].includes(verb);
}
