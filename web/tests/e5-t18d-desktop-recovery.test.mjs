import assert from "node:assert/strict";
import test from "node:test";
import { desktopRecoveryOptions, desktopRecoveryCommandAllowed } from "../src/input/desktop-recovery-policy.js";

test("normal boot has no diagnostic kernel authority, even on localhost", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "wasm-vm.pages.dev"]) {
    const options = desktopRecoveryOptions("?recoveryFault=config", host);
    assert.equal(options.test, false);
    assert.equal(options.configFault, false);
    assert.doesNotMatch(options.bootargs, /wasmvm\.desktop/);
  }
});

test("explicit local boot permits only the fixed config fault", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.deepEqual(desktopRecoveryOptions("?recoveryTest=1&recoveryFault=config", host), {
      test: true, configFault: true,
      bootargs: "root=/dev/vda rw console=ttyS0 earlycon=sbi wasmvm.desktop_test=1 wasmvm.desktop_fault=config",
    });
    assert.equal(desktopRecoveryOptions("?recoveryTest=1&recoveryFault=arbitrary", host).configFault, false);
  }
});

test("remote and lookalike hosts cannot opt in through query parameters", () => {
  for (const host of ["wasm-vm.pages.dev", "localhost.example", "127.0.0.1.example", "0.0.0.0", "::1", "evil-localhost"]) {
    const options = desktopRecoveryOptions("?recoveryTest=1&recoveryFault=config", host);
    assert.equal(options.test, false);
    assert.equal(options.configFault, false);
    assert.doesNotMatch(options.bootargs, /wasmvm\.desktop/);
  }
});

test("fixed verbs cannot smuggle arbitrary serial shell input", () => {
  for (const verb of ["status", "crash", "config-fail", "tty", "log"]) {
    assert.equal(desktopRecoveryCommandAllowed(true, verb), true);
    assert.equal(desktopRecoveryCommandAllowed(false, verb), false);
    assert.equal(desktopRecoveryCommandAllowed("true", verb), false);
  }
  for (const verb of ["status\nreboot", "crash;sh", "reboot", "", "STATUS", null]) {
    assert.equal(desktopRecoveryCommandAllowed(true, verb), false);
  }
});
