import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DocsRenderer, DocPageActions, parseMarkdown, documentOutline } from "@brett_lamy/docstream";
// The shared interface first: its stylesheet declares the cascade-layer order used below.
import "../ui/src/styles.css";
import "@brett_lamy/docstream/styles.css";
import "../docs.css";
import { Button, Input, Label, TextField } from "@brett_lamy/ui";
import { UIRoot } from "../ui/src/components/ui-root.jsx";
import { SiteNav } from "../ui/src/components/site-nav.jsx";
import { ButtonLink, Picker } from "../ui/src/components/primitives.jsx";
import architectureSource from "./architecture-demo.jsx?raw";

const aliases={"docs-embedding.html":"embedding","docs-guest.html":"storage","docs-containers.html":"containers","docs-verification.html":"verification","docs-explainers.html":"explainers"};
const initialPage=()=>{const entry=location.pathname.split("/").pop();return new URLSearchParams(location.search).get("page")||aliases[entry.endsWith(".html")?entry:`${entry}.html`]||"overview";};
const demoResolver={
  list:()=>["architecture/layers"],
  meta:async()=>({title:"Execution layers",entry:"architecture-demo.jsx",status:"Interactive explanation",height:"auto"}),
  files:async()=>[{path:"architecture-demo.jsx",content:architectureSource,language:"jsx"}],
  load:async(src)=>{if(src!=="architecture/layers")throw new Error("Unknown documentation demo");return (await import("./architecture-demo.jsx")).default;},
};

