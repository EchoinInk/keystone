"use client";

import { configs, TASK_STATUSES, type Field } from "./record-fields";
import { submitCommand } from "./submit-command";
import { cents } from "./finance";
import { activeSprint, reopenStatus, sprintDays, sprintEnd, taskStatus } from "./workflows";
import type { DataSet, EditorTarget, Row, Save } from "./editor-types";
import { DocumentAttachment, DocumentLinks } from "./document-attachment";
import { HandoffControls } from "./handoff-controls";
import { maxTextEditBytes } from "./document-types";
import { WorkspaceDialog } from "./workspace-dialog";
import { useRecordDraft } from "./record-draft";
import { FieldInput, browserFieldValue, recordLabel as rowLabel, validateForm } from "./record-input";
import Image from "next/image";
import { FormEvent, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type View="Mission Control"|"Freelance Launch"|"Tasks"|"Sprints"|"Activity"|"Revenue"|"Clients"|"Projects"|"Products"|"Content"|"Finance"|"Knowledge Base";
type Finding={ entity:string; id:string; reason:string };
type Metrics={month:string;revenue:number;totalRevenue:number;outstanding:number;weightedPipeline:number;pipelineValue:number;monthExpenses:number;profit:number;goal:number;goalProgress:number;history:{period:string;value:number}[];dueTasks:number;upcomingMeetings:number;activeClients:number;openInvoices:number};


const navigation:{label:View;icon:string}[]=[{label:"Mission Control",icon:"M"},{label:"Freelance Launch",icon:"↗"},{label:"Tasks",icon:"✓"},{label:"Sprints",icon:"S"},{label:"Activity",icon:"A"},{label:"Revenue",icon:"$"},{label:"Clients",icon:"C"},{label:"Projects",icon:"P"},{label:"Products",icon:"◇"},{label:"Content",icon:"✦"},{label:"Finance",icon:"F"},{label:"Knowledge Base",icon:"K"}];
const sections:Record<View,string[]>={
  "Mission Control":["tasks","meetings","calendarEvents","dailyJournal","founderGoals","kpis","teamMembers","aiConversations"],"Freelance Launch":["professionalProfiles","skills","services","portfolioProjects","repositories","marketingPosts","acquisitionChannels","outreachRecords","leads","resumeAchievements","launchPhases","launchObjectives","testimonials"],Tasks:["tasks","founderGoals"],Sprints:["sprints","sprintObjectives","dailyReviews"],Activity:["activityLogs"],
  Revenue:["revenueGoals","invoices","payments","leads","subscriptions","expenses"],Clients:["leads","clients","tasks","proposals","notes","meetings","documents"],Projects:["projects","tasks","milestones","timeEntries","invoices","documents"],
  Products:["products","services","tasks"],Content:["content","calendarEvents","documents"],Finance:["invoices","payments","expenses","subscriptions","revenueGoals"],"Knowledge Base":["knowledge","notes","documents","aiConversations"],
};
const labels:Record<string,string>={kpis:"KPIs",revenueGoals:"Revenue goals",calendarEvents:"Calendar events",dailyJournal:"Daily journal",founderGoals:"Founder goals",teamMembers:"Team members",aiConversations:"AI conversations",timeEntries:"Time entries",sprintObjectives:"Sprint objectives",dailyReviews:"End-of-day reviews",activityLogs:"Activity timeline",successMetrics:"Success metrics",aiCoaching:"AI coaching",reflectionNotes:"Reflection notes",tomorrowPriorities:"Tomorrow’s priorities",aiSummary:"AI summary",professionalProfiles:"Professional profile",portfolioProjects:"Portfolio projects",marketingPosts:"Marketing posts",acquisitionChannels:"Acquisition channels",outreachRecords:"Outreach",resumeAchievements:"Resume achievements",launchPhases:"Launch roadmap",launchObjectives:"Weekly objectives"};
const titleFor=(entity:string)=>labels[entity]??entity.replace(/([A-Z])/g," $1").replace(/^./,x=>x.toUpperCase());
const money=(value:number)=>new Intl.NumberFormat("en-NZ",{style:"currency",currency:"NZD",maximumFractionDigits:2}).format(value||0);
const pct=(value:unknown)=>`${Math.max(0,Math.min(100,Number(value)||0))}%`;
const dateLabel=(value:unknown)=>value?new Intl.DateTimeFormat("en-NZ",{day:"numeric",month:"short",year:"numeric"}).format(new Date(String(value))):"—";
const today=()=>new Date().toISOString().slice(0,10);
const NOW_MS=new Date().getTime();
const addDays=(date:string,days:number)=>sprintEnd(date,days+1);
const friendlyError=(error:unknown,fallback:string)=>{const message=error instanceof Error?error.message:fallback;return /expected pattern/i.test(message)?"One of the date or link values was not in a format this browser accepts. It has been normalised—please try saving again.":message};

const CLOSED_TASK_STATUSES=["Completed","Cancelled"];



const WorkspaceId = createContext("");

type Snapshot = {
  workspaceId: string; data: DataSet; metrics: Metrics; reconciliation?: Finding[]; cleanup?: { pending: number };
};

export default function Home() {
  const [workspace, setWorkspace] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const deny = (message: string) => { setWorkspace(null); setError(message); };
  const refresh = useCallback((signal?: AbortSignal) =>
    fetch("/api/data", { cache: "no-store", signal }).then(async response => {
      const json = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setWorkspace(null);
        throw new Error(json.error || "Unable to load workspace");
      }
      if (!json.workspaceId || !Array.isArray(json.data?.tasks)) throw new Error("The workspace response was incomplete.");
      setError(""); setWorkspace(json);
    }).catch(reason => { if (!signal?.aborted) setError(friendlyError(reason, "Unable to load workspace")); }), []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  if (!workspace) return <main><p role={error ? "alert" : "status"}>{error || "Loading your workspace…"}</p>
    {error && <><button onClick={() => refresh()}>Try again</button> <a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a></>}</main>;

  return <WorkspaceId.Provider value={workspace.workspaceId}><Workspace key={workspace.workspaceId} workspace={workspace}
    error={error} refresh={refresh} onDenied={deny} onUpdate={patch => setWorkspace(current =>
      current?.workspaceId === workspace.workspaceId ? {...current, ...patch} : current)}/></WorkspaceId.Provider>;
}

const viewHash = (view: View) => "#" + view.toLowerCase().replaceAll(" ", "-");
function hashView(): View {
  return navigation.find(item => viewHash(item.label) === window.location.hash)?.label ?? "Mission Control";
}

function Workspace({workspace, error, refresh, onDenied, onUpdate}: {
  workspace: Snapshot; error: string; refresh: () => Promise<void>; onDenied: (message: string) => void;
  onUpdate: (patch: Partial<Omit<Snapshot, "workspaceId">>) => void;
}) {
  const {workspaceId, data, metrics, reconciliation: findings = []} = workspace;
  const [view, setView] = useState<View>(hashView);
  const [editor, setEditor] = useState<EditorTarget | null>(null), [assistantOpen, setAssistantOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false), [globalSearch, setGlobalSearch] = useState("");
  const [toast, setToast] = useState(""), [cleaning, setCleaning] = useState(false);
  const title = useRef<HTMLHeadingElement>(null), menuToggle = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const notify = (message: string) => {
    clearTimeout(timer.current); setToast(message);
    timer.current = window.setTimeout(() => setToast(""), 6000);
  };
  const focusAfterNavigation = useRef(false);
  const focusHeading = useCallback(() => {
    title.current?.focus({preventScroll:true});
    window.scrollTo(0,0);
  }, []);
  useLayoutEffect(() => {
    if (focusAfterNavigation.current) { focusAfterNavigation.current = false; focusHeading(); }
  }, [view, focusHeading]);
  const goTo = useCallback((next: View) => {
    setMenuOpen(false); setGlobalSearch("");
    if (next === view) focusHeading();
    else { focusAfterNavigation.current = true; setView(next); }
  }, [view, focusHeading]);
  function navigate(next: View) {
    if (next === view) goTo(next);
    else window.location.hash = viewHash(next);
  }
  useEffect(() => {
    const restore = () => goTo(hashView());
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, [goTo]);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!sidebar.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const desktop = window.matchMedia("(min-width: 1101px)");
    const resize = () => { if (desktop.matches) setMenuOpen(false); };
    document.addEventListener("pointerdown", dismiss); desktop.addEventListener("change", resize);
    return () => { document.removeEventListener("pointerdown", dismiss); desktop.removeEventListener("change", resize); };
  }, [menuOpen]);
  const searching = Boolean(globalSearch);
  useEffect(() => {
    if (!searching) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(".global-search")) setGlobalSearch("");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [searching]);
  const pendingSave = useRef(Promise.resolve());
  const save: Save = (entity, action, payload) => {
    const { attachment, ...args } = payload;
    if (args.id && !args.expectedUpdatedAt) args.expectedUpdatedAt = data[entity]?.find(item => item.id === args.id)?.updatedAt;
    // Serialize this tab's submits so an older snapshot cannot replace a newer
    // acknowledgement. Each command retains the version the founder actually saw.
    const submit = async () => {
      const { response, data: json } = await submitCommand(workspaceId, "/api/data", { entity, action, ...args },
        attachment instanceof File ? attachment : undefined);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          onDenied(json.error ?? "Workspace access denied");
        } else if (response.status === 409) await refresh();
        throw new Error(json.error ?? `Unable to save record (${response.status})`);
      }
      onUpdate({ data: json.data, metrics: json.metrics, reconciliation: json.reconciliation, ...(json.cleanup ? { cleanup: json.cleanup } : {}) });
    };
    const operation = pendingSave.current.then(submit);
    pendingSave.current = operation.catch(() => {});
    return operation;
  };
  const searchResults=useMemo(()=>{const q=globalSearch.trim().toLowerCase();if(!q)return[];return Object.entries(data).filter(([entity])=>configs[entity]).flatMap(([entity,rows])=>rows.filter(row=>Object.values(row).some(value=>String(value??"").toLowerCase().includes(q))).map(row=>({entity,row}))).slice(0,12)},[data,globalSearch]);
  const primaryEntity=view==="Freelance Launch"?"launchObjectives":sections[view].find(x=>configs[x])??"tasks";
  async function retryCleanup() {
    setCleaning(true);
    try {
      const {response,data:result} = await submitCommand(workspaceId, "/api/files?cleanup=1", {});
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) onDenied(result.error || "Workspace access denied");
        throw new Error(result.error || "Unable to retry storage cleanup");
      }
      onUpdate({ cleanup: { pending: result.pending } });
      notify(result.pending ? "Storage cleanup is pending. Retry in a minute." : "Storage cleanup complete");
    } catch (reason) { notify(friendlyError(reason,"Unable to retry storage cleanup")); }
    finally { setCleaning(false); }
  }
  const currentSprint = activeSprint(data.sprints);
  function openResult(entity: string, row: Row) {
    document.getElementById("global-search")?.focus(); setGlobalSearch(""); setEditor({entity, row});
  }
  return <div className="app-shell" onClickCapture={event => {
    // Some browsers leave focus on the body after a pointer activation. Give
    // the native dialog a live invoker to restore when it closes.
    if (document.activeElement === document.body && event.target instanceof Element)
      event.target.closest<HTMLElement>("button, summary")?.focus({preventScroll:true});
  }}>
    <a className="skip-link" href="#view-title" onClick={event => { event.preventDefault(); title.current?.focus(); }}>Skip to main content</a>
    <aside ref={sidebar} className="sidebar" onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
    }} onKeyDown={event => {
      if (event.key === "Escape" && menuOpen) { event.preventDefault(); setMenuOpen(false); menuToggle.current?.focus(); }
    }}>
      <button className="brand" aria-label="Echo in Ink · Mission Control" onClick={() => navigate("Mission Control")}><span className="brand-mark"><Image src="/ei-logo-512.png" alt="" width={84} height={84} priority unoptimized/></span><span><strong>ECHO IN INK</strong><small>Founder OS</small></span></button>
      <button ref={menuToggle} className="nav-toggle" aria-expanded={menuOpen} aria-controls="primary-nav" onClick={() => setMenuOpen(!menuOpen)}>Menu <span aria-hidden="true">{menuOpen ? "▴" : "▾"}</span></button>
      <nav id="primary-nav" aria-label="Primary navigation" className={menuOpen ? "expanded" : ""}><p className="nav-label">Command centre</p>
        {navigation.map(item => <a key={item.label} href={viewHash(item.label)} className={view === item.label ? "active" : ""} aria-current={view === item.label ? "page" : undefined}
          onClick={event => {
            if (view === item.label && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault(); goTo(item.label);
            }
          }}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}{item.label === "Clients" && <em aria-hidden="true">{data.leads.length + data.clients.length}</em>}
        </a>)}</nav>
      <div className="sprint-card"><div className="sprint-top"><span>Active sprint</span><strong>{String(currentSprint?.completionPercentage??0)}%</strong></div><div className="mini-track"><i style={{width:pct(currentSprint?.completionPercentage)}}/></div><p>{String(currentSprint?.name ?? (data.sprints.some(s=>s.status==="Active")?"Multiple active sprints":"No active sprint"))}</p><small>{metrics.dueTasks} priority actions due</small></div>
      <div className="profile"><span className="avatar">AF</span><span><strong>Alexandria</strong><small>Auckland, NZ</small></span></div>
    </aside>
    <main><header className="topbar"><div><p className="eyebrow">ECHO IN INK <span>/</span> {view.toUpperCase()}</p><h1 id="view-title" tabIndex={-1} ref={title}>{view}</h1></div><div className="header-actions search-actions"><div role="search" className="global-search" onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setGlobalSearch("");
    }} onKeyDown={event => {
      if (event.key === "Escape" && globalSearch) { event.preventDefault(); setGlobalSearch(""); document.getElementById("global-search")?.focus(); }
    }}><input id="global-search" value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} placeholder="Search everything…" aria-label="Global search"/>{globalSearch&&<div className="search-results">{searchResults.length?searchResults.map(({entity,row})=>entity==="tasks"?<div className="search-task-result" key={`${entity}-${row.id}`}><button onClick={()=>openResult(entity,row)}><span>{titleFor(entity)}</span><strong>{rowLabel(row)}</strong></button><TaskStatusControls task={row} save={save} notify={notify} setEditor={setEditor}/></div>:<button key={`${entity}-${row.id}`} onClick={()=>openResult(entity,row)}><span>{titleFor(entity)}</span><strong>{rowLabel(row)}</strong></button>):<p role="status">No matching records</p>}</div>}</div><span className="date-pill" suppressHydrationWarning><i/>{new Intl.DateTimeFormat("en-NZ",{weekday:"short",day:"numeric",month:"short"}).format(new Date()).toUpperCase()}</span><button className={`icon-button ${assistantOpen?"active":""}`} onClick={()=>setAssistantOpen(x=>!x)} aria-label="Open AI command panel" aria-haspopup="dialog" aria-expanded={assistantOpen}>✦</button><button className="primary-button" onClick={()=>setEditor({entity:primaryEntity})}>＋ Add {titleFor(primaryEntity).replace(/s$/,'')}</button></div></header>
      {Boolean(workspace.cleanup?.pending) && <div className="panel" role="status">Private file cleanup is pending. <button disabled={cleaning} onClick={retryCleanup}>Retry storage cleanup</button></div>}
      {error?<div className="content"><section className="panel empty-state"><h2>Founder OS could not load</h2><p>{error}</p><button className="primary-button" onClick={()=>refresh()}>Try again</button></section></div>:<Page key={view} view={view} findings={findings} data={data} metrics={metrics} setView={navigate} setEditor={setEditor} save={save} notify={notify} openAssistant={()=>setAssistantOpen(true)}/>}</main>
    {editor&&<Editor key={JSON.stringify([editor.entity,editor.row?.id,editor.row?.updatedAt,editor.initial])} {...editor} open={setEditor} data={data} close={()=>setEditor(null)} save={save} notify={notify}/>}<Assistant page={view} open={assistantOpen} close={()=>setAssistantOpen(false)} onSaved={refresh} onDenied={onDenied}/><div role="status" aria-live="polite" aria-atomic="true" className={toast ? "toast" : "sr-only"}>{toast}</div></div>;
}

