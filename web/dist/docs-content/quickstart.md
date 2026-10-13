# Boot your first guest

Open the [guest launcher](./app.html#ide) and choose an operating system to run the machine. The demo contains the guest console and display. The [roadmap](./roadmap.html) lives on the main site, and all guides and references are in this documentation library.

## Choose a boot path

{% tabs title="Choose the environment" %}
{% tab title="Public demo" %}
The default public manifest supplies the Linux kernel, an initramfs, and a compressed busybox boot snapshot. The loader fetches artifacts and checks their SHA-256 digests. Use the demo's console to inspect the resulting guest.

The full Alpine disk workflow needs its own disk or chunk manifest. A shell in an initramfs is a different environment from an Alpine root filesystem with packages installed.

The checked-in [artifact manifest](./artifacts.json) names exact URLs, sizes, and SHA-256 digests. A compatible compressed boot snapshot can shorten startup; a missing or incompatible snapshot falls back to a cold boot. Read the manifest rather than an old page's copied artifact-size table.
{% endtab %}
{% tab title="Local build" %}
Install the Rust target, wasm-pack, and Node/npm prerequisites used by the repository, then build and serve the browser tree:

```sh title="Build the browser demo"
make web-build
make web-serve
```

`make web-build` builds the generated wasm module, installs pinned browser packages, builds the Docstream reader, and copies the guest ELF fixtures. `make web-serve` serves `web/` on port 8080. In the source layout, `/` is the machine and `/landing.html` is the marketing page. The deployable layout moves the machine to `/app.html`.

For large development images, use `bash tools/serve-dev.sh` and the relevant image build runbook.
{% endtab %}
{% endtabs %}

## What to expect

{% stepper %}
{% step %}
Open the demo and choose the required boot mode or image. Artifact sizes and progress come from the manifest and loader.
{% endstep %}
{% step %}
Allow the loader to finish fetching and verifying the image. A loaded frame alone is not proof that Linux reached a prompt.
{% endstep %}
{% step %}
Use the guest console after it is ready. The selected image determines the available userland and credentials. The Alpine capstone documented in the rootfs guide uses root with an empty password; do not apply that assumption to a different image.
{% endstep %}
{% step %}
Choose persistence explicitly for a chunked disk if you want an IndexedDB overlay. Read the storage boundary before treating reload as a save operation.
{% endstep %}
{% endstepper %}

## Browser requirements

Serve over HTTP or HTTPS. WebAssembly streaming and ES-module MIME rules do not work reliably through `file://`. Shared-memory worker/JIT paths require cross-origin isolation; the loader retains a single-threaded path when that boundary is unavailable. Pointer Lock and audio may require a user gesture.

{% expandable title="If the guest does not reach a prompt" %}
Use the [boot debugging playbook](./docs.html?page=reference-docs-boot-debugging), [desktop bring-up runbook](./docs.html?page=reference-docs-desktop-bringup), and the named artifact manifest. Check the reported error, bytes fetched, digest, and chosen image before changing the guest.
{% endexpandable %}

## Source and detailed procedures

- [Browser build and serving](./docs.html?page=reference-web-readme)
- [Alpine root filesystem](./docs.html?page=reference-docs-rootfs)
- [Guest kernel](./docs.html?page=reference-docs-kernel)
- [Image artifacts](./docs.html?page=reference-docs-images)
