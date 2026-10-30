// One rule for heading anchors, shared by the reader (rendered ids and outline), its search
// results and tools/check-docs.mjs.
//
// Docstream renders every heading (and titled tab set) with id = slugify(text), so two headings
// with the same text share an id. The reader keeps the first as-is and numbers repeats in document
// order: "limits", "limits-1", "limits-2". Search sections come from buildDocsTree, whose page body
// has its leading "# Title" removed; that title is still the first heading on the rendered page, so
// its slug is counted before the body's sections.

// ["a", "b", "a"] -> ["a", "b", "a-1"]
export function uniqueIds(ids) {
  const seen = new Map();
  return ids.map((id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n ? `${id}-${n}` : id;
  });
}

// Rewrite each search section's anchor (and heading text) in place to the id and text the reader
// gives that heading. `outlineOf(page)` returns the rendered page's headings after its title, in
// document order, as [{ id, text }] with ids already made unique. Search sections that start at a
// heading follow the same document order, so they are matched by position; that also corrects the
// library's plain-text quirks (it reads `div_by_zero.S` as emphasis and slugs it "divbyzero-s").
// If a page's counts ever disagree, fall back to numbering repeated slugs, counting the title first.
// Sections must be in index order (createDocsSearchIndex keeps pages and sections in order).
export function alignSectionAnchors(sections, outlineOf, titleSlugOf) {
  const byPage = new Map();
  for (const section of sections) {
    if (!byPage.has(section.page)) byPage.set(section.page, []);
    byPage.get(section.page).push(section);
  }
  for (const [page, list] of byPage) {
    const headed = list.filter((section) => section.anchor);
    const outline = outlineOf(page);
    if (outline && outline.length === headed.length) {
      headed.forEach((section, i) => {
        section.anchor = outline[i].id;
        section.heading = outline[i].text;
      });
      continue;
    }
    const seen = new Map();
    const title = titleSlugOf(page);
    if (title) seen.set(title, 1);
    for (const section of headed) {
      const n = seen.get(section.anchor) ?? 0;
      seen.set(section.anchor, n + 1);
      if (n) section.anchor = `${section.anchor}-${n}`;
    }
  }
  return sections;
}

// A rendered page's headings after its title, ids made unique, from documentOutline() entries.
export function outlineAfterTitle(entries) {
  const ids = uniqueIds(entries.map((entry) => entry.id));
  const all = entries.map((entry, i) => ({ id: ids[i], text: entry.text, level: entry.level }));
  return all[0]?.level === 1 ? all.slice(1) : all;
}

// Published pages carry a properties block (kind/source/scope/…) for the reader's Properties
// sheet. Search indexes the document itself, so that block is removed before buildDocsTree, which
// then also strips the leading "# Title" as it does for any site page.
export function withoutProperties(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, "");
}

// Search input for one page: the document without its properties block and without Mermaid
// diagram sources (their node syntax makes unreadable excerpts; the diagram's words are in the
// surrounding prose). Other code stays searchable. Headings are untouched, so anchors still align.
export function searchInput(markdown) {
  return withoutProperties(markdown).replace(/^(`{3,})mermaid[^\n]*\n[\s\S]*?^\1[ \t]*$\n?/gm, "");
}