function Page({view,data,metrics,findings,setView,setEditor,save,notify,openAssistant}:{view:View;findings:Finding[];data:DataSet;metrics:Metrics;setView:(v:View)=>void;setEditor:(x:EditorTarget)=>void;save:Save;notify:(s:string)=>void;openAssistant:()=>void}){
  if(view==="Mission Control")return <MissionControl data={data} metrics={metrics} setView={setView} setEditor={setEditor} save={save} notify={notify} openAssistant={openAssistant}/>;
  if(view==="Freelance Launch")return <FreelanceLaunch data={data} metrics={metrics} setEditor={setEditor} save={save} notify={notify}/>;
  if(view==="Sprints")return <Sprints data={data} setEditor={setEditor} save={save} notify={notify} openAssistant={openAssistant}/>;
  if(view==="Activity")return <Activity data={data} setEditor={setEditor}/>;
  if(view==="Knowledge Base")return <Knowledge data={data} setEditor={setEditor} save={save} notify={notify} openAssistant={openAssistant}/>;
  const intro:Record<string,[string,string]>= {Tasks:["TASK SYSTEM","Create, prioritise and complete the work that drives every sprint."],Revenue:["REVENUE COMMAND","Income, forecasts and targets from your records."],Clients:["CLIENT RELATIONSHIPS","Every relationship, project and conversation in one place."],Projects:["DELIVERY SYSTEM","Scope, delivery, time and progress connected."],Products:["PRODUCT ECOSYSTEM","Services and products that deepen the studio."],Content:["CONTENT ENGINE","Plan, draft, schedule and publish with context."],Finance:["FINANCIAL CLARITY","Know what is earned, owed and available."]};
  return <div className="content section-view"><section className="section-intro"><p className="eyebrow purple">{intro[view]?.[0]}</p><h2>{intro[view]?.[1]}</h2><p>{view==="Tasks"?"Select Add Task, enter a task name, then optionally connect it to a project or client and choose its priority and due date.":"Every saved change updates connected metrics, intelligence and activity automatically."}</p></section>{view==="Revenue"&&<RevenueSummary metrics={metrics}/>} {view==="Finance"&&<FinanceSummary metrics={metrics}/>}
    {["Finance","Revenue"].includes(view)&&findings.length>0&&<details className="panel"><summary>Financial reconciliation · {findings.length} findings</summary><ul>{findings.map(issue=><li key={JSON.stringify(issue)}>{issue.entity} {issue.id} · {issue.reason}</li>)}</ul></details>}<Manager entities={sections[view]} data={data} setEditor={setEditor} save={save} notify={notify}/></div>;
}

