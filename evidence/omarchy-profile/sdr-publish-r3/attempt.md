# SDR candidate publication preflight — 2026-09-10

The command below ran at `2eca1b1d1be54895cf1d70a62580b2f247bd695a`:

```sh
node tools/publish-omarchy-chunks.mjs \
  target/omarchy-profile-chunks-sdr-r3-256k/manifest.json \
  --publish --receipt-dir evidence/omarchy-profile/sdr-publish-r3
```

The public read-only preflight failed on a 20-second GET timeout. It did not
finish preflight, so no candidate chunks or manifest were uploaded. The failed
receipt binds the exact image, manifest, publisher script, and Git head.

After the failure, other in-flight pool consumers incorrectly continued
assigning reads. The coordinator confirmed the owned publisher PID 76044 and
terminated it with SIGTERM; exit 143 is intentional cleanup, not success.

The incremental fix retries transient GET failures up to three times, keeps
integrity mismatches and forbidden statuses fatal, and drains in-flight work
without assigning more after a fatal error. Public reads use concurrency 16;
uploads remain limited to four. The mutable production manifest is untouched.

Validation: `node --test tools/publish-omarchy-chunks.test.mjs` — 20 passed,
zero failed, including the real localhost handoff tests. Publisher SHA-256
`49e7b3c7bb64ee6be5bd205ac782caa5364ec85588bc28954a04c5e0bc5d5131`;
test SHA-256 `6d9d792e925547d9528fd1e8c234bae9eaf146e1bcaefc90005bcc284d4c7c48`.
Daybreak's independent incremental safety audit is recorded in
`../desktop-fix-critic.md`. This is not a desktop acceptance or deployment claim.
