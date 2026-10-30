import { useState } from "react";
import { Button, buttonVariants, Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetClose, List } from "@brett_lamy/ui";
import { PRIMARY_ROUTES, SOURCE_URL } from "../routes.js";
import { RouteIndexDialog, RouteList } from "./route-index.jsx";
import { LinkRow } from "./primitives.jsx";

export function Brand({ href = PRIMARY_ROUTES[0].href }) {
  return (
    <a className="wv-brand" href={href} aria-label="wasm-vm home">
      wasm-vm<span className="wv-brand-mark" aria-hidden="true">/</span>
    </a>
  );
}

// The current app entry stays in-document: "/", "/index.html?…" and "/app.html" are all the same
// running page, and following "./index.html#ide" would reload it (dropping the query, the guest
// and any session state). Every other route is an ordinary navigation.
function routeHref(route, current) {
  return route.id === "app" && current === "app" ? "#ide" : route.href;
}

// From the running app, reading pages (docs, case studies, the roadmap) open in a new tab so
// following one never ends the guest. Everywhere else they are ordinary same-tab links.
const NEW_TAB_FROM_APP = new Set(["docs", "case-studies", "roadmap"]);
function routeTarget(route, current) {
  return current === "app" && NEW_TAB_FROM_APP.has(route.id) ? { target: "_blank", rel: "noopener" } : {};
}

// `data-tab="ide"` and the `tab` class are kept on the app link: the app shell's tests and
// tabs.js-era bookmarks address the demo entry that way.
function navLinkProps(route, current) {
  const isCurrent = route.id === current;
  const legacy = route.id === "app" ? { "data-tab": "ide" } : {};
  const target = routeTarget(route, current);
  return {
    ...target,
    "aria-label": target.target ? `${route.label} (opens in a new tab)` : undefined,
    href: routeHref(route, current),
    "aria-current": isCurrent ? "page" : undefined,
    className: `wv-nav-link${route.id === "app" ? " tab" : ""}${isCurrent && route.id === "app" ? " active" : ""}`,
    ...legacy,
  };
}

function MobileMenu({ current, showDiagnostics }) {
  // Controlled so an in-document link (the current app's #ide) can dismiss the sheet; react-aria
  // then returns focus to the Menu button. Links to other pages simply navigate.
  const [open, setOpen] = useState(false);
  const closeIfInDocument = (event) => {
    if (event.currentTarget.getAttribute("href").startsWith("#")) setOpen(false);
  };
  return (
    <Sheet isOpen={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" className="wv-nav-menu" aria-label="Open menu">
        Menu
      </Button>
      <SheetContent side="right" grabber={false} aria-label="Site menu">
        <SheetHeader>
          <SheetTitle>wasm-vm</SheetTitle>
        </SheetHeader>
        <SheetClose />
        <SheetBody>
          <List inset>
            <List.Section>
              {PRIMARY_ROUTES.map((route) => (
                <LinkRow
                  key={route.id}
                  href={routeHref(route, current)}
                  title={route.label}
                  detail={routeTarget(route, current).target ? "Opens in a new tab" : undefined}
                  current={route.id === current}
                  onNavigate={closeIfInDocument}
                  {...routeTarget(route, current)}
                />
              ))}
              <LinkRow href={SOURCE_URL} title="Source on GitHub" rel="noopener" />
            </List.Section>
          </List>
          {showDiagnostics ? <RouteList /> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

// Shared header navigation for every surface. `current` is one of the PRIMARY_ROUTES ids.
export function SiteNav({ current, showDiagnostics = false }) {
  const links = PRIMARY_ROUTES.filter((route) => !route.primary || route.id === current);
  const cta = PRIMARY_ROUTES.find((route) => route.primary);
  return (
    <nav className="wv-nav" aria-label="Primary navigation">
      <Brand />
      <ul className="wv-nav-links">
        {links.map((route) => (
          <li key={route.id}>
            <a {...navLinkProps(route, current)}>{route.id === "app" ? "Machine" : route.label}</a>
          </li>
        ))}
      </ul>
      <div className="wv-nav-end">
        {showDiagnostics ? <RouteIndexDialog className="wv-nav-desktop" /> : null}
        {current !== cta.id ? (
          <a className={`${buttonVariants({ size: "sm" })} wv-nav-desktop`} href={cta.href}>
            {cta.label}
          </a>
        ) : null}
        <MobileMenu current={current} showDiagnostics={showDiagnostics} />
      </div>
    </nav>
  );
}
