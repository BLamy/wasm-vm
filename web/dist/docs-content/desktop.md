# Display, input, and audio

The host workbench exposes display and serial surfaces. Guest input passes through explicit keyboard, pointer, clipboard, and audio boundaries. Each boundary has a contract and recorded failure drills.

## Display and guest graphics

Read the display contract before choosing a present path. Desktop bring-up uses named images and a documented boot order. The [current graphics guide](./docs.html?page=graphics) describes Omarchy's qualified GPU warm checkpoint, explicit cold boot, software warm snapshot, and the admitted command, resource, state, shader, and draw boundaries. GPU context-loss recovery has a separate verification task.

{% hint style="info" %}
The marketing hero is a Three.js architecture illustration rendered directly by the browser. It is independent of guest VirGL support and is not evidence of a guest GPU feature.
{% endhint %}

## Keyboard capture

The terminal displays whether input is captured for the guest or owned by the browser. Physical `KeyboardEvent.code` transitions feed the virtio keyboard boundary, while xterm retains its serial text path. **Release keys** repairs held guest input after focus changes.

`Ctrl+Alt+Backquote` is reserved for the host view switch. OS- or browser-owned shortcuts can be consumed before the page receives an event; the input contract describes passthrough and recovery behavior.

## Pointer and clipboard

Absolute pointer coordinates use the element's CSS bounds. Relative mode uses Pointer Lock, which may require a gesture or be denied by iframe policy. The fallback returns to absolute mode and releases held buttons.

Clipboard operations are an explicit host permission boundary. Read the clipboard contract before forwarding text or promising synchronization.

## Audio

The browser audio-ring and virtio-snd contracts define the admitted format, control path, and bounded buffering behavior. Browser autoplay policy can require a gesture before audio starts.

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
