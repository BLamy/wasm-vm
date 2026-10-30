import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssetResolverProvider, DocsRenderer, DocPageActions, parseMarkdown, documentOutline, slugify } from "@brett_lamy/docstream";
import { buildDocsTree, createDocsSearchIndex } from "@brett_lamy/docstream/site";
// The shared interface first: its stylesheet declares the cascade-layer order used below.
import "../ui/src/styles.css";
import "@brett_lamy/docstream/styles.css";
import "../docs.css";
import { Button, Input, Label, TextField } from "@brett_lamy/ui";
import { UIRoot } from "../ui/src/components/ui-root.jsx";
import { SiteNav } from "../ui/src/components/site-nav.jsx";
import { ButtonLink, Picker } from "../ui/src/components/primitives.jsx";
import architectureSource from "./architecture-demo.jsx?raw";
import { alignSectionAnchors, outlineAfterTitle, uniqueIds, withoutProperties } from "./anchors.js";

const aliases={"docs-embedding.html":"embedding","docs-guest.html":"storage","docs-containers.html":"containers","docs-verification.html":"verification","docs-explainers.html":"explainers"};
const initialPage=()=>{const entry=location.pathname.split("/").pop();return new URLSearchParams(location.search).get("page")||aliases[entry.endsWith(".html")?entry:`${entry}.html`]||"overview";};
const currentHash=()=>{try{return decodeURIComponent(location.hash.slice(1));}catch{return location.hash.slice(1);}};
const PHONE="(max-width: 700px)";
const demoResolver={
  list:()=>["architecture/layers"],
  meta:async()=>({title:"Execution layers",entry:"architecture-demo.jsx",status:"Interactive explanation",height:"auto"}),
  files:async()=>[{path:"architecture-demo.jsx",content:architectureSource,language:"jsx"}],
  load:async(src)=>{if(src!=="architecture/layers")throw new Error("Unknown documentation demo");return (await import("./architecture-demo.jsx")).default;},
};

// Search: Docstream's site index over every published page, built on first use from one corpus
// file. Section anchors are aligned with the ids this reader renders (see anchors.js).
let searchLoad=null;
function loadSearch(){
  searchLoad??=fetch(`./docs-content/search-corpus.json?rev=${__DOCS_CORPUS_REV__}`).then(r=>{if(!r.ok)throw new Error("The search index could not load.");return r.json();}).then(corpus=>{
    const byPath=new Map(corpus.pages.map(p=>[p.path,p]));
    const tree=buildDocsTree(corpus.pages.map(p=>({path:p.path,content:withoutProperties(p.content)})));
    const index=createDocsSearchIndex(tree);
    alignSectionAnchors(index.sections,page=>outlineAfterTitle(documentOutline(parseMarkdown(byPath.get(page.path).content))),page=>slugify(page.title));
    return {index,idOf:page=>byPath.get(page.path)?.id};
  }).catch(e=>{searchLoad=null;throw e;});
  return searchLoad;
}

function Snippet({result}){
  if(!result.highlight)return <span>{result.snippet}</span>;
  const [a,b]=result.highlight;
  return <span>{result.snippet.slice(0,a)}<mark>{result.snippet.slice(a,b)}</mark>{result.snippet.slice(b)}</span>;
}

