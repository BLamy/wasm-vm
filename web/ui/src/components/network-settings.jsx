// Network provider settings as library controls over main.js's native fields.
//
// main.js reads #network-provider and the provider fields when a guest boots, persists the
// non-secret ones under its own localStorage key on `change`, and never persists the relay token
// or the Tailscale auth key. Each control here writes the native field and dispatches the same
// events, so that contract is unchanged. Login/logout press main.js's own buttons.
import { List, Switch, TextField, Label, Input, FieldDescription, Button } from "@brett_lamy/ui";
import { byId, pressNative, textOf, useDomSnapshot, useNativeValue } from "../bridge.js";
import { Picker } from "./primitives.jsx";

const PROVIDERS = [
  { id: "offline", label: "Offline" },
  { id: "websocket", label: "WebSocket relay" },
  { id: "tailscale", label: "Tailscale (public)" },
  { id: "headscale", label: "Headscale (self-hosted)" },
  { id: "relay", label: "Private wvrelay (advanced)" },
];

function BridgedField({ id, label, description, type = "text", placeholder }) {
  const [value, write] = useNativeValue(id);
  return (
    <List.Row>
      <TextField value={value} onChange={(next) => write(next)} className="wv-field">
        <Label>{label}</Label>
        <Input type={type} placeholder={placeholder} autoComplete="off" spellCheck={false} data-wv-bridge={id} />
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </TextField>
    </List.Row>
  );
}

function BridgedSwitch({ id, title, detail }) {
  const [checked, write] = useNativeValue(id, { checkbox: true });
  return <List.Row title={title} subtitle={detail} accessory={<Switch aria-label={title} checked={checked} onChange={(next) => write(next)} />} />;
}

function TailscaleStatus() {
  const state = JSON.parse(
    useDomSnapshot(
      () => byId("tailscale-status")?.parentElement,
      () => {
        const link = byId("tailscale-login-link");
        return JSON.stringify({ status: textOf(byId("tailscale-status")), login: link && !link.hidden ? link.href : null });
      },
    ),
  );
  return (
    <List.Row>
      <div className="wv-net-status">
        <p role="status" aria-live="polite" data-wv="tailscale-status">{state.status}</p>
        {state.login ? (
          <a className="wv-prose-link" href={state.login} target="_blank" rel="noopener noreferrer">Continue to Tailscale login</a>
        ) : null}
        <div className="wv-net-actions">
          <Button size="sm" onPress={() => pressNative("tailscale-login")}>Log in</Button>
          <Button size="sm" variant="destructive" onPress={() => pressNative("tailscale-logout")}>Log out and revoke</Button>
        </div>
      </div>
    </List.Row>
  );
}

export function NetworkSettings() {
  const [provider, writeProvider] = useNativeValue("network-provider");
  const help = useDomSnapshot(() => byId("network-help"), (el) => textOf(el));
  const tailnet = provider === "tailscale" || provider === "headscale";
  return (
    <List.Section title="Network" footer={`${help} Changes apply at the next boot.`}>
      <List.Row>
        <Picker label="Provider" options={PROVIDERS} value={provider || "offline"} onChange={(next) => writeProvider(next)} />
      </List.Row>
      {provider === "websocket" ? (
        <BridgedField id="network-websocket-url" label="WebSocket endpoint" type="url" placeholder="wss://relay.example/ws" />
      ) : null}
      {provider === "relay" ? (
        <>
          <BridgedField id="network-relay-url" label="wvrelay WebSocket URL" type="url" placeholder="wss://relay.example/ws" />
          <BridgedField
            id="network-relay-token"
            label="Relay token"
            type="password"
            description="Short-lived. Never saved or put in a URL."
          />
        </>
      ) : null}
      {provider === "headscale" ? (
        <BridgedField id="tailscale-control-url" label="Headscale control server" type="url" placeholder="https://headscale.example.com" />
      ) : null}
      {tailnet ? (
        <>
          <BridgedField id="tailscale-hostname" label="Browser node name" />
          <BridgedField id="tailscale-auth-key" label="One-time auth key" type="password" description="Optional. Never saved or logged." />
          <BridgedField id="tailscale-exit-node" label="Exit node ID" description="Optional stable node ID." />
          <BridgedSwitch id="tailscale-accept-dns" title="Use MagicDNS" />
          <TailscaleStatus />
        </>
      ) : null}
    </List.Section>
  );
}
