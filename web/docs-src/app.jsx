import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DocsRenderer, DocPageActions, parseMarkdown, documentOutline } from "@brett_lamy/docstream";
import "@brett_lamy/docstream/styles.css";
import "../docs.css";
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
  function go(id,event){if(event&&(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;if(event)event.preventDefault();const target=catalog?.pages.find(p=>p.id===id);if(!target)return;history.pushState({},"",`./docs.html?page=${id}`);setPageId(id);setMenu(false);setSearch("");setArchiveOpen(false);window.scrollTo({top:0,behavior:"instant"});}
  async function openArchive(){setArchiveOpen(v=>!v);if(!archive){try{const r=await fetch(`./docs-content/migration-ledger.json?rev=${__DOCS_CORPUS_REV__}`);if(!r.ok)throw new Error("Archive ledger could not load.");setArchive((await r.json()).documents);}catch(e){setError(e.message);}}}
  const archiveMatches=archive?.filter(p=>!query||`${p.path} ${p.reason}`.toLocaleLowerCase().includes(query));
  return <>
    <a className="docs-skip" href="#doc-main">Skip to document</a>
    <header className="reader-header"><a className="reader-brand" href="./landing.html">wasm—vm <span>/ docs</span></a><div className="reader-header-links"><a href="./index.html">Open demo ↗</a><a href="https://github.com/BLamy/wasm-vm">Source ↗</a><button type="button" className="reader-menu" aria-expanded={menu} aria-controls="docs-sidebar" onClick={()=>setMenu(!menu)}>{menu?"Close menu":"Browse docs"}</button></div></header>
    <div className="reader-layout"><aside id="docs-sidebar" className={`reader-sidebar ${menu?"is-open":""}`} aria-label="Documentation library">
      <div className="reader-search"><label htmlFor="docs-search">Search documentation</label><input id="docs-search" ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search pages, code, or paths" type="search"/><span className="search-shortcut">⌘ / Ctrl K</span></div>
      <label className="subject-label" htmlFor="docs-subject">Reference subject</label><select id="docs-subject" value={subject} onChange={e=>setSubject(e.target.value)}><option>All subjects</option>{subjects.map(s=><option key={s}>{s}</option>)}</select>
      {query&&<p className="search-count" role="status">{archiveOpen?(archiveMatches?.length||0):filtered.length} matching pages</p>}
      <nav aria-label="Documentation pages">{!archiveOpen&&groups.map(group=><section key={group}><h2>{group}</h2>{filtered.filter(p=>p.group===group).map(p=><a key={p.id} href={`./docs.html?page=${p.id}`} onClick={e=>go(p.id,e)} aria-current={pageId===p.id?"page":undefined} title={p.source}>{p.title}{p.kind==="reference"&&<small>{p.category}</small>}</a>)}</section>)}</nav>
      <button className="archive-button" type="button" aria-expanded={archiveOpen} onClick={openArchive}>{archiveOpen?"Back to reader pages":"Archive ledger"}<span>{catalog?.counts.totalDocuments.toLocaleString()}</span></button>
      {archiveOpen&&<div className="archive-list"><p>Preserved records and the replacement for every original doc.</p>{archiveMatches?.map((p,i)=><a key={`${p.path}-${i}`} href={p.replacement||p.sourceUrl} onClick={p.page?e=>go(p.page,e):undefined}><span>{p.path}</span><small>{p.status} · {p.reason}</small></a>)}</div>}
      <div className="reader-sidebar-foot"><span>Docstream 1.8.0</span><a href="./docs.html?page=coverage" onClick={e=>go("coverage",e)}>Corpus and provenance →</a></div>
    </aside>
    <main id="doc-main" className="reader-main" tabIndex={-1}>
      <div className="reader-breadcrumb"><a href="./docs.html" onClick={e=>go("overview",e)}>Field guide</a><span>/</span><span>{page?.category||"Documentation"}</span></div>
      {page&&<div className="reader-provenance"><span>{page.kind==="guide"?"Guide":page.disposition==="preserved"?"Preserved source record":"Technical reference"}</span><a href={page.sourceUrl}>Source: {page.source} ↗</a></div>}
      {loading&&<p role="status" className="doc-state">Loading document…</p>}
      {error&&<div role="alert" className="doc-state"><p>{error}</p><a href="./docs.html?page=overview" onClick={e=>go("overview",e)}>Return to the field guide →</a>{page&&<a href={page.sourceUrl}>Read the original source ↗</a>}</div>}
      {!loading&&!error&&<><div className="reader-page-actions"><DocPageActions markdown={markdown} actions={["copy","view"]} resolver={demoResolver}/><a className="reader-markdown" href={page.url} download={`${page.id}.md`}>Download Markdown ↓</a></div><article key={pageId} ref={articleRef} className="reader-document"><DocsRenderer doc={doc} markdown={markdown} demoResolver={demoResolver}/></article><div className="reader-bottom"><a href="./docs.html?page=coverage" onClick={e=>go("coverage",e)}>Documentation coverage →</a><a href={page.sourceUrl}>Inspect the source ↗</a></div></>}
    </main>
    <aside className="reader-outline" aria-label="On this page"><p>On this page</p><nav>{outline.map((h,i)=><a key={`${h.id}-${i}`} href={`#${h.id}`} data-level={h.level}>{h.text}</a>)}</nav><div className="outline-source"><span>Source boundary</span><p>Reports retain their original revision, workload, and evidence. A reader page does not refresh a verification claim.</p></div></aside>
    </div>
  </>;
}

createRoot(document.getElementById("docs-root")).render(<Reader/>);