function Reader(){
  const [catalog,setCatalog]=useState(null),[pageId,setPageId]=useState(initialPage),[markdown,setMarkdown]=useState(""),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [search,setSearch]=useState(""),[subject,setSubject]=useState("All subjects"),[menu,setMenu]=useState(false),[archive,setArchive]=useState(null),[archiveOpen,setArchiveOpen]=useState(false);
  const articleRef=useRef(null),searchRef=useRef(null);
  useEffect(()=>{const abort=new AbortController();fetch(`./docs-content/catalog.json?rev=${__DOCS_CORPUS_REV__}`,{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error("Documentation catalog could not load.");return r.json();}).then(setCatalog).catch(e=>{if(e.name!=="AbortError")setError(e.message);});return()=>abort.abort();},[]);
  useEffect(()=>{const navigate=()=>{setPageId(initialPage());setMenu(false);};addEventListener("popstate",navigate);const keys=e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setMenu(true);requestAnimationFrame(()=>searchRef.current?.focus());}if(e.key==="Escape"){setSearch("");setMenu(false);}};addEventListener("keydown",keys);return()=>{removeEventListener("popstate",navigate);removeEventListener("keydown",keys);};},[]);
  const page=catalog?.pages.find(p=>p.id===pageId);
  useEffect(()=>{if(!catalog)return;if(!page){setError("This documentation page does not exist. Choose a guide or search the library.");setLoading(false);return;}const abort=new AbortController();setLoading(true);setError("");setMarkdown("");fetch(`${page.url}?sha=${page.sha256.slice(0,12)}`,{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error("The document could not load. Its source link is available below.");return r.text();}).then(text=>{setMarkdown(text);setLoading(false);document.title=`${page.title} — wasm-vm docs`;}).catch(e=>{if(e.name!=="AbortError"){setError(e.message);setLoading(false);}});return()=>abort.abort();},[catalog,pageId]);
  const doc=useMemo(()=>parseMarkdown(markdown),[markdown]);
  const outline=useMemo(()=>documentOutline(doc).filter(h=>h.level===2||h.level===3),[doc]);
  useEffect(()=>{
    if(!articleRef.current)return;
    const used=new Map();
    articleRef.current.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(heading=>{
      if(heading.id&&!heading.dataset.readerAnchor)return;
      const found=documentOutline(doc).find(entry=>entry.text===heading.textContent);
      if(!found)return;
      const count=used.get(found.id)||0;used.set(found.id,count+1);
      heading.id=count?`${found.id}-${count}`:found.id;heading.dataset.readerAnchor="true";
    });
    const observers=[];
    articleRef.current.querySelectorAll(".docs-table").forEach(table=>{
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
    return()=>{observers.forEach(observer=>observer.disconnect());articleRef.current?.querySelectorAll(".reader-scroll-hint").forEach(hint=>hint.remove());};
  },[doc,pageId]);
  const query=search.toLocaleLowerCase().trim();
  const filtered=useMemo(()=>catalog?.pages.filter(p=>(subject==="All subjects"||p.category===subject||p.kind==="guide")&&(!query||`${p.title} ${p.source} ${p.search}`.toLocaleLowerCase().includes(query)))||[],[catalog,query,subject]);
  const groups=[...new Set(filtered.map(p=>p.group))];
  const subjects=[...new Set(catalog?.pages.filter(p=>p.kind==="reference").map(p=>p.category)||[])].sort();
  function closeMenu(){setMenu(false);requestAnimationFrame(()=>document.querySelector('[data-wv="docs-menu"]')?.focus());}
  function go(id,event){if(event&&(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;if(event)event.preventDefault();const target=catalog?.pages.find(p=>p.id===id);if(!target)return;history.pushState({},"",`./docs.html?page=${id}`);setPageId(id);setMenu(false);setSearch("");setArchiveOpen(false);window.scrollTo({top:0,behavior:"instant"});}
  async function openArchive(){setArchiveOpen(v=>!v);if(!archive){try{const r=await fetch(`./docs-content/migration-ledger.json?rev=${__DOCS_CORPUS_REV__}`);if(!r.ok)throw new Error("Archive ledger could not load.");setArchive((await r.json()).documents);}catch(e){setError(e.message);}}}
  const archiveMatches=archive?.filter(p=>!query||`${p.path} ${p.reason}`.toLocaleLowerCase().includes(query));
  return <>
    <a className="docs-skip" href="#doc-main">Skip to document</a>
    {/* Shared site nav and library controls. Only these controls sit inside .wv-ui roots; the page
        list, outline and the Docstream article stay outside, so the isolation guard never
        touches them. */}
    <header className="reader-header"><UIRoot className="reader-nav-root"><SiteNav current="docs"/></UIRoot></header>
    <div className="reader-layout"><aside id="docs-sidebar" className={`reader-sidebar ${menu?"is-open":""}`} aria-label="Documentation library">
      {/* Phones: the open library covers the page, including the button that opened it. */}
      {menu&&<UIRoot className="reader-sidebar-close"><Button variant="secondary" size="sm" onPress={closeMenu} data-wv="docs-menu-close" autoFocus>Close menu</Button></UIRoot>}
      <UIRoot className="reader-controls">
        <TextField aria-label="Search documentation" value={search} onChange={setSearch} className="reader-search-field">
          <Label>Search documentation <span className="search-shortcut">⌘/Ctrl K</span></Label>
          <Input ref={searchRef} type="search" placeholder="Pages, code or paths" data-wv="docs-search"/>
        </TextField>
        <Picker label="Reference subject" options={["All subjects",...subjects].map(s=>({id:s,label:s}))} value={subject} onChange={setSubject}/>
      </UIRoot>
      {query&&<p className="search-count" role="status">{archiveOpen?(archiveMatches?.length||0):filtered.length} matching pages</p>}
      <nav aria-label="Documentation pages">{!archiveOpen&&groups.map(group=><section key={group}><h2>{group}</h2>{filtered.filter(p=>p.group===group).map(p=><a key={p.id} href={`./docs.html?page=${p.id}`} onClick={e=>go(p.id,e)} aria-current={pageId===p.id?"page":undefined} title={p.source}>{p.title}{p.kind==="reference"&&<small>{p.category}</small>}</a>)}</section>)}</nav>
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
      {page&&<div className="reader-provenance"><span>{page.kind==="guide"?"Guide":page.disposition==="preserved"?"Preserved source record":"Technical reference"}</span><a href={page.sourceUrl}>Source: {page.source} ↗</a></div>}
      {loading&&<p role="status" className="doc-state">Loading document…</p>}
      {error&&<div role="alert" className="doc-state"><p>{error}</p><a href="./docs.html?page=overview" onClick={e=>go("overview",e)}>Return to the field guide →</a>{page&&<a href={page.sourceUrl}>Read the original source ↗</a>}</div>}
      {!loading&&!error&&<><div className="reader-page-actions"><DocPageActions markdown={markdown} actions={["copy","view"]} resolver={demoResolver}/><UIRoot className="reader-markdown-root"><ButtonLink variant="ghost" size="sm" href={page.url} download={`${page.id}.md`}>Download Markdown</ButtonLink></UIRoot></div><article key={pageId} ref={articleRef} className="reader-document"><DocsRenderer doc={doc} markdown={markdown} demoResolver={demoResolver} documentProperties={{defaultOpen:false}}/></article><div className="reader-bottom"><a href="./docs.html?page=coverage" onClick={e=>go("coverage",e)}>Documentation coverage →</a><a href={page.sourceUrl}>Inspect the source ↗</a></div></>}
    </main>
    <aside className="reader-outline" aria-label="On this page"><p>On this page</p><nav>{outline.map((h,i)=><a key={`${h.id}-${i}`} href={`#${h.id}`} data-level={h.level}>{h.text}</a>)}</nav><div className="outline-source"><span>Source boundary</span><p>Reports retain their original revision, workload, and evidence. A reader page does not refresh a verification claim.</p></div></aside>
    </div>
  </>;
}

createRoot(document.getElementById("docs-root")).render(<Reader/>);
