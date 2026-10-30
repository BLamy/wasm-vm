// One table for every link the shared UI renders. Hrefs use the SOURCE tree's dev names
// (index.html = app, landing.html = homepage). tools/build-web-dist.sh applies the same
// deploy-time root swap to ui.js that it applies to the HTML pages, so these strings become
// ./app.html and ./ in the published bundle.

export const PRIMARY_ROUTES = [
  { id: "home", label: "Home", href: "./landing.html" },
  { id: "docs", label: "Docs", href: "./docs.html" },
  { id: "case-studies", label: "Case studies", href: "./case-studies.html" },
  { id: "roadmap", label: "Roadmap", href: "./roadmap.html" },
  { id: "app", label: "Open the machine", href: "./index.html#ide", primary: true },
];

// The recommended first start (E0-T29): the app boots BusyBox from its ?guest= query contract.
export const START_ROUTE = "./index.html?guest=busybox#ide";
export const CHOOSER_ROUTE = "./index.html#ide";

export const SOURCE_URL = "https://github.com/BLamy/wasm-vm";

// Focused host surfaces kept for verification and debugging. Grouped so a person can find one
// without reading a wall of links; every entry is a real page in web/.
export const DIAGNOSTIC_ROUTES = [
  {
    title: "Display and input",
    routes: [
      { href: "./console-capture.html", label: "Display and serial", detail: "Canvas, serial console, screenshot and recording" },
      { href: "./desktop.html", label: "Desktop cold boot", detail: "Boot the graphical desktop from scratch" },
      { href: "./desktop-terminal.html", label: "Terminal input", detail: "Keyboard path into a desktop terminal" },
      { href: "./desktop-cursor.html", label: "Cursor and pixel ratio", detail: "Pointer hit-testing at device pixel ratios" },
      { href: "./desktop-resize.html", label: "Live resize", detail: "Guest display follows the browser window" },
      { href: "./desktop-recovery.html", label: "Desktop recovery", detail: "Restore after a stalled or lost session" },
    ],
  },
  {
    title: "Display pipeline",
    routes: [
      { href: "./first-light.html", label: "Framebuffer first light", detail: "fbcon output on the guest framebuffer" },
      { href: "./tty0-damage.html", label: "tty0 damage", detail: "Damage rectangles from the text console" },
      { href: "./tty0-stress.html", label: "tty0 stress", detail: "Sustained console redraw" },
      { href: "./display-hotplug.html", label: "Display hotplug", detail: "Connect and disconnect a host display" },
      { href: "./display-resize.html", label: "Viewport resize", detail: "Mode changes from the browser viewport" },
      { href: "./cursor-integration.html", label: "Cursor plane", detail: "Hardware cursor plane composition" },
      { href: "./present-integration.html", label: "Presentation", detail: "Frame presentation path" },
    ],
  },
  {
    title: "Reference",
    routes: [
      { href: "./ui-kit.html", label: "Interface kit", detail: "The shared controls used across the site" },
    ],
  },
];
