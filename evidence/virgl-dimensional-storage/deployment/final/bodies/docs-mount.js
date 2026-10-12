// Docs tab (vanilla-app interim): embed the standalone docs page in an ISOLATED iframe inside
// #docs-mount. The iframe fully sandboxes the docs' own styles/scripts (no leak into the app) AND
// keeps the parent SPA alive — so navigating to Docs never reloads the page and the background Alpine
// boot keeps running. (The Vite/shadcn rewrite will render @brett_lamy/docstream here natively instead.)
function ensureDocsFrame() {
  const mount = document.getElementById("docs-mount");
  if (!mount || mount.dataset.loaded === "1") return;
  mount.dataset.loaded = "1";
  mount.replaceChildren();
  mount.style.cssText = "position:relative;height:calc(100vh - 52px);overflow:hidden";
  const f = document.createElement("iframe");
  f.src = "./docs.html";
  f.title = "wasm-vm — library docs";
  f.loading = "lazy";
  f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#090b0f";
  mount.appendChild(f);
}

// Load lazily when the Docs tab is first shown (hash nav or the tab button), or now if already there.
function maybe() { if (location.hash.slice(1) === "docs") ensureDocsFrame(); }
window.addEventListener("hashchange", maybe);
document.querySelector('.tab[data-tab="docs"]')?.addEventListener("click", ensureDocsFrame);
maybe();