function FreelanceLaunch({data,metrics,setEditor,save,notify}:{data:DataSet;metrics:Metrics;setEditor:(x:EditorTarget)=>void;save:Save;notify:(s:string)=>void}){
  const avg=(values:number[])=>values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):0;
  const profile=data.professionalProfiles?.find(x=>x.status==="Active"),services=data.services??[],portfolio=data.portfolioProjects??[],repos=data.repositories??[],channels=data.acquisitionChannels??[],objectives=data.launchObjectives??[],outreach=data.outreachRecords??[],leads=data.leads??[],launchTasks=(data.tasks??[]).filter(task=>task.objectiveId&&task.status!=="Cancelled"),launchCompleted=launchTasks.filter(task=>task.status==="Completed").length,launchExecution=launchTasks.length?Math.round(launchCompleted/launchTasks.length*100):0;
  const scores=[
    ["Brand",profile?100:0],["Website",Number(portfolio.find(x=>x.name==="Echo in Ink")?.readiness??0)],["Portfolio",avg(portfolio.map(x=>Number(x.readiness??0)))],["GitHub",avg(repos.map(x=>Number(x.readiness??0)))],["Resume",data.resumeAchievements?.some(x=>x.status==="Ready")?100:data.resumeAchievements?.length?50:20],["Social profiles",channels.length?Math.round(channels.filter(x=>x.profileStatus==="Live").length/channels.length*100):0],["Service clarity",services.length?Math.round(services.filter(x=>x.status==="Active"&&x.idealClient&&x.deliverables).length/services.length*100):0],["Lead intake",configs.leads.length>=20?100:0],["Outreach",outreach.some(x=>x.outcome!=="Planned")?100:outreach.length?50:15],["Launch execution",launchExecution]
  ] as [string,number][];
  const readiness=avg(scores.map(x=>x[1])),clientReady=portfolio.filter(x=>x.status==="Client-ready"||Number(x.readiness)>=80),repoIssues=repos.filter(x=>x.readmeStatus!=="Complete"||x.screenshotStatus!=="Complete"||x.demoStatus!=="Live"||x.buildStatus!=="Passing"),activeChannels=channels.filter(x=>["Live","In progress"].includes(String(x.profileStatus))),thisWeek=outreach.filter(x=>x.dateContacted&&NOW_MS-new Date(String(x.dateContacted)).getTime()<7*86400000),newLeads=leads.filter(x=>["New","Reviewing"].includes(String(x.stage))),qualified=leads.filter(x=>["Qualified","Proposal required","Proposal sent","Negotiating"].includes(String(x.stage))),next=objectives.filter(x=>x.status!=="Completed").sort((a,b)=>Number(a.weekNumber??99)-Number(b.weekNumber??99)||({Urgent:0,High:1,Medium:2,Low:3}[String(a.priority) as "Urgent"]??4)-({Urgent:0,High:1,Medium:2,Low:3}[String(b.priority) as "Urgent"]??4))[0];
  return <div className="content section-view freelance-view"><section className="briefing-hero"><div><p className="eyebrow purple">FREELANCE LAUNCH COMMAND</p><h2>{readiness>=80?"Ready to accept focused client work.":"Build the professional presence, then turn attention into paid work."}</h2><p>Readiness, portfolio quality, acquisition activity and client opportunities—measured from live records.</p></div><button className="primary-button" onClick={()=>setEditor({entity:"leads"})}>＋ Capture lead</button></section>
    <section className="launch-score panel"><div className="launch-score-main"><div className="progress-ring large" style={{"--progress":`${readiness*3.6}deg`} as React.CSSProperties}><span><strong>{readiness}</strong><small>READY</small></span></div><div><p className="eyebrow purple">FREELANCE READINESS</p><h2>{readiness}% launch-ready</h2><p>{clientReady.length} client-ready projects · {repoIssues.length} repository issues · {activeChannels.length} active channels</p></div></div><div className="readiness-grid">{scores.map(([label,value])=><div key={label}><span><b>{label}</b><em>{value}%</em></span><i><u style={{width:pct(value)}}/></i></div>)}</div></section>
    <section className="stat-grid launch-metrics"><Metric label="Client-ready projects" value={String(clientReady.length)} note={`${portfolio.length} portfolio projects`} tone="violet" progress={portfolio.length?clientReady.length/portfolio.length*100:0}/><Metric label="Repository issues" value={String(repoIssues.length)} note={`${repos.length} tracked repositories`} tone="blue" progress={repos.length?(repos.length-repoIssues.length)/repos.length*100:0}/><Metric label="Active channels" value={String(activeChannels.length)} note={`${thisWeek.length} outreach sent this week`} tone="magenta" progress={channels.length?activeChannels.length/channels.length*100:0}/><Metric label="Qualified leads" value={String(qualified.length)} note={`${newLeads.length} new · ${money(metrics.pipelineValue)} pipeline`} tone="amber" progress={leads.length?qualified.length/leads.length*100:0}/></section>
    <section className="briefing-grid"><article className="panel recommendation-card launch-next"><PanelHeader eyebrow="NEXT RECOMMENDED ACTION" title="Move closer to paid work"/><p>{next?String(next.title):"Review the launch roadmap and choose the next high-value outcome."}</p>{next&&<><small>{String(next.description??"")} · Week {String(next.weekNumber??"—")}</small><div><button className="secondary-button" onClick={()=>setEditor({entity:"launchObjectives",row:next})}>Open objective</button>{data.tasks?.find(task=>task.objectiveId===next.id&&task.status!=="Completed"&&task.status!=="Cancelled")?<TaskStatusControls task={data.tasks.find(task=>task.objectiveId===next.id&&task.status!=="Completed"&&task.status!=="Cancelled")!} save={save} notify={notify} setEditor={setEditor}/>:<button className="primary-button" onClick={()=>openTaskForObjective(next,data,setEditor)}>Add task</button>}</div></>}</article><article className="panel funnel-card"><PanelHeader eyebrow="CLIENT JOURNEY" title="Acquisition funnel"/><div className="funnel-mini">{[["Audience",channels.reduce((s,x)=>s+Number(x.leadsGenerated||0),0)],["Enquiries",leads.length],["Qualified",qualified.length],["Proposals",data.proposals?.length??0],["Clients",data.clients?.filter(x=>!String(x.tags??"").includes("internal")).length??0],["Testimonials",data.testimonials?.filter(x=>x.status==="Received"||x.status==="Published").length??0]].map(([label,value],index)=><div key={String(label)}><span>{String(index+1).padStart(2,"0")}</span><strong>{label}</strong><b>{value}</b></div>)}</div></article></section>
    <FreelanceObjectiveBoard objectives={objectives} data={data} setEditor={setEditor} save={save} notify={notify}/>
    <Manager entities={sections["Freelance Launch"]} data={data} setEditor={setEditor} save={save} notify={notify}/></div>
}

function openTaskForObjective(objective: Row, data: DataSet, open: (target: EditorTarget) => void) {
  const project = data.projects.find(item => item.id === "echo-in-ink-studio-operations");
  open({ entity: "tasks", initial: { objectiveId: objective.id, sprintId: activeSprint(data.sprints)?.id ?? "",
    projectId: project?.id ?? "", clientId: project?.clientId ?? "", priority: objective.priority ?? "High", dueDate: objective.dueDate ?? "" } });
}

function FreelanceObjectiveBoard({objectives,data,setEditor,save,notify}:{objectives:Row[];data:DataSet;setEditor:(x:EditorTarget)=>void;save:Save;notify:(s:string)=>void}){
  const sorted=[...objectives].sort((a,b)=>Number(a.weekNumber??99)-Number(b.weekNumber??99));
  return <section className="panel freelance-objectives"><PanelHeader eyebrow="TASK-BACKED ROADMAP" title="Freelance Launch objectives" action="Add objective" onClick={()=>setEditor({entity:"launchObjectives"})}/><div className="objective-stack">{sorted.map(objective=>{const linked=Array.isArray(data.tasks)?data.tasks.filter(task=>task.objectiveId===objective.id):null,count=Number(objective.taskCount??0),completed=Number(objective.completedTaskCount??0),remaining=Number(objective.remainingTaskCount??0),progress=Number(objective.progressPercentage??0);return <details className="objective-card" key={objective.id}><summary><span className="objective-week">W{String(objective.weekNumber??"—")}</span><span className="objective-summary"><strong>{rowLabel(objective)}</strong><small>{linked===null?"Unable to load linked tasks.":count?`${completed}/${count} complete`:"No tasks connected yet"}</small><i aria-label={`${progress}% complete`}><u style={{width:pct(progress)}}/></i></span><span className={`objective-state state-${String(objective.status??"not-started").toLowerCase().replace(/\s+/g,"-")}`}>{String(objective.status??"Not started")}</span><span className="expand-indicator" aria-hidden="true">⌄</span></summary><div className="objective-expanded"><div className="objective-detail"><div><h3>{rowLabel(objective)}</h3><p>{String(objective.description??"No description added yet.")}</p></div><dl><div><dt>Week</dt><dd>W{String(objective.weekNumber??"—")}</dd></div><div><dt>Due</dt><dd>{dateLabel(objective.dueDate)}</dd></div><div><dt>Status</dt><dd>{String(objective.status??"Not started")}</dd></div><div><dt>Completed</dt><dd>{completed}</dd></div><div><dt>Remaining</dt><dd>{remaining}</dd></div></dl></div><div className="objective-progress"><span><b>{completed}/{count} complete</b><em>{progress}%</em></span><i><u style={{width:pct(progress)}}/></i></div><div className="connected-task-list">{linked===null?<div className="objective-empty"><strong>Unable to load linked tasks.</strong><small>Refresh the page and try again.</small></div>:linked.length?linked.map(task=><div className={`connected-task ${task.status==="Completed"?"completed-row":""}`} key={task.id}><TaskStatusControls task={task} save={save} notify={notify} setEditor={setEditor} compact/><button className="connected-task-title" onClick={()=>setEditor({entity:"tasks",row:task})}><strong>{rowLabel(task)}</strong><small>{String(task.priority??"Medium")} priority · {task.dueDate?`Due ${dateLabel(task.dueDate)}`:"No due date"}{task.assignee?` · ${String(task.assignee)}`:""}</small></button><TaskStatusControls task={task} save={save} notify={notify} setEditor={setEditor} hideCompletion/><button className="unlink-task" onClick={async()=>{try{await save("tasks","update",{id:task.id,expectedUpdatedAt:task.updatedAt,data:{objectiveId:""}});notify("Task removed from objective")}catch(e){notify(friendlyError(e,"Unable to remove task"))}}}>Remove</button></div>):<div className="objective-empty"><strong>No tasks connected yet</strong><button onClick={()=>openTaskForObjective(objective,data,setEditor)}>Add first task →</button></div>}</div><div className="objective-actions"><button className="primary-button" onClick={()=>openTaskForObjective(objective,data,setEditor)}>＋ Add task</button><button className="secondary-button" onClick={()=>setEditor({entity:"launchObjectives",row:objective})}>Edit objective</button><button className="text-action" onClick={()=>setEditor({entity:"launchObjectives",row:objective})}>Open full objective →</button></div></div></details>})}{!sorted.length&&<div className="objective-empty"><strong>No objectives yet</strong><button onClick={()=>setEditor({entity:"launchObjectives"})}>Add the first objective →</button></div>}</div></section>
}

