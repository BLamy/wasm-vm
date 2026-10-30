# Display, input, and audio

The host workbench exposes display and serial surfaces. Guest input passes through explicit keyboard, pointer, clipboard, and audio boundaries. Each boundary has a contract and recorded failure drills.

## Display and guest graphics

Read the display contract before choosing a present path. Desktop bring-up uses named images and a documented boot order. The [current graphics guide](./docs.html?page=graphics) describes Omarchy's qualified GPU warm checkpoint, explicit cold boot, software warm snapshot, and the admitted command, resource, state, shader, and draw boundaries. GPU context-loss recovery has a separate verification task.

{% hint style="info" %}
The marketing hero is a Three.js architecture illustration rendered directly by the browser. It is independent of guest VirGL support and is not evidence of a guest GPU feature.
{% endhint %}

## Application image and release scope

The application image contains native RISC-V **Chromium 153.0.8010.52**, **LibreOffice 26.8.0** and **Node 26.11.1 / npm 12.2.0** in an 860-package image. These are guest Linux applications, separate from the host browser running the emulator.

The [independent E5.5-T05c verdict](https://github.com/BLamy/wasm-vm/blob/dddae3bc2c15b1332dedcb208f3b7e6c6f852127/evidence/omarchy-applications-desktop/verifier/VERDICT.md) covers actual native Chromium browsing and trusted form input, normal sandboxed SVG decoding, Writer typing/save/close/reopen/edit/resave, Node/npm, and the qualified production compositor and scanout. It retains the original failed attempts and the explicitly authenticated missing-proof continuation; it does not claim that every application rasterizes through the GPU. Its exact source and evidence boundaries remain part of that verdict.

The [application catalogue](https://github.com/BLamy/wasm-vm/blob/dddae3bc2c15b1332dedcb208f3b7e6c6f852127/tools/image/omarchy-apps/catalog.json) accounts for 147 upstream Omarchy 4.0.2 entries: 32 were already present, 97 have native repository packages, five have portable alternatives, and 13 still require source-port work. Chromium and LibreOffice are two explicit additions beyond that list. The 13 unresolved ports are not established incompatibilities, and this is not a claim that all 147 applications are complete.

The [machine](./index.html#ide) starts Omarchy from matched warm factories for the application image (**Other machines → Omarchy desktop**; **Desktop settings → Desktop graphics** chooses GPU or Software). Accelerated mode restores RAM, disk, GPU resources and the guest clock together. Software mode restores its matching RAM and disk snapshot. Read [guest graphics](./docs.html?page=graphics) for warm, explicit cold and software modes.

Open applications from Omarchy's Apps menu. With keyboard capture enabled, the stock browser shortcut is **Super + Shift + B**, and **Super + Alt + Space** opens the Apps menu. Search for **LibreOffice Writer**, **Calc** or **Impress**. The Foot terminal also has `node` and `npm` available.

{% hint style="info" %}
Desktop restoration and application startup are separate measurements. Large guest applications can still take several minutes to start. Chromium's terms dialog and LibreOffice's welcome screens are their genuine first-run interfaces; complete them in the guest when they appear.
{% endhint %}

## Keyboard capture

In the terminal workspace, **Settings → Keyboard** shows whether keys go to the guest (**Send keys to the guest**) or stay with the browser. Physical `KeyboardEvent.code` transitions feed the virtio keyboard boundary, while xterm retains its serial text path. **Release held keys** repairs held guest input after focus changes.

`Ctrl+Alt+Backquote` is reserved for the host view switch. OS- or browser-owned shortcuts can be consumed before the page receives an event; the input contract describes passthrough and recovery behavior.

## Pointer and clipboard

**Settings → Pointer mode** switches between absolute and relative pointer input when a guest display exists. Absolute pointer coordinates use the element's CSS bounds. Relative mode uses Pointer Lock, which may require a gesture or be denied by iframe policy. The fallback returns to absolute mode and releases held buttons.

Clipboard operations are an explicit host permission boundary. Read the clipboard contract before forwarding text or promising synchronization.

## Audio

The browser audio-ring and virtio-snd contracts define the admitted format, control path, and bounded buffering behavior. Browser autoplay policy can require a gesture before audio starts: sound begins after your first click or key press on the page, and **Settings → Sound** shows whether it is on.

## Detailed references

- [Display modes](./docs.html?page=reference-docs-display)
- [Desktop bring-up](./docs.html?page=reference-docs-desktop-bringup)
- [Desktop boot order](./docs.html?page=reference-docs-desktop-boot-order)
- [Keyboard and pointer input](./docs.html?page=reference-docs-input)
- [Clipboard policy](./docs.html?page=reference-docs-clipboard)
- [Browser audio ring](./docs.html?page=reference-docs-audio)
- [virtio-snd control contract](./docs.html?page=reference-docs-virtio-snd)
- [Guest graphics: the admitted boundary](./docs.html?page=graphics)
- [Historical graphics decision](./docs.html?page=reference-docs-gpu-3d-decision)
