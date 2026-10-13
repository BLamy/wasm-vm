// The demo opens the guest launcher. Older workbench bookmarks use the same
// roadmap and documentation pages as the public site.
const testHooks = new URLSearchParams(location.search).has("testHooks");
if (testHooks) document.documentElement.classList.add("e2e-showall");

function showDemo() {
  const legacy = location.hash.slice(1);
  if (!testHooks && (legacy === "roadmap" || legacy === "docs")) {
    const target = new URL(legacy === "roadmap" ? "./roadmap.html" : "./docs.html", location.href);
    if (legacy === "docs") {
      const page = new URLSearchParams(location.search).get("page");
      if (page) target.searchParams.set("page", page);
    }
    location.replace(target.href);
    return;
  }
  document.getElementById("panel-ide")?.classList.add("active");
  if (legacy !== "ide") history.replaceState(null, "", `${location.pathname}${location.search}#ide`);
  requestAnimationFrame(() => window.__term?.fitNow?.());
}

window.addEventListener("hashchange", showDemo);
showDemo();