function MissionControl({data,metrics,setView,setEditor,save,notify,openAssistant}:{data:DataSet;metrics:Metrics;setView:(v:View)=>void;setEditor:(x:EditorTarget)=>void;save:Save;notify:(s:string)=>void;openAssistant:()=>void}){
  const [recordsOpen, setRecordsOpen] = useState(false);
  const hour=new Date().getHours(),greeting=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";
  const tasks=[...(data.tasks??[])].filter(x=>x.status!=="Cancelled").sort((a,b)=>(a.status==="Completed"?1:0)-(b.status==="Completed"?1:0)||({Urgent:0,High:1,Medium:2,Low:3}[String(a.priority) as "Urgent"]??4)-({Urgent:0,High:1,Medium:2,Low:3}[String(b.priority) as "Urgent"]??4)||String(a.dueDate??"9999").localeCompare(String(b.dueDate??"9999")));
  const projects=data.projects??[],lateProjects=projects.filter(x=>x.status!=="Complete"&&x.dueDate&&String(x.dueDate)<today()),staleClients=(data.clients??[]).filter(x=>NOW_MS-new Date(String(x.updatedAt)).getTime()>14*86400000),overdueInvoices=(data.invoices??[]).filter(x=>Number(x.balance)>0&&x.dueDate&&String(x.dueDate)<today());
  const activities=(data.activityLogs??[]).slice(0,5),meetings=(data.meetings??[]).filter(x=>String(x.startsAt)>=new Date().toISOString()).slice(0,4),currentSprint=activeSprint(data.sprints),launchNext=(data.launchObjectives??[]).find(x=>x.status!=="Completed");
  const insights: { message: string; view: View; risk: boolean }[] = [];
  if (overdueInvoices.length) insights.push({ view:"Finance", risk:true, message:`${overdueInvoices.length} invoice${overdueInvoices.length===1?" is":"s are"} overdue.` });
  if (lateProjects.length) insights.push({ view:"Projects", risk:true, message:`${lateProjects.length} project${lateProjects.length===1?" is":"s are"} behind schedule.` });
  if (staleClients.length) insights.push({ view:"Clients", risk:true, message:`${staleClients.length} client relationship${staleClients.length===1?" needs":"s need"} attention.` });
  if (metrics.weightedPipeline>0) insights.push({ view:"Clients", risk:false, message:`${money(metrics.weightedPipeline)} in weighted pipeline is available to progress.` });
  if (launchNext) insights.push({ view:"Freelance Launch", risk:false, message:`Freelance launch: ${String(launchNext.title)}` });
  return <div className="content dashboard-view"><section className="briefing-hero"><div><p className="eyebrow purple">DAILY EXECUTIVE BRIEFING</p><h2>{greeting}, Alexandria.</h2><p>{new Intl.DateTimeFormat("en-NZ",{weekday:"long",day:"numeric",month:"long"}).format(new Date())} · Here is what matters most today.</p></div><button className="secondary-button" onClick={openAssistant}>✦ Ask what to focus on</button></section>
    <section className="mission-card"><div className="mission-orb"/><div className="mission-heading"><span className="mission-number">01</span><div><p className="eyebrow purple">PRIMARY OBJECTIVE</p><h2>{tasks.find(task=>task.status!=="Completed")?String(tasks.find(task=>task.status!=="Completed")?.title):"Choose one outcome that moves the studio forward."}</h2><p>{tasks.find(task=>task.status!=="Completed")?.description?String(tasks.find(task=>task.status!=="Completed")?.description):currentSprint?`Supports ${currentSprint.name}`:"Create a high-value task and give it a due date."}</p></div><div className="day-progress"><strong>{String(currentSprint?.completionPercentage??0)}%</strong><span>SPRINT</span></div></div><div className="mission-body"><div className="task-list">{tasks.slice(0,3).map((task,index)=><div className={`task ${task.status==="Completed"?"done":""}`} key={task.id}><TaskStatusControls task={task} save={save} notify={notify} setEditor={setEditor} compact/><button className="task-copy" onClick={()=>setEditor({entity:"tasks",row:task})}><strong><b>0{index+1}</b> {String(task.title)}</strong><small>{task.dueDate?`Due ${dateLabel(task.dueDate)}`:`${String(task.priority??"Medium")} priority`}</small></button><TaskStatusControls task={task} save={save} notify={notify} setEditor={setEditor}/></div>)}<button className="add-task-button" onClick={()=>setEditor({entity:"tasks"})}>＋ Add today’s priority</button></div><div className="mission-progress"><div className="progress-ring" style={{"--progress":`${Number(currentSprint?.completionPercentage??0)*3.6}deg`} as React.CSSProperties}><span><strong>{String(currentSprint?.completedObjectives??0)}</strong><small>OF {String(currentSprint?.objectiveCount??0)}</small></span></div><p>{currentSprint?String(currentSprint.name):"No active sprint"}</p><button className="text-action" onClick={()=>setView("Sprints")}>Open sprint →</button></div></div></section>
    <section className="stat-grid"><Metric label="Paid revenue" value={money(metrics.revenue)} note={`${metrics.goalProgress}% of monthly goal`} tone="violet" progress={metrics.goalProgress}/><Metric label="Active clients" value={String(metrics.activeClients)} note={`${staleClients.length} need attention`} tone="blue" progress={metrics.activeClients?Math.max(20,100-staleClients.length/metrics.activeClients*100):0}/><Metric label="Project health" value={`${Math.max(0,projects.length-lateProjects.length)}/${projects.length}`} note={`${lateProjects.length} at risk`} tone="magenta" progress={projects.length?(projects.length-lateProjects.length)/projects.length*100:0}/><Metric label="Outstanding" value={money(metrics.outstanding)} note={`${metrics.openInvoices} open invoices`} tone="amber" progress={metrics.goal?metrics.outstanding/metrics.goal*100:0}/></section>
    <section className="briefing-grid"><article className="panel attention-panel"><PanelHeader eyebrow="FOUNDER INTELLIGENCE" title="Attention, risk & opportunity"/><div className="insight-list">{insights.length?insights.map(item=><button key={item.view+item.message} onClick={()=>setView(item.view)}><span className={item.risk?"risk-dot":"opportunity-dot"}>{item.risk?"!":"↗"}</span><strong>{item.message}</strong><small>View connected records →</small></button>):<div className="empty-inline"><p>No immediate risks detected.</p></div>}</div></article><article className="panel"><PanelHeader eyebrow="TODAY" title="Meetings & deadlines" action="Add calendar event" onClick={()=>setEditor({entity:"calendarEvents"})}/><div className="agenda-list">{meetings.map(item=><button key={item.id} onClick={()=>setEditor({entity:"meetings",row:item})}><time>{new Intl.DateTimeFormat("en-NZ",{hour:"numeric",minute:"2-digit"}).format(new Date(String(item.startsAt)))}</time><span><strong>{rowLabel(item)}</strong><small>{String(item.location??"Founder OS")}</small></span></button>)}{!meetings.length&&<div className="empty-inline"><p>No meetings scheduled.</p><button onClick={()=>setEditor({entity:"meetings"})}>Schedule one →</button></div>}</div></article></section>
    <section className="briefing-grid lower"><article className="panel"><PanelHeader eyebrow="LIVE SYSTEM" title="Recent activity" action="Full timeline" onClick={()=>setView("Activity")}/><div className="activity-mini">{activities.map(item=><button key={item.id} onClick={()=>setView("Activity")}><span>✦</span><div><strong>{rowLabel(item)}</strong><small>{dateLabel(item.createdAt)}</small></div></button>)}{!activities.length&&<div className="empty-inline"><p>Activity will appear as you work.</p></div>}</div></article><article className="panel recommendation-card"><PanelHeader eyebrow="STRATEGIC RECOMMENDATION" title="Suggested next action"/><p>{launchNext?String(launchNext.title):insights[0]?.message??(tasks[0]?`Complete “${tasks[0].title}” before opening another workstream.`:"Create one high-value task for today.")}</p><button className="secondary-button" onClick={launchNext?()=>setView("Freelance Launch"):openAssistant}>{launchNext?"Open freelance launch →":"Explore recommendation ✦"}</button></article></section>
    <section className="panel quick-actions"><PanelHeader eyebrow="QUICK ACTIONS" title="Move the work forward"/><div className="quick-grid"><button onClick={()=>setEditor({entity:"leads"})}>＋ <span><strong>New lead</strong><small>Capture an opportunity</small></span></button><button onClick={()=>setEditor({entity:"outreachRecords"})}>↗ <span><strong>New outreach</strong><small>Start a conversation</small></span></button><button onClick={()=>setEditor({entity:"tasks"})}>✓ <span><strong>New task</strong><small>Commit the next action</small></span></button><button onClick={()=>setEditor({entity:"knowledge"})}>K <span><strong>New knowledge</strong><small>Save a decision</small></span></button></div></section>
    <details className="workspace-records" onToggle={event => setRecordsOpen(event.currentTarget.open)}>
      <summary>Workspace records</summary>
      {recordsOpen && <Manager entities={sections["Mission Control"]} data={data} setEditor={setEditor} save={save} notify={notify}/>}
    </details></div>;
}

