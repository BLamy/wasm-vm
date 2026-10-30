import { Button, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogClose, List } from "@brett_lamy/ui";
import { DIAGNOSTIC_ROUTES } from "../routes.js";
import { LinkRow } from "./primitives.jsx";

const here = () => (typeof location === "undefined" ? "" : location.pathname.split("/").pop() || "index.html");

// The diagnostic pages as link rows (see LinkRow for why the anchor is the row's live content).
export function RouteList({ groups = DIAGNOSTIC_ROUTES }) {
  const current = here();
  return (
    <List inset>
      {groups.map((group) => (
        <List.Section key={group.title} title={group.title}>
          {group.routes.map((route) => (
            <LinkRow key={route.href} href={route.href} title={route.label} detail={route.detail} current={route.href.replace(/^\.\//, "") === current} />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

// Dialog listing the focused diagnostic pages. Keeps them one step away instead of in the header.
export function RouteIndexDialog({ label = "Diagnostics", variant = "ghost", size = "sm", className }) {
  return (
    <DialogTrigger>
      <Button variant={variant} size={size} className={className} data-wv="route-index-trigger">
        {label}
      </Button>
      <DialogContent size="lg" aria-label="Diagnostic pages">
        <DialogHeader>
          <DialogTitle>Diagnostic pages</DialogTitle>
          <DialogDescription>Focused pages that exercise one part of the machine at a time.</DialogDescription>
        </DialogHeader>
        <DialogClose />
        <DialogBody>
          <RouteList />
        </DialogBody>
      </DialogContent>
    </DialogTrigger>
  );
}
