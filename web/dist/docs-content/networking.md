---
kind: "Field guide"
source: "web/docs-source/guides/networking.md"
scope: "Authored explanation; verification belongs to the named evidence"
---

# Connect the guest deliberately

The CPU executes locally, while network traffic uses an explicit provider. Downloading boot artifacts and sending guest packets are separate operations; neither is covered by a blanket promise that nothing leaves the tab.

## Guest network path

The virtio-net device feeds the guest network stack. The user-mode slirp implementation supplies the Ethernet/IP boundary, DHCP, and DNS behavior described in its contract. Browser restrictions shape how TCP and UDP reach an external network.

## Provider choices

| Boundary | Documentation |
| --- | --- |
| Slirp user-mode network | [Addressing, DHCP, DNS, and packet handling](./docs.html?page=reference-docs-design-slirp) |
| WebSocket TCP/UDP proxy | [Exact frame protocol](./docs.html?page=reference-docs-design-ws-proxy-protocol) |
| Tailscale worker | [Worker message contract](./docs.html?page=reference-docs-design-tailscale-worker-protocol) |
| Provider deployment | [Identity, endpoints, and teardown](./docs.html?page=reference-docs-deployment-network-providers) |

## Know the trust boundary

A transport provider can observe the traffic carried through it under that protocol's encryption model. Choose endpoints and credentials deliberately. The guest's local execution does not make an external relay local, and an emulator-side packet stack does not remove browser network restrictions.

Use the provider's recorded acceptance criteria to establish supported traffic. A hostname resolving or a link appearing connected is not proof that an application completed an end-to-end exchange.

## Further reading

The [HTTP fast-path evaluation](./docs.html?page=reference-docs-design-http-fast-path-eval) records a dated design investigation. It is not a current claim that every guest syscall or HTTP request bypasses the emulated network stack.