function Sprints({data,setEditor,save,notify,openAssistant}:{data:DataSet;setEditor:(x:EditorTarget)=>void;save:Save;notify:(s:string)=>void;openAssistant:()=>void}){
  const active=activeSprint(data.sprints),objectives=(data.sprintObjectives??[]).filter(x=>x.sprintId===active?.id&&x.status!=="Cancelled"),sprintTasks=(data.tasks??[]).filter(x=>x.sprintId===active?.id&&x.status!=="Cancelled"),tasks=new Map((data.tasks??[]).map(x=>[x.id,x])),completedTasks=sprintTasks.filter(x=>x.status==="Completed"),day=active?Math.max(1,Math.min(Number(active.duration)||13,Math.floor((NOW_MS-new Date(String(active.startDate)).getTime())/86400000)+1)):1;
  const due=objectives.filter(x=>Number(x.dayNumber)===day||x.dueDate===today()),focusTasks=[...sprintTasks].filter(x=>x.status!=="Completed").sort((a,b)=>({Urgent:0,High:1,Medium:2,Low:3}[String(a.priority) as "Urgent"]??4)-({Urgent:0,High:1,Medium:2,Low:3}[String(b.priority) as "Urgent"]??4)).slice(0,4),risks=[...objectives.filter(o=>!o.taskId),...sprintTasks].filter(x=>x.status==="Blocked"||(x.dueDate&&String(x.dueDate)<today()&&x.status!=="Completed"));
  return <div className="content section-view"><section className="section-intro inline"><div><p className="eyebrow purple">SPRINT ENGINE</p><h2>Focused momentum, measured from the work.</h2><p>Objective progress is synchronised with connected tasks. Completed sprints remain available in the archive.</p></div><button className="primary-button" onClick={()=>setEditor({entity:"sprints"})}>＋ New sprint</button></section>{active?<><section className="panel sprint-hero"><div><span className="status-chip">DAY {day} OF {String(active.duration)}</span><h2>{String(active.name)}</h2><p>{String(active.goal)}</p><div className="sprint-progress"><i style={{width:pct(active.completionPercentage)}}/><span>{String(active.completionPercentage)}% complete · {String(active.completedObjectives??0)} of {String(active.objectiveCount??0)} work items</span></div></div><div className="sprint-score"><strong>{String(active.completionPercentage)}%</strong><small>ESTIMATED COMPLETION</small><button onClick={openAssistant}>AI coaching ✦</button></div></section><section className="briefing-grid"><article className="panel"><PanelHeader eyebrow="DAILY SPRINT BRIEFING" title="Today’s focus" action="Add task" onClick={()=>setEditor({entity:"tasks",initial:{sprintId:active.id}})}/><div className="objective-list">{focusTasks.map(task=><div className={task.status==="Completed"?"completed-objective":""} key={task.id}><button onClick={()=>setEditor({entity:"tasks",row:task})}><span>{task.status==="Completed"?"✓":"→"}</span><div><strong>{rowLabel(task)}</strong><small>{task.objectiveId?"Connected to Freelance Launch objective":"Sprint task"}</small></div></button><TaskStatusControls task={task} save={save} notify={notify} setEditor={setEditor}/></div>)}{!focusTasks.length&&(due.length?due:objectives.slice(0,4)).map(item=>{const linked=item.taskId?tasks.get(String(item.taskId)):undefined;return <div className={linked?.status==="Completed"?"completed-objective":""} key={item.id}><button onClick={()=>setEditor({entity:"sprintObjectives",row:item})}><span>{linked?.status==="Completed"||item.status==="Completed"?"✓":String(item.dayNumber).padStart(2,"0")}</span><div><strong>{rowLabel(item)}</strong><small>{item.milestone?String(item.milestone):item.taskId?"Connected to live task":"Sprint objective"}</small></div></button>{linked&&<TaskStatusControls task={linked} save={save} notify={notify} setEditor={setEditor}/>}</div>})}</div></article><article className="panel sprint-brief"><PanelHeader eyebrow="INTELLIGENCE" title="Progress & risk"/><dl><div><dt>Completed work</dt><dd>{String(active.completedObjectives??0)} of {String(active.objectiveCount??0)}</dd></div><div><dt>Upcoming deadlines</dt><dd>{sprintTasks.filter(x=>x.dueDate&&String(x.dueDate)>=today()&&x.status!=="Completed").length}</dd></div><div><dt>Current risks</dt><dd className={risks.length?"risk-text":"good-text"}>{risks.length||"None detected"}</dd></div><div><dt>Suggested next action</dt><dd>{rowLabel(focusTasks[0]??(due.length?due:objectives.filter(x=>x.status!=="Completed"))[0])}</dd></div></dl></article></section><section className="panel"><PanelHeader eyebrow="END OF DAY" title="Review, learn, reset" action="Start review" onClick={()=>setEditor({entity:"dailyReviews",initial:{sprintId:active.id}})}/><div className="review-strip"><span><strong>{completedTasks.length}</strong><small>Completed tasks</small></span><span><strong>{(data.dailyReviews??[]).filter(x=>x.sprintId===active.id).length}</strong><small>Reflections logged</small></span><span><strong>{risks.length}</strong><small>Challenges visible</small></span><button onClick={()=>setEditor({entity:"dailyReviews",initial:{sprintId:active.id}})}>Capture wins & lessons →</button></div></section></>:<section className="panel empty-state"><h2>{data.sprints.some(s=>s.status==="Active")?"Multiple active sprints":"No active sprint"}</h2><p>{data.sprints.some(s=>s.status==="Active")?"Choose which sprint to keep active in the Sprints list.":"Create a 7, 13, 30, 90-day or custom sprint to begin."}</p><button className="primary-button" onClick={()=>setEditor({entity:"sprints"})}>Create sprint</button></section>}<Manager entities={["sprints","tasks","sprintObjectives","dailyReviews"]} data={data} setEditor={target=>setEditor(active && target.entity==="tasks" && !target.row ? {...target,initial:{sprintId:active.id}} : target)} save={save} notify={notify}/></div>;
}

function Activity({data,setEditor}:{data:DataSet;setEditor:(x:EditorTarget)=>void}){const[filter,setFilter]=useState("All");const categories=Array.from(new Set(["All","Revenue","Clients","Projects","Content","Finance","Knowledge","Tasks","AI",...(data.activityLogs??[]).map(item=>String(item.category))]));const activities=(data.activityLogs??[]).filter(x=>filter==="All"||x.category===filter);return <div className="content section-view"><section className="section-intro"><p className="eyebrow purple">FOUNDER ACTIVITY TIMELINE</p><h2>A live record of how the business moves.</h2><p>Every significant save, update and completion is logged and linked to its originating record.</p></section><div className="activity-filters" role="group" aria-label="Activity categories">{categories.map(category=><button aria-pressed={filter===category} className={filter===category?"active":""} key={category} onClick={()=>setFilter(category)}>{category}</button>)}</div><section className="panel timeline">{activities.map(item=>{const entity=String(item.entity), origin=configs[entity] && data[entity]?.find(x=>x.id===item.recordId);
    const content = <><span aria-hidden="true" className={`timeline-icon ${String(item.category).toLowerCase()}`}>✦</span><div><strong>{rowLabel(item)}</strong><small>{String(item.category)} · {new Intl.DateTimeFormat("en-NZ",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(String(item.createdAt)))}</small></div><em>{origin?"Open record →":"System event"}</em></>;
    return origin ? <button key={item.id} onClick={()=>setEditor({entity,row:origin})}>{content}</button> : <div className="timeline-event" key={item.id}>{content}</div>})}{!activities.length&&<div className="empty-inline"><p>No activity in this filter.</p></div>}</section></div>}

function Knowledge({data,setEditor,save,notify,openAssistant}:{data:DataSet;setEditor:(x:EditorTarget)=>void;save:Save;notify:(s:string)=>void;openAssistant:()=>void}){const[q,setQ]=useState(""),[category,setCategory]=useState("All");const docs=data.knowledge??[],categories=["All",...Array.from(new Set(docs.map(x=>String(x.category||"General"))))];const shown=docs.filter(x=>(category==="All"||(x.category||"General")===category)&&(!q||JSON.stringify(x).toLowerCase().includes(q.toLowerCase())));return <div className="content section-view"><section className="section-intro inline"><div><p className="eyebrow purple">ORGANISATIONAL BRAIN</p><h2>Knowledge that stays connected to the work.</h2><p>Rich notes, Markdown, internal links, tags, attachments, backlinks and revision history live together.</p></div><button className="primary-button" onClick={()=>setEditor({entity:"knowledge"})}>＋ New document</button></section><section className="panel knowledge-tools"><div><input value={q} onChange={e=>setQ(e.target.value)} aria-label="Search knowledge" placeholder="Search titles, content, tags and links…"/><button onClick={openAssistant}>✦ Ask knowledge assistant</button></div><nav aria-label="Knowledge categories">{categories.map(item=><button aria-pressed={category===item} className={category===item?"active":""} key={item} onClick={()=>setCategory(item)}>{item}</button>)}</nav></section><section className="knowledge-grid">{shown.map((doc,index)=>{const backlinks=docs.filter(other=>other.id!==doc.id&&String(other.links??"").includes(doc.id)).length;return <button className="panel knowledge-card" key={doc.id} onClick={()=>setEditor({entity:"knowledge",row:doc})}><span>{String(index+1).padStart(2,"0")}</span><p className="eyebrow">{String(doc.category??"GENERAL")}</p><h3>{rowLabel(doc)}</h3><small>{String(doc.body??"").slice(0,125)||"Empty document — add notes, decisions, code or a table."}</small><b>{String(doc.tags??"Untagged")} · {backlinks} backlink{backlinks===1?"":"s"}</b></button>})}</section><Manager entities={["knowledge","notes","documents","aiConversations"]} data={data} setEditor={setEditor} save={save} notify={notify}/></div>}

