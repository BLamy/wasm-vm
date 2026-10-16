# The container boundary

wasm-vm includes an OCI image pipeline and a guest-side bundle runner. Importing an image, auditing kernel features, and proving a booted container workload are separate acceptance steps.

## Image pipeline

The importer pulls and digest-verifies image content, unpacks a bundle, resolves its entrypoint inside the rootfs, and checks architecture purity. The recorded nine-image matrix covers Alpine, busybox, nginx, httpd, caddy, haproxy, redis, memcached, and postgres.

A matrix PASS means the static bundle checks passed. It does not mean every image booted and served a request inside the emulator. The matrix preserves its survey date and deferred boot leg.

## Guest runner

`tools/guest/wvrun.sh` consumes a bundle with `rootfs/`, `run.json`, and flat config files. The documented runner overlays a read-only lower rootfs with a tmpfs upper, creates namespaces, switches roots, applies the image environment and working directory, and executes the image command.

{% hint style="warning" %}
The source container audit explicitly separates enabled kernel seccomp configuration from runtime filter installation. Do not present a config flag or static OCI PASS as proof of a complete container isolation profile.
{% endhint %}

## Check the exact task and evidence

Use the kernel capability matrix and booted acceptance commands to establish what ran. Historical docs can describe a deferred milestone; the current task ledger and evidence determine the status of that exact task. This reader does not turn a historical plan into a newly verified capstone.

## Detailed references

- [Kernel capability audit and runner contract](./docs.html?page=reference-docs-containers)
- [Nine-image static matrix and adversarial self-test](./docs.html?page=reference-docs-container-matrix)
- [Guest rootfs](./docs.html?page=reference-docs-rootfs)
- [Pinned container task ledger](https://github.com/BLamy/wasm-vm/tree/2691b24e6c00478f8d69f81180b6827761de246a/tasks/epic-3.5-oci-workloads)