function Reader(){
  const [catalog,setCatalog]=useState(null),[pageId,setPageId]=useState(initialPage),[markdown,setMarkdown]=useState(""),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [search,setSearch]=useState(""),[subject,setSubject]=useState("All subjects"),[menu,setMenu]=useState(false),[archive,setArchive]=useState(null),[archiveOpen,setArchiveOpen]=useState(false);
  const [searchIndex,setSearchIndex]=useState(null),[searchError,setSearchError]=useState("");
  // Bumped on every navigation so a repeated link to the same page still scrolls to its anchor.
  const [navigation,setNavigation]=useState(0);
  const articleRef=useRef(null),searchRef=useRef(null),sidebarRef=useRef(null);
  useEffect(()=>{const abort=new AbortController();fetch(`./docs-content/catalog.json?rev=${__DOCS_CORPUS_REV__}`,{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error("Documentation catalog could not load.");return r.json();}).then(setCatalog).catch(e=>{if(e.name!=="AbortError")setError(e.message);});return()=>abort.abort();},[]);
  const ensureSearch=useCallback(()=>{loadSearch().then(setSearchIndex,e=>setSearchError(e.message));},[]);
  useEffect(()=>{
    const navigate=()=>{setPageId(initialPage());setMenu(false);setNavigation(n=>n+1);};
    addEventListener("popstate",navigate);
    const keys=e=>{
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setMenu(true);ensureSearch();requestAnimationFrame(()=>searchRef.current?.focus());}
      if(e.key==="Escape"){setSearch("");setMenu(false);}
    };
    addEventListener("keydown",keys);
    return()=>{removeEventListener("popstate",navigate);removeEventListener("keydown",keys);};
  },[ensureSearch]);
  const page=catalog?.pages.find(p=>p.id===pageId);
  // Load the requested page; an aborted (superseded) request never writes state.
  useEffect(()=>{if(!catalog)return;if(!page){setError("This documentation page does not exist. Choose a guide or search the library.");setLoading(false);return;}const abort=new AbortController();setLoading(true);setError("");setMarkdown("");fetch(`${page.url}?sha=${page.sha256.slice(0,12)}`,{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error("The document could not load. Its source link is available below.");return r.text();}).then(text=>{if(abort.signal.aborted)return;setMarkdown(text);setLoading(false);document.title=`${page.title} — wasm-vm docs`;}).catch(e=>{if(e.name!=="AbortError"){setError(e.message);setLoading(false);}});return()=>abort.abort();},[catalog,pageId]);
  const doc=useMemo(()=>parseMarkdown(markdown),[markdown]);
  // Headings: Docstream gives every heading id = slugify(text); repeats are numbered in document order.
  const headings=useMemo(()=>{const entries=documentOutline(doc);const ids=uniqueIds(entries.map(e=>e.id));return entries.map((e,i)=>({...e,base:e.id,id:ids[i]}));},[doc]);
  const outline=useMemo(()=>headings.filter(h=>h.level===2||h.level===3),[headings]);
  // Per-document assets: "./images/x.png" in a page resolves next to that page's Markdown file.
  const resolveAsset=useCallback(url=>{if(!page||!url||/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url))return null;return new URL(url,new URL(page.url,location.href)).href;},[page]);
  useEffect(()=>{
    const root=articleRef.current;if(!root||loading)return;
    // Give repeated headings their numbered ids, matching rendered elements to outline entries by
    // order of occurrence of each base id.
    const queues=new Map();for(const h of headings){if(!queues.has(h.base))queues.set(h.base,[]);queues.get(h.base).push(h.id);}
    root.querySelectorAll("[id]").forEach(el=>{const q=queues.get(el.dataset.readerBase||el.id);if(!q?.length)return;el.dataset.readerBase=el.dataset.readerBase||el.id;el.id=q.shift();});
    const observers=[];
    root.querySelectorAll(".docs-table").forEach(table=>{
      table.tabIndex=0;table.setAttribute("role","table");
      table.setAttribute("aria-label","Scrollable documentation table");
      let hint=table.previousElementSibling;
      if(!hint?.classList.contains("reader-scroll-hint")){
        hint=document.createElement("p");hint.className="reader-scroll-hint";
        hint.textContent="Scroll the table to read every column →";table.before(hint);
      }
      const update=()=>{hint.dataset.overflow=String(table.scrollWidth>table.clientWidth+1);};
      const observer=new ResizeObserver(update);observer.observe(table);observers.push(observer);update();
    });
    // Land on the requested section: scroll it into view and move focus there, so keyboard and
    // screen-reader users continue from the heading they chose.
    const target=currentHash();
    const heading=target&&document.getElementById(target);
    let release=()=>{};
    if(heading&&root.contains(heading)){
      if(!heading.hasAttribute("tabindex"))heading.tabIndex=-1;
      heading.scrollIntoView({block:"start"});heading.focus({preventScroll:true});
      // Diagrams, images and code highlighting finish after this; while they change the article's
      // height, keep the chosen heading in place, until the reader scrolls or a few seconds pass.
      // Stops on the reader's own input, once the article has kept its size for 600 ms, or at 4 s.
      let settle=0;
      const pin=new ResizeObserver(()=>{
        if(!heading.isConnected)return;
        heading.scrollIntoView({block:"start"});
        clearTimeout(settle);settle=setTimeout(stop,600);
      });
      const stop=()=>{pin.disconnect();clearTimeout(timer);clearTimeout(settle);for(const type of ["wheel","touchstart","pointerdown","keydown"])removeEventListener(type,stop,true);};
      const timer=setTimeout(stop,4000);
      settle=setTimeout(stop,600);
      pin.observe(root);
      for(const type of ["wheel","touchstart","pointerdown","keydown"])addEventListener(type,stop,true);
      release=stop;
    }
    return()=>{release();observers.forEach(observer=>observer.disconnect());root.querySelectorAll(".reader-scroll-hint").forEach(hint=>hint.remove());};
  },[doc,pageId,loading,headings,navigation]);
  const query=search.trim();
  const subjects=[...new Set(catalog?.pages.filter(p=>p.kind==="reference").map(p=>p.category)||[])].sort();
  const inSubject=p=>subject==="All subjects"||p.category===subject||p.kind==="guide";
  const listed=useMemo(()=>catalog?.pages.filter(inSubject)||[],[catalog,subject]);
  const groups=[...new Set(listed.map(p=>p.group))];
  const results=useMemo(()=>{
    if(!query||!searchIndex||!catalog)return null;
    const byId=new Map(catalog.pages.map(p=>[p.id,p]));
    return searchIndex.index.search(query,60).map(r=>({...r,entry:byId.get(searchIndex.idOf(r.page))})).filter(r=>r.entry&&inSubject(r.entry)).slice(0,30);
  },[query,searchIndex,catalog,subject]);
  useEffect(()=>{if(query)ensureSearch();},[query,ensureSearch]);
  function closeMenu(){setMenu(false);requestAnimationFrame(()=>document.querySelector('[data-wv="docs-menu"]')?.focus());}
  function go(id,event,anchor=""){
    if(event&&(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;
    if(event)event.preventDefault();
    const target=catalog?.pages.find(p=>p.id===id);if(!target)return;
    history.pushState({},"",`./docs.html?page=${id}${anchor?`#${encodeURIComponent(anchor)}`:""}`);
    setPageId(id);setMenu(false);setSearch("");setArchiveOpen(false);setNavigation(n=>n+1);
    if(!anchor)window.scrollTo({top:0,behavior:"instant"});
  }
  // Docstream 1.33 renders every Markdown link with target="_blank". Links to another page of this
  // reader (or to a section of this page) are ordinary in-place navigation with history; other
  // links, and modified clicks, keep the library's behaviour.
  function articleClick(event){
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const link=event.target.closest?.("a[href]");if(!link)return;
    const url=new URL(link.getAttribute("href"),location.href);
    if(url.origin!==location.origin)return;
    const entry=url.pathname.split("/").pop();
    const anchor=decodeURIComponent(url.hash.slice(1));
    if(entry==="docs.html"||aliases[entry]){
      const id=url.searchParams.get("page")||aliases[entry]||"overview";
      if(!catalog?.pages.some(p=>p.id===id))return;
      go(id,event,anchor);
    }
  }
  async function openArchive(){setArchiveOpen(v=>!v);if(!archive){try{const r=await fetch(`./docs-content/migration-ledger.json?rev=${__DOCS_CORPUS_REV__}`);if(!r.ok)throw new Error("Archive ledger could not load.");setArchive((await r.json()).documents);}catch(e){setError(e.message);}}}
  const lowered=query.toLocaleLowerCase();
  const archiveMatches=archive?.filter(p=>!lowered||`${p.path} ${p.reason}`.toLocaleLowerCase().includes(lowered));
  // Phones: the open library is a full-screen overlay; keep Tab inside it until it closes.
  useEffect(()=>{
    if(!menu||!matchMedia(PHONE).matches)return undefined;
    const trap=e=>{
      if(e.key!=="Tab"||!sidebarRef.current)return;
      const focusable=[...sidebarRef.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      else if(!sidebarRef.current.contains(document.activeElement)){e.preventDefault();first.focus();}
    };
    addEventListener("keydown",trap,true);
    return()=>removeEventListener("keydown",trap,true);
  },[menu]);
  let searchStatus=null;
  if(query&&!archiveOpen)searchStatus=searchError?searchError:!searchIndex?"Building the search index…":`${results.length} ${results.length===1?"result":"results"}`;
  if(query&&archiveOpen)searchStatus=`${archiveMatches?.length||0} matching records`;
  return <>
    <a className="docs-skip" href="#doc-main">Skip to document</a>
    {/* Shared site nav and library controls. Only these controls sit inside .wv-ui roots; the page
        list, outline and the Docstream article stay outside, so the isolation guard never
        touches them. */}
    <header className="reader-header"><UIRoot className="reader-nav-root"><SiteNav current="docs"/></UIRoot></header>
    <div className="reader-layout"><aside id="docs-sidebar" ref={sidebarRef} className={`reader-sidebar ${menu?"is-open":""}`} aria-label="Documentation library" aria-modal={menu&&matchMedia(PHONE).matches?"true":undefined}>
      {/* Phones: the open library covers the page, including the button that opened it. */}
      {menu&&<UIRoot className="reader-sidebar-close"><Button variant="secondary" size="sm" onPress={closeMenu} data-wv="docs-menu-close" autoFocus>Close menu</Button></UIRoot>}
      <UIRoot className="reader-controls">
        <TextField aria-label="Search documentation" value={search} onChange={setSearch} className="reader-search-field">
          <Label>Search documentation <span className="search-shortcut">⌘/Ctrl K</span></Label>
          <Input ref={searchRef} type="search" placeholder="Titles, sections or text" data-wv="docs-search" onFocus={ensureSearch}/>
        </TextField>
        <Picker label="Reference subject" options={["All subjects",...subjects].map(s=>({id:s,label:s}))} value={subject} onChange={setSubject}/>
      </UIRoot>
      {searchStatus&&<p className="search-count" role="status">{searchStatus}</p>}
      {!archiveOpen&&results&&<nav aria-label="Search results" className="reader-results">
        {results.map(r=><a key={`${r.entry.id}#${r.anchor??""}`} href={`./docs.html?page=${r.entry.id}${r.anchor?`#${encodeURIComponent(r.anchor)}`:""}`} onClick={e=>go(r.entry.id,e,r.anchor)} data-wv="docs-result">
          <strong>{r.entry.title}</strong>{r.heading&&<em>{r.heading}</em>}<span className="reader-result-snippet"><Snippet result={r}/></span>
        </a>)}
      </nav>}
      {!archiveOpen&&!results&&<nav aria-label="Documentation pages">{groups.map(group=><section key={group}><h2>{group}</h2>{listed.filter(p=>p.group===group).map(p=><a key={p.id} href={`./docs.html?page=${p.id}`} onClick={e=>go(p.id,e)} aria-current={pageId===p.id?"page":undefined} title={p.source}>{p.title}{p.kind==="reference"&&<small>{p.category}</small>}</a>)}</section>)}</nav>}
      <UIRoot className="reader-controls">
        <Button variant="secondary" size="sm" aria-expanded={archiveOpen} onPress={openArchive} data-wv="docs-archive">{archiveOpen?"Back to reader pages":`Archive ledger · ${catalog?.counts.totalDocuments.toLocaleString()??""} records`}</Button>
      </UIRoot>
      {archiveOpen&&<div className="archive-list"><p>Preserved records and the replacement for every original doc.</p>{archiveMatches?.map((p,i)=><a key={`${p.path}-${i}`} href={p.replacement||p.sourceUrl} onClick={p.page?e=>go(p.page,e):undefined}><span>{p.path}</span><small>{p.status} · {p.reason}</small></a>)}</div>}
      <div className="reader-sidebar-foot"><span>Docstream {catalog?.docstreamVersion}</span><a href="./docs.html?page=coverage" onClick={e=>go("coverage",e)}>Corpus and provenance →</a></div>
    </aside>
    <main id="doc-main" className="reader-main" tabIndex={-1}>
      <div className="reader-breadcrumb"><a href="./docs.html" onClick={e=>go("overview",e)}>Field guide</a><span>/</span><span>{page?.category||"Documentation"}</span>
        <UIRoot className="reader-menu-root"><Button variant="secondary" size="sm" aria-expanded={menu} aria-controls="docs-sidebar" onPress={()=>setMenu(!menu)} data-wv="docs-menu">{menu?"Close menu":"Browse docs"}</Button></UIRoot>
      </div>
      {page&&<div className="reader-provenance"><span>{page.kind==="guide"?"Guide":page.disposition==="current"?"Current reference":page.disposition==="preserved"?"Preserved source record":"Technical reference"}</span><a href={page.sourceUrl}>Source: {page.source}{page.sourceRevision?` @ ${page.sourceRevision.slice(0,9)}`:""} ↗</a></div>}
      {loading&&<p role="status" className="doc-state">Loading document…</p>}
      {error&&<div role="alert" className="doc-state"><p>{error}</p><a href="./docs.html?page=overview" onClick={e=>go("overview",e)}>Return to the field guide →</a>{page&&<a href={page.sourceUrl}>Read the original source ↗</a>}</div>}
      {!loading&&!error&&<><div className="reader-page-actions"><DocPageActions markdown={markdown} actions={["copy","view"]} resolver={demoResolver}/><UIRoot className="reader-markdown-root"><ButtonLink variant="ghost" size="sm" href={page.url} download={`${page.id}.md`}>Download Markdown</ButtonLink></UIRoot></div><article key={pageId} ref={articleRef} className="reader-document" onClick={articleClick}><AssetResolverProvider resolve={resolveAsset}><DocsRenderer doc={doc} markdown={markdown} demoResolver={demoResolver} documentProperties={{defaultOpen:false}}/></AssetResolverProvider></article><div className="reader-bottom"><a href="./docs.html?page=coverage" onClick={e=>go("coverage",e)}>Documentation coverage →</a><a href={page.sourceUrl}>Inspect the source ↗</a></div></>}
    </main>
    <aside className="reader-outline" aria-label="On this page"><p>On this page</p><nav>{outline.map(h=><a key={h.id} href={`#${h.id}`} data-level={h.level}>{h.text}</a>)}</nav><div className="outline-source"><span>Source boundary</span><p>Reports retain their original revision, workload, and evidence. A reader page does not refresh a verification claim.</p></div></aside>
    </div>
  </>;
}

createRoot(document.getElementById("docs-root")).render(<Reader/>);