function RevenueSummary({metrics}:{metrics:Metrics}){const max=Math.max(1,...metrics.history.map(x=>x.value));return <><section className="stat-grid"><Metric label="Monthly goal" value={money(metrics.goal)} note={`${metrics.goalProgress}% achieved`} tone="violet" progress={metrics.goalProgress}/><Metric label="Paid revenue" value={money(metrics.revenue)} note={metrics.month} tone="blue" progress={metrics.goalProgress}/><Metric label="Weighted forecast" value={money(metrics.weightedPipeline)} note={`Pipeline ${money(metrics.pipelineValue)}`} tone="magenta" progress={metrics.pipelineValue?metrics.weightedPipeline/metrics.pipelineValue*100:0}/><Metric label="Pending invoices" value={money(metrics.outstanding)} note={`${metrics.openInvoices} outstanding`} tone="amber" progress={metrics.goal?metrics.outstanding/metrics.goal*100:0}/></section><section className="panel chart-panel"><PanelHeader eyebrow="6-MONTH VIEW" title="Revenue history"/><div className="bar-chart">{metrics.history.map(x=><div key={x.period}><span>{money(x.value)}</span><i style={{height:pct(x.value/max*100)}}/><small>{new Date(`${x.period}-01`).toLocaleDateString("en-NZ",{month:"short",timeZone:"UTC"})}</small></div>)}</div></section></>}
function FinanceSummary({metrics}:{metrics:Metrics}){return <section className="stat-grid"><Metric label="Income" value={money(metrics.revenue)} note={metrics.month} tone="violet" progress={metrics.goalProgress}/><Metric label="Expenses" value={money(metrics.monthExpenses)} note="This month" tone="blue" progress={metrics.revenue?metrics.monthExpenses/metrics.revenue*100:0}/><Metric label="Cash surplus" value={money(metrics.profit)} note="Receipts less recorded expenses" tone="magenta" progress={metrics.revenue?metrics.profit/metrics.revenue*100:0}/><Metric label="Cash due" value={money(metrics.outstanding)} note={`${metrics.openInvoices} invoices`} tone="amber" progress={metrics.goal?metrics.outstanding/metrics.goal*100:0}/></section>}
function Metric({label,value,note,tone,progress}:{label:string;value:string;note:string;tone:string;progress:number}){return <article className={`metric ${tone}`}><div><p>{label}</p></div><strong>{value}</strong><small>{note}</small><div className="metric-bar"><i style={{width:pct(progress)}}/></div></article>}
function PanelHeader({eyebrow,title,action,onClick}:{eyebrow:string;title:string;action?:string;onClick?:()=>void}){return <header className="panel-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{action&&<button onClick={onClick}>{action} <span>→</span></button>}</header>}

function TaskStatusControls({task,save,notify,setEditor,compact=false,hideCompletion=false}:{task:Row;save:Save;notify:(s:string)=>void;setEditor:(x:EditorTarget)=>void;compact?:boolean;hideCompletion?:boolean}){
  const savedStatus = taskStatus(task.status);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);
  function closeMenu() {
    if (!menu.current?.open) return;
    menu.current.open = false;
    menu.current.querySelector("summary")?.focus();
  }
  const status = pendingStatus ?? savedStatus;
  const [menuBusy, setBusy] = useState(false);
  const busy = menuBusy || pendingStatus !== null;
  const update = async (next: string) => {
    if (busy || next === status) return;
    setPendingStatus(next);
    if (menu.current) menu.current.open = false;
    try {
      await save("tasks", "update", { id: task.id, expectedUpdatedAt: task.updatedAt, data: { status: next } });
      notify(next === "Completed" ? "Task completed · progress updated" : `Task moved to ${next}`);
    } catch (error) {
      notify(`Status restored · ${friendlyError(error, "update failed")}`);
    } finally {
      setPendingStatus(null);
    }
  };
  const toggle=()=>update(status==="Completed"?reopenStatus(task.previousStatus):"Completed");
  if(compact)return <div className={`task-status-controls compact ${status==="Completed"?"is-completed":""}`} onClick={event=>event.stopPropagation()}><button className="task-complete-toggle" aria-label={status==="Completed"?`Reopen ${rowLabel(task)}`:`Complete ${rowLabel(task)}`} aria-pressed={status==="Completed"} disabled={busy} onClick={toggle}><span>✓</span></button></div>;
  return <div className={`task-status-controls ${compact?"compact":""} ${status==="Completed"?"is-completed":""}`} onClick={event=>event.stopPropagation()}>
    {!hideCompletion&&<button className="task-complete-toggle" aria-label={status==="Completed"?`Reopen ${rowLabel(task)}`:`Complete ${rowLabel(task)}`} aria-pressed={status==="Completed"} disabled={busy} onClick={toggle}><span>✓</span></button>}
    <label className={`task-status status-${status.toLowerCase().replace(/\s+/g,"-")}`}><span className="sr-only">Status for {rowLabel(task)}</span><select aria-label={`Status for ${rowLabel(task)}`} value={status} disabled={busy} onChange={event=>update(event.target.value)}>{TASK_STATUSES.map(item=><option key={item}>{item}</option>)}</select></label>
    <details className="task-menu" ref={menu} onToggle={e=>setMenuOpen(e.currentTarget.open)}
      onBlur={e=>{if(e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open=false;}}
      onKeyDown={e=>{if(e.key==="Escape" && e.currentTarget.open){e.preventDefault();e.stopPropagation();closeMenu();}}}><summary aria-label={`Actions for ${rowLabel(task)}`}>•••</summary><div onClickCapture={closeMenu}><button onClick={()=>setEditor({entity:"tasks",row:task})}>Open task</button><button onClick={()=>setEditor({entity:"tasks",row:task})}>Edit details</button><button onClick={()=>update("Completed")}>Mark complete</button><button onClick={()=>update("Blocked")}>Mark blocked</button><button onClick={async()=>{if(busy)return;setBusy(true);try{await save("tasks","duplicate",{id:task.id});notify("Task duplicated")}catch(error){notify(friendlyError(error,"Unable to duplicate task"))}finally{setBusy(false)}}}>Duplicate</button><button className="danger" onClick={async()=>{if(busy||!confirm(`Delete ${rowLabel(task)}?`))return;setBusy(true);try{await save("tasks","delete",{id:task.id});notify("Task deleted")}catch(error){notify(friendlyError(error,"Unable to delete task"))}finally{setBusy(false)}}}>Delete</button></div></details>
  </div>
}

function Manager({entities,data,setEditor,save,notify}:{entities:string[];data:DataSet;setEditor:(x:EditorTarget)=>void;save:Save;notify:(s:string)=>void}){const available=entities.filter(x=>configs[x]);const[selected,setSelected]=useState(available[0]??"");const entity=available.includes(selected)?selected:(available[0]??"");if(!entity)return null;return <section className="panel data-manager"><div className="manager-tabs" role="group" aria-label="Record collections">{available.map(item=><button aria-pressed={entity===item} className={entity===item?"active":""} key={item} onClick={()=>setSelected(item)}>{titleFor(item)} <span>{data[item]?.length??0}</span></button>)}</div>{entity==="tasks"?<TaskCollection rows={data.tasks??[]} data={data} setEditor={setEditor} save={save} notify={notify}/>:<Collection key={entity} entity={entity} rows={data[entity]??[]} setEditor={setEditor} save={save} notify={notify}/>}</section>}

function TaskCollection({rows,data,setEditor,save,notify}:{rows:Row[];data:DataSet;setEditor:(x:EditorTarget)=>void;save:Save;notify:(s:string)=>void}){
  const[q,setQ]=useState(""),[status,setStatus]=useState("All"),[objective,setObjective]=useState("All"),[sprint,setSprint]=useState("All"),[project,setProject]=useState("All"),[client,setClient]=useState("All"),[week,setWeek]=useState("All"),[sort,setSort]=useState("priority"),[showCompleted,setShowCompleted]=useState(true);
  const priority:Record<string,number>={Urgent:0,High:1,Medium:2,Low:3},statusOrder=Object.fromEntries(TASK_STATUSES.map((item,index)=>[item,index])),lookup=(entity:string,id:unknown)=>(data[entity]??[]).find(row=>row.id===id),weeks=Array.from(new Set((data.launchObjectives??[]).map(row=>String(row.weekNumber??"")).filter(Boolean))).sort((a,b)=>Number(a)-Number(b));
  const shown=rows.filter(row=>{const current=String(row.status??"To do"),objectiveRow=lookup("launchObjectives",row.objectiveId),overdue=Boolean(row.dueDate&&String(row.dueDate)<today()&&!CLOSED_TASK_STATUSES.includes(current));if(!showCompleted&&current==="Completed")return false;if(status==="Active"&&CLOSED_TASK_STATUSES.includes(current))return false;if(status==="Overdue"&&!overdue)return false;if(!["All","Active","Overdue"].includes(status)&&current!==status)return false;if(objective!=="All"&&row.objectiveId!==objective)return false;if(sprint!=="All"&&row.sprintId!==sprint)return false;if(project!=="All"&&row.projectId!==project)return false;if(client!=="All"&&row.clientId!==client)return false;if(week!=="All"&&String(objectiveRow?.weekNumber??"")!==week)return false;return !q||JSON.stringify(row).toLowerCase().includes(q.toLowerCase())}).sort((a,b)=>sort==="priority"?(priority[String(a.priority)]??4)-(priority[String(b.priority)]??4):sort==="due"?String(a.dueDate??"9999").localeCompare(String(b.dueDate??"9999")):sort==="status"?(statusOrder[String(a.status)]??99)-(statusOrder[String(b.status)]??99):sort==="created"?String(b.createdAt??"").localeCompare(String(a.createdAt??"")):String(b.updatedAt??"").localeCompare(String(a.updatedAt??"")));
  const relationSelect=(label:string,value:string,setValue:(v:string)=>void,entity:string)=><select aria-label={label} value={value} onChange={event=>setValue(event.target.value)}><option value="All">{label}</option>{(data[entity]??[]).map(row=><option value={row.id} key={row.id}>{rowLabel(row)}</option>)}</select>;
  return <><div className="manager-toolbar task-toolbar connected-task-toolbar"><div><input value={q} onChange={event=>setQ(event.target.value)} aria-label="Search tasks" placeholder="Search tasks…"/><select aria-label="Filter by status" value={status} onChange={event=>setStatus(event.target.value)}>{["All","Active",...TASK_STATUSES,"Overdue"].map(item=><option key={item}>{item}</option>)}</select>{relationSelect("All objectives",objective,setObjective,"launchObjectives")}{relationSelect("All sprints",sprint,setSprint,"sprints")}{relationSelect("All projects",project,setProject,"projects")}{relationSelect("All clients",client,setClient,"clients")}<select aria-label="Filter by week" value={week} onChange={event=>setWeek(event.target.value)}><option value="All">All weeks</option>{weeks.map(item=><option key={item} value={item}>Week {item}</option>)}</select><select aria-label="Sort tasks" value={sort} onChange={event=>setSort(event.target.value)}><option value="priority">Priority</option><option value="due">Due date</option><option value="status">Status</option><option value="updated">Recently updated</option><option value="created">Date created</option></select><label className="show-completed"><input type="checkbox" checked={showCompleted} onChange={event=>setShowCompleted(event.target.checked)}/><span>Show completed</span></label></div><button className="secondary-button compact" onClick={()=>setEditor({entity:"tasks"})}>＋ Add task</button></div><div className="data-table connected-task-table"><div className="data-head"><span></span><span>Task</span><span>Status</span><span>Objective</span><span>Connected records</span><span>Due</span></div>{shown.map(task=>{const objectiveRow=lookup("launchObjectives",task.objectiveId),connections=[["sprints",task.sprintId],["projects",task.projectId],["clients",task.clientId]].map(([entity,id])=>id?lookup(String(entity),id):undefined).filter(Boolean) as Row[];return <div className={`data-row ${task.status==="Completed"?"completed-row":""}`} key={task.id} role="group" aria-label={rowLabel(task)}><TaskStatusControls task={task} save={save} notify={notify} setEditor={setEditor} compact/><button className="record-main" onClick={()=>setEditor({entity:"tasks",row:task})}><strong>{rowLabel(task)}</strong><small>{String(task.priority??"Medium")} priority{task.assignee?` · ${String(task.assignee)}`:""}</small></button><TaskStatusControls task={task} save={save} notify={notify} setEditor={setEditor} hideCompletion/>{objectiveRow?<button className="objective-link" onClick={()=>setEditor({entity:"launchObjectives",row:objectiveRow})}><span>W{String(objectiveRow.weekNumber??"—")}</span>{rowLabel(objectiveRow)}</button>:<span className="unlinked-label">No objective</span>}<span className="connection-labels"><span className="cell-label">Connected records</span>{connections.length?connections.map(row=><em key={row.id}>{rowLabel(row)}</em>):"—"}</span><span><span className="cell-label">Due</span>{dateLabel(task.dueDate)}</span></div>})}{!shown.length&&<div className="empty-inline"><p>No tasks match these filters.</p><button onClick={()=>setEditor({entity:"tasks"})}>Add a task →</button></div>}</div></>
}
function Collection({entity,rows,setEditor,save,notify}:{entity:string;rows:Row[];setEditor:(x:EditorTarget)=>void;save:Save;notify:(s:string)=>void}){const isTranscript=entity==="aiConversations",isTasks=entity==="tasks",[q,setQ]=useState(""),[status,setStatus]=useState("All"),[sort,setSort]=useState(isTasks?"priority":"updated"),[showCompleted,setShowCompleted]=useState(true);const statuses=isTasks?["All","Active",...TASK_STATUSES,"Overdue"]:["All",...Array.from(new Set(rows.map(row=>String((entity==="leads"?row.stage:row.settlementStatus??row.status)??row.category??"Active"))))];const priority:Record<string,number>={Urgent:0,High:1,Medium:2,Low:3};const statusOrder=Object.fromEntries(TASK_STATUSES.map((item,index)=>[item,index]));const matches=(row:Row)=>{const current=String((entity==="leads"?row.stage:row.settlementStatus??row.status)??row.category??"Active"),overdue=Boolean(row.dueDate&&String(row.dueDate)<today()&&!CLOSED_TASK_STATUSES.includes(current));if(isTasks&&!showCompleted&&current==="Completed")return false;if(isTasks&&status==="Active"&&CLOSED_TASK_STATUSES.includes(current))return false;if(isTasks&&status==="Overdue"&&!overdue)return false;if(!(isTasks?["All","Active","Overdue"]:["All"]).includes(status)&&current!==status)return false;return !q||JSON.stringify(row).toLowerCase().includes(q.toLowerCase())};const shown=rows.filter(matches).sort((a,b)=>sort==="priority"?(priority[String(a.priority)]??4)-(priority[String(b.priority)]??4):sort==="due"?String(a.dueDate??"9999").localeCompare(String(b.dueDate??"9999")):sort==="status"?(statusOrder[String(a.status)]??99)-(statusOrder[String(b.status)]??99):sort==="created"?String(b.createdAt??"").localeCompare(String(a.createdAt??"")):sort==="name"?rowLabel(a).localeCompare(rowLabel(b)):sort==="oldest"?String(a.updatedAt??"").localeCompare(String(b.updatedAt??"")):String(b.updatedAt??"").localeCompare(String(a.updatedAt??"")));return <><div className={`manager-toolbar ${isTasks?"task-toolbar":""}`}><div><input value={q} onChange={e=>setQ(e.target.value)} aria-label={`Search ${titleFor(entity).toLowerCase()}`} placeholder={`Search ${titleFor(entity).toLowerCase()}…`}/><select aria-label={isTasks?"Filter tasks":"Filter records"} value={status} onChange={e=>setStatus(e.target.value)}>{statuses.map(item=><option key={item}>{item}</option>)}</select><select aria-label={isTasks?"Sort tasks":"Sort records"} value={sort} onChange={e=>setSort(e.target.value)}>{isTasks?<><option value="priority">Priority</option><option value="due">Due date</option><option value="status">Status</option><option value="updated">Recently updated</option><option value="created">Date created</option></>:<><option value="updated">Recently updated</option><option value="oldest">Oldest updated</option><option value="name">Name A–Z</option></>}</select>{isTasks&&<label className="show-completed"><input type="checkbox" checked={showCompleted} onChange={e=>setShowCompleted(e.target.checked)}/><span>Show completed</span></label>}</div>{!isTranscript&&<button className="secondary-button compact" onClick={()=>setEditor({entity})}>＋ Add record</button>}</div><div className={`data-table ${isTasks?"task-data-table":""}`}><div className="data-head"><span></span><span>Record</span><span>Status / type</span><span>Date</span><span>Connected value</span><span></span></div>{shown.map(row=><div className={`data-row ${isTasks&&row.status==="Completed"?"completed-row":""}`} key={row.id} role="group" aria-label={rowLabel(row)}>{isTasks?<TaskStatusControls task={row} save={save} notify={notify} setEditor={setEditor} compact/>:<span className="record-glyph" aria-hidden="true">◇</span>}<button className="record-main" onClick={()=>setEditor({entity,row})}><strong>{rowLabel(row)}</strong><small>{String(row.company??row.category??row.platform??row.goal??row.shortDescription??row.description??"").slice(0,72)}</small></button>{isTasks?<TaskStatusControls task={row} save={save} notify={notify} setEditor={setEditor}/>:<span><span className="cell-label">Status / type</span>{String((entity==="leads"?row.stage:row.settlementStatus??row.status)??row.category??"Active")}</span>}<span><span className="cell-label">Date</span>{dateLabel(row.dueDate??row.startDate??row.date??row.updatedAt)}</span><span><span className="cell-label">Connected value</span>{typeof row.balance==="number"?money(row.balance)+" due":typeof row.amount==="number"?money(row.amount):typeof row.progress==="number"?pct(row.progress):row.completionPercentage!==undefined?pct(row.completionPercentage):String(row.priority??row.tags??"—")}</span>{isTasks?<span className="task-completed-at">{row.status==="Completed"&&row.completedAt?`Completed ${dateLabel(row.completedAt)}`:""}</span>:isTranscript?<button onClick={()=>setEditor({entity,row})}>View transcript</button>:<div className="row-actions">{entity==="documents"&&<DocumentLinks row={row}/>}<button onClick={()=>setEditor({entity,row})}>Edit</button>{!["invoices","payments","revenueGoals"].includes(entity)&&<button onClick={async()=>{try{await save(entity,"duplicate",{id:row.id,expectedUpdatedAt:row.updatedAt});notify("Record duplicated")}catch(e){notify(friendlyError(e,"Unable to duplicate"))}}}>Duplicate</button>}</div>}</div>)}{!shown.length&&<div className="empty-inline"><p>No {titleFor(entity).toLowerCase()} found.</p>{!isTranscript&&<button onClick={()=>setEditor({entity})}>Add the first record →</button>}</div>}</div></>}

function suggestedValues(entity: string, data: DataSet) {
  const values: Record<string, unknown> = {};
  for (const field of configs[entity] ?? []) {
    if (field.options) values[field.key] = field.options[0];
    if (field.type === "checkbox") values[field.key] = false;
    if (field.type === "number" && !field.required && field.key !== "weekNumber") values[field.key] = 0;
  }
  const defaults: Record<string, Record<string, unknown>> = {
    clients: {status: "Onboarding"}, launchObjectives: {priority: "High"}, launchPhases: {phaseNumber: 1},
    knowledge: {category: "General"}, teamMembers: {role: "Member"},
    skills: {category: "Engineering quality", proficiency: "Working", portfolioVisible: true},
    services: {portfolioVisible: true, callToAction: "Start a conversation"},
    acquisitionChannels: {priority: "Medium"}, testimonials: {status: "Requested"},
    expenses: {category: "Operations", taxDeductible: true, incurredAt: today()},
    payments: {paidAt: today()}, revenueGoals: {period: today().slice(0, 7)},
    dailyJournal: {date: today()}, timeEntries: {date: today()},
  };
  Object.assign(values, defaults[entity]);
  if (entity === "tasks") {
    const client = data.clients.find(x => String(x.tags ?? "").includes("internal"));
    const project = client && data.projects.find(x => x.clientId === client.id && String(x.name).includes("Internal"));
    Object.assign(values, {status:"To do", priority:"High", dueDate:today(), assignee:"Alexandria", clientId:client?.id ?? "", projectId:project?.id ?? ""});
  }
  if (entity === "projects") Object.assign(values, {status:"Planning", progress:0, startDate:today(), dueDate:addDays(today(),30)});
  if (entity === "invoices") {
    const latest = data.invoices.reduce((largest, x) => Math.max(largest, Number(String(x.number ?? "").replace(/\D/g,"")) || 0), 0);
    const recent = data.invoices.find(x => x.issueDate && x.dueDate && Number.isFinite(Date.parse(String(x.dueDate)) - Date.parse(String(x.issueDate))));
    const term = recent ? Math.max(1, Math.round((Date.parse(String(recent.dueDate)) - Date.parse(String(recent.issueDate)))/86400000)) : 14;
    Object.assign(values, {number:`INV-${String(latest + 1).padStart(4,"0")}`, status:"Draft", issueDate:today(), dueDate:addDays(today(),term), tax:0});
  }
  if (entity === "leads") Object.assign(values, {stage:"New", status:"Open", urgency:"Medium", probability:10, serviceId:data.services.find(x => x.status === "Active")?.id ?? ""});
  if (entity === "sprints") Object.assign(values, {startDate:today(), endDate:addDays(today(),12), duration:"13", status:data.sprints.some(x => x.status === "Active") ? "Planned" : "Active"});
  if (entity === "sprintObjectives") Object.assign(values, {sprintId:activeSprint(data.sprints)?.id ?? "", dayNumber:1, status:"To do"});
  if (entity === "dailyReviews") Object.assign(values, {sprintId:activeSprint(data.sprints)?.id ?? "", date:today()});
  return values;
}

function Editor({entity,row,initial,open,data,close,save,notify}:EditorTarget & {open:(target:EditorTarget)=>void;data:DataSet;close:()=>void;save:Save;notify:(s:string)=>void}){
  const fields = configs[entity] ?? [];
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [textFile, setTextFile] = useState<File>(), [pickedFile, setPickedFile] = useState(false);
  const formRef = useRef<HTMLFormElement>(null), alertRef = useRef<HTMLDivElement>(null);
  const draft = useRecordDraft(useContext(WorkspaceId), {entity,row,initial}, fields, () =>
    ({...(row ?? suggestedValues(entity,data)), ...initial, ...(row?.recordedStatus ? {status:row.recordedStatus} : {})}));
  const {values} = draft;
  const atRisk = Boolean(textFile || pickedFile || (draft.hasDraft && draft.problem));
  function canLeave() {
    return !busy && (!atRisk || window.confirm("Some changes are only in this editor. Leave and discard those changes?"));
  }
  function dismiss() { if (canLeave()) close(); }
  useEffect(() => {
    if (!atRisk) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [atRisk]);
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || draft.stale) return;
    const {errors: invalid, first} = validateForm(event.currentTarget);
    setErrors(invalid); setError("");
    if (first) { first.focus(); return; }
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        const {key, type} = field, value = values[key];
        if (type === "file" || (key === "status" && (entity === "launchObjectives" || (entity === "sprintObjectives" && values.taskId)))) continue;
        if (row && value === (key === "status" ? row.recordedStatus ?? row.status : row[key])) continue;
        if (entity === "documents" && key === "name" && !row && !String(value ?? "").trim()) continue;
        if (entity === "launchObjectives" && key === "weekNumber" && (value == null || value === "")) {
          if (row) payload[key] = null;
        } else if (type === "number" && !row && (value === "" || value == null)) continue;
        else if (type === "checkbox") payload[key] = Boolean(value);
        else if (type === "number") payload[key] = Number(value || 0);
        else payload[key] = browserFieldValue(field, value);
      }
      if (entity === "sprints" && payload.duration === "Custom") payload.duration = sprintDays(String(values.startDate), String(values.endDate));
      const file = form.get("file");
      const attachment = textFile ?? (file instanceof File && file.name ? file : undefined);
      if (textFile && textFile.size > maxTextEditBytes) throw new Error("Text edits support files up to 1 MiB.");
      if (row && !Object.keys(payload).length && !attachment) { draft.clear(); close(); return; }
      await save(entity, row ? "update" : "create", { ...(row ? { id: row.id, expectedUpdatedAt: row.updatedAt } : {}), data: payload, attachment });
      const cleared = draft.clear();
      notify(cleared ? `${titleFor(entity).replace(/s$/,'')} saved · dashboards updated` : "Record saved. This browser could not clear the local draft.");
      close();
    } catch (reason) { setError(friendlyError(reason, "Unable to save")); }
    finally { setBusy(false); }
  }
  function changeField(field: Field, value: unknown) {
    const current = values;
    const next = { ...current, [field.key]: value };
    if (entity === "sprints") {
      if ((field.key === "duration" || field.key === "startDate") && next.startDate && next.duration !== "Custom" && Number(next.duration)>0) {
        next.endDate = sprintEnd(String(next.startDate), Number(next.duration));
      }
      if (field.key === "endDate") next.duration = "Custom";
    }
    if (entity === "leads" && field.key === "stage") {
      if (["Won","Lost","Not suitable"].includes(String(value))) next.status = "Closed";
      else if (["Won","Lost","Not suitable"].includes(String(current.stage))) next.status = "Open";
    }
    if (entity === "sprintObjectives" && field.key === "taskId") {
      const linked = data.tasks.find(item => item.id === value);
      if (linked) {
        next.status = linked.status;
        if (linked.sprintId) next.sprintId = linked.sprintId;
      } else if (current.taskId) next.status = data.tasks.find(item => item.id === current.taskId)?.status ?? current.status;
    }
    if (["tasks","documents"].includes(entity) && field.key === "projectId") {
      const project = data.projects.find(item => item.id === value);
      if (project?.clientId) next.clientId = project.clientId;
      if (entity === "tasks" && project?.productId) next.productId = project.productId;
    }
    draft.write(next);
    if (errors[field.key]) setErrors({...errors, [field.key]:""});
  }
  function renderField(field: Field) {
    if (entity === "documents" && field.type === "file") return <DocumentAttachment key={field.key} row={row}
      onTextFile={setTextFile} onPick={setPickedFile} errorMessage={errors.file || errors.documentText}/>;
    if (field.key === "status" && (entity === "launchObjectives" || (entity === "sprintObjectives" && !!values.taskId))) {
      const status = entity === "launchObjectives" ? row?.status ?? "Not started" : data.tasks.find(t => t.id === values.taskId)?.status;
      return <label key={field.key}>Status · from linked tasks<input readOnly value={String(status ?? "To do")}/></label>;
    }
    const custom = entity === "sprints" && field.key === "duration" && !field.options?.includes(String(values.duration));
    const minDate = field.key === "endDate" ? values.startDate : field.key === "endsAt" ? values.startsAt :
      entity === "invoices" && field.key === "dueDate" ? values.issueDate : undefined;
    const displayedField = entity === "documents" && row && field.key === "name" ? {...field, required:true, hint:undefined} : field;
    return <FieldInput key={field.key} entity={entity} field={displayedField} value={custom ? "Custom" : values[field.key]}
      minDate={minDate ? String(minDate) : undefined} error={errors[field.key]} data={data} onChange={value=>changeField(field,value)}/>;
  }
  const latest = row && data[entity]?.find(item => item.id === row.id);
  const identifyingField = fields.find(field => field.required && ["name", "title", "number"].includes(field.key));
  const revisions=(data.revisions??[]).filter(x=>x.entity===entity&&x.recordId===row?.id).slice(0,4),invoiceTotal=entity==="invoices"?(cents(values.amount)+cents(values.tax))/100:null;
  if (entity === "aiConversations" && row) {
    return <WorkspaceDialog titleId="conversation-title" className="modal editor-modal" onDismiss={close}>
      <button className="modal-close" aria-label="Close" onClick={close}>×</button>
      <h2 data-dialog-start tabIndex={-1} id="conversation-title">AI conversation</h2><p>{String(row.prompt)}</p><p>{String(row.response)}</p>
    </WorkspaceDialog>;
  }
  function reopenLatest() {
    if (!latest || !canLeave()) return;
    draft.acceptVersion(String(latest.updatedAt));
    open({entity,row:latest});
  }
  return <WorkspaceDialog titleId="editor-title" className="modal editor-modal" onDismiss={dismiss}
    onSaveShortcut={() => { if (!busy) formRef.current?.requestSubmit(); }}>
    <button className="modal-close" aria-label="Close" disabled={busy} onClick={dismiss}>×</button>
    <p className="eyebrow">SMART {titleFor(entity).toUpperCase()}</p>
    <h2 id="editor-title" data-dialog-start tabIndex={-1}>{row ? `Edit ${rowLabel(row)}` : `Add ${titleFor(entity).replace(/s$/,'')}`}</h2>
    <p className="modal-copy">Fields marked * are required. {entity === "documents" ? "Document details are drafted on this device. Save attachment changes before closing." : "Drafts are kept on this device."} ⌘/Ctrl + Enter to save.</p>
    {draft.problem && <p role="alert" className="form-error">{draft.problem}</p>}
    {draft.stale && <div role="alert" className="form-error">This record changed after your draft was saved. Review the restored fields.
      <button type="button" onClick={() => draft.acceptVersion(String(row?.updatedAt))}>Use these edits with the latest version</button></div>}
    <form ref={formRef} id="smart-editor-form" noValidate onSubmit={submit}>
      <fieldset className="editor-fields" disabled={busy}>
        {identifyingField && renderField(identifyingField)}
        {fields.filter(field => field !== identifyingField).map(renderField)}
      </fieldset>
      {invoiceTotal !== null && <div className="smart-total"><span>Calculated invoice total</span><strong>{money(invoiceTotal)}</strong></div>}
      {Object.values(errors).some(Boolean) && <p className="form-error" role="alert">Check the highlighted fields before saving.</p>}
      {error && <div role="alert" className="form-error" tabIndex={-1} ref={alertRef}>{error}
        {latest && latest.updatedAt !== row?.updatedAt && <button type="button" onClick={reopenLatest}>Reopen latest version</button>}</div>}
      <button className="primary-button form-submit" disabled={busy || draft.stale}>{busy ? "Saving…" : "Save record"} <span aria-hidden="true">→</span></button>
    </form>
    {row && ["leads","clients"].includes(entity) && <HandoffControls entity={entity} row={row} data={data} open={open} save={save} disabled={busy || draft.hasDraft}/>}
    {row && revisions.length > 0 && <div className="revision-history"><p className="eyebrow">REVISION HISTORY</p>{revisions.map(revision=><span key={revision.id}><strong>{String(revision.action)}</strong><small>{dateLabel(revision.createdAt)}</small></span>)}</div>}
    {draft.hasDraft && <button type="button" className="text-action" disabled={busy} onClick={() => {
      if (!confirm("Discard this draft and close the editor?")) return;
      if (draft.clear()) close(); else setError("This browser could not remove the saved draft.");
    }}>Discard draft</button>}
    {row && <button className="danger-button" disabled={busy} onClick={async () => {
      if (busy || !confirm(`Delete ${rowLabel(row)}?`)) return;
      setBusy(true);
      try { await save(entity,"delete",{id:row.id,expectedUpdatedAt:row.updatedAt}); draft.clear(); notify("Record deleted"); close(); }
      catch (e) { setError(friendlyError(e,"Unable to delete")); } finally { setBusy(false); }
    }}>Delete record</button>}
  </WorkspaceDialog>;
}

function Assistant({page,open,close,onSaved,onDenied}:{page:View;open:boolean;close:()=>void;onSaved:()=>void;onDenied:(message:string)=>void}){const[prompt,setPrompt]=useState(""),[answer,setAnswer]=useState(""),[busy,setBusy]=useState(false);const suggestions=page==="Revenue"?["Forecast next month’s income","Which invoices need follow-up?"]:page==="Clients"?["Which clients need attention?","Summarise the most active client"]:page==="Projects"?["Show current project risks","Suggest the next milestone"]:page==="Knowledge Base"?["Summarise all branding decisions","Find everything related to AquaFit"]:page==="Sprints"?["What could block this sprint?","What should I do next?"]:["What should I focus on today?","Show current risks and opportunities"];
  const workspaceId=useContext(WorkspaceId);
  const [error, setError] = useState("");
  async function ask(e:FormEvent) {
    e.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy(true); setError("");
    try {
      const {response, data:json} = await submitCommand(workspaceId,"/api/assistant",{page,prompt});
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) onDenied(json.error || "Workspace access denied");
        throw new Error(json.error || "Unable to load answer");
      }
      setAnswer(json.response); onSaved();
    } catch (e) { setError(friendlyError(e,"Unable to load answer")); } finally { setBusy(false); }
  }
  return <WorkspaceDialog open={open} titleId="assistant-title" className="ai-drawer" onDismiss={close}>
    <header><div><p className="eyebrow purple">CONTEXT · {page.toUpperCase()}</p><h2 id="assistant-title" data-dialog-start tabIndex={-1}>AI Command Panel</h2></div><button aria-label="Close" onClick={close}>×</button></header>
    <p className="ai-context">Answers use the records and relationships available on this page. Missing information is stated clearly.</p>
    <div className="prompt-chips">{suggestions.map(item=><button key={item} onClick={()=>setPrompt(item)}>{item}</button>)}</div>
    <form onSubmit={ask}><label>Ask Founder OS<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Ask about the work, risks, revenue or next action…" required rows={5}/></label>
      <button className="primary-button" disabled={busy || !prompt.trim()}>{busy?"Analysing stored data…":"Run command ✦"}</button></form>
    <div role="status" aria-live="polite">{busy ? "Analysing stored data…" : answer && <div className="assistant-answer">{answer}</div>}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
  </WorkspaceDialog>;
}
