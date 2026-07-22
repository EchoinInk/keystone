import { NextRequest, NextResponse } from "next/server";
import { getRuntimeEnv } from "../../../db/runtime";
import { ensureDatabase } from "../../../db/bootstrap";

type EntityConfig = { table: string; columns: string[]; category: string };

const entities: Record<string, EntityConfig> = {
  leads:{table:"leads",columns:["name","company","email","phone","serviceId","stage","value","probability","nextAction","status","tags","notes","source","projectType","projectDescription","projectState","desiredOutcome","requiredServices","technologyStack","budgetRange","preferredTimeline","decisionMaker","urgency","links","followUpDate","qualificationScore"],category:"Clients"},
  clients:{table:"clients",columns:["leadId","name","company","email","phone","status","tags","notes"],category:"Clients"},
  services:{table:"services",columns:["name","category","shortDescription","description","idealClient","deliverables","technologies","projectSize","pricingModel","typicalTimeline","relatedSkills","relatedProjects","leadChannels","portfolioVisible","callToAction","price","status","notes"],category:"Freelance"},
  products:{table:"products",columns:["name","description","status","progress","nextAction"],category:"Projects"},
  projects:{table:"projects",columns:["clientId","productId","name","description","status","budget","startDate","dueDate","progress"],category:"Projects"},
  proposals:{table:"proposals",columns:["leadId","clientId","title","amount","status","validUntil","body"],category:"Revenue"},
  invoices:{table:"invoices",columns:["clientId","projectId","number","amount","tax","status","issueDate","dueDate","recurring"],category:"Finance"},
  payments:{table:"payments",columns:["invoiceId","amount","paidAt","method","reference"],category:"Revenue"},
  revenueGoals:{table:"revenue_goals",columns:["period","target"],category:"Revenue"},
  tasks:{table:"tasks",columns:["projectId","clientId","productId","sprintId","objectiveId","assignee","title","description","notes","status","previousStatus","completedAt","priority","dueDate","position"],category:"Tasks"},
  notes:{table:"notes",columns:["clientId","projectId","title","body","tags"],category:"Knowledge"},
  meetings:{table:"meetings",columns:["clientId","projectId","title","startsAt","endsAt","location","notes","status"],category:"Clients"},
  calendarEvents:{table:"calendar_events",columns:["title","startsAt","endsAt","type","relatedType","relatedId"],category:"Tasks"},
  content:{table:"content",columns:["title","body","status","platform","publishAt","tags"],category:"Content"},
  knowledge:{table:"knowledge",columns:["title","body","category","tags","links"],category:"Knowledge"},
  documents:{table:"documents",columns:["clientId","projectId","name","objectKey","contentType","size"],category:"Knowledge"},
  teamMembers:{table:"team_members",columns:["name","email","role","status"],category:"Projects"},
  aiConversations:{table:"ai_conversations",columns:["page","prompt","response"],category:"AI"},
  dailyJournal:{table:"daily_journal",columns:["date","title","body","mood"],category:"Knowledge"},
  founderGoals:{table:"founder_goals",columns:["title","description","targetDate","status","progress"],category:"Projects"},
  kpis:{table:"kpis",columns:["name","value","target","unit","period"],category:"Revenue"},
  expenses:{table:"expenses",columns:["description","amount","category","incurredAt","recurring","taxDeductible"],category:"Finance"},
  subscriptions:{table:"subscriptions",columns:["name","amount","billingCycle","nextBillingAt","status"],category:"Finance"},
  milestones:{table:"milestones",columns:["projectId","title","dueDate","status"],category:"Projects"},
  timeEntries:{table:"time_entries",columns:["projectId","taskId","minutes","date","note"],category:"Projects"},
  sprints:{table:"sprints",columns:["name","goal","startDate","endDate","duration","status","successMetrics","aiCoaching","reflectionNotes"],category:"Tasks"},
  sprintObjectives:{table:"sprint_objectives",columns:["sprintId","taskId","title","dayNumber","milestone","dueDate","status"],category:"Tasks"},
  dailyReviews:{table:"daily_reviews",columns:["sprintId","date","wins","challenges","lessons","tomorrowPriorities","aiSummary"],category:"Knowledge"},
  activityLogs:{table:"activity_logs",columns:["category","action","entity","recordId","label","metadata"],category:"AI"},
  revisions:{table:"revisions",columns:["entity","recordId","action","snapshot"],category:"Knowledge"},
  professionalProfiles:{table:"professional_profiles",columns:["name","professionalTitle","location","availability","positioningStatement","valueProposition","corePositioning","contactCta","shortBio","extendedBio","status"],category:"Freelance"},
  skills:{table:"skills",columns:["name","category","proficiency","evidence","portfolioVisible","serviceIds","portfolioProjectIds","status","notes"],category:"Freelance"},
  portfolioProjects:{table:"portfolio_projects",columns:["name","type","description","capability","technologies","role","repositoryId","liveUrl","readiness","status","nextAction","notes"],category:"Freelance"},
  repositories:{table:"repositories",columns:["name","description","portfolioProjectId","githubUrl","liveUrl","displayOrder","pinned","portfolioReady","readiness","readmeStatus","screenshotStatus","demoStatus","installationStatus","featureDocsStatus","buildStatus","technologies","problemSolved","licence","issuesRemaining","lastUpdated","replacementCandidate","qualityNotes"],category:"Freelance"},
  marketingPosts:{table:"marketing_posts",columns:["platformId","title","body","targetAudience","serviceId","status","datePosted","link","responses","leadsGenerated","followUpDate","performanceNotes"],category:"Content"},
  acquisitionChannels:{table:"acquisition_channels",columns:["name","priority","profileStatus","profileUrl","targetServices","targetClientType","frequency","leadsGenerated","conversionRate","revenueGenerated","lastActivity","nextAction","notes"],category:"Freelance"},
  outreachRecords:{table:"outreach_records",columns:["business","contactPerson","website","problemObserved","opportunity","serviceId","channelId","dateContacted","message","response","followUpDate","outcome","leadId","notes"],category:"Freelance"},
  resumeAchievements:{table:"resume_achievements",columns:["title","outcome","evidence","projectId","technologies","status","notes"],category:"Freelance"},
  launchPhases:{table:"launch_phases",columns:["name","phaseNumber","focus","targetDate","progress","status"],category:"Freelance"},
  launchObjectives:{table:"launch_objectives",columns:["phaseId","weekNumber","title","description","priority","dueDate","dependency","status","taskId"],category:"Freelance"},
  testimonials:{table:"testimonials",columns:["projectId","clientId","quote","author","status","requestedAt","receivedAt","permission","notes"],category:"Clients"},
};

const snake=(value:string)=>value.replace(/[A-Z]/g,letter=>`_${letter.toLowerCase()}`);
const camel=(value:string)=>value.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
const mapRow=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[camel(key),value]));
const id=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
const normaliseValue=(key:string,value:unknown)=>key.endsWith("Id")&&value===""?null:value;
const labelFor=(row:Record<string,unknown>|undefined,entity:string)=>String(row?.name??row?.title??row?.number??row?.description??entity.replace(/([A-Z])/g," $1"));

async function loadAll(){
  const env=getRuntimeEnv();
  const keys=Object.keys(entities);
  const results=await env.DB.batch(keys.map(key=>env.DB.prepare(`SELECT * FROM ${entities[key].table} ORDER BY updated_at DESC`)));
  const data=Object.fromEntries(keys.map((key,index)=>[key,(results[index].results??[]).map(row=>mapRow(row as Record<string,unknown>))]));
  const taskRows=data.tasks??[],tasks=new Map(taskRows.map((task:Record<string,unknown>)=>[String(task.id),task]));
  data.launchObjectives=(data.launchObjectives??[]).map((objective:Record<string,unknown>)=>{const linked=taskRows.filter((task:Record<string,unknown>)=>task.objectiveId===objective.id),countable=linked.filter((task:Record<string,unknown>)=>task.status!=="Cancelled"),completed=countable.filter((task:Record<string,unknown>)=>task.status==="Completed").length,blocked=countable.some((task:Record<string,unknown>)=>task.status==="Blocked"),started=countable.some((task:Record<string,unknown>)=>["In progress","In review","Completed"].includes(String(task.status))),status=!countable.length?"Not started":completed===countable.length?"Completed":blocked?"Blocked":started?"In progress":"Not started";return{...objective,status,taskCount:countable.length,completedTaskCount:completed,remainingTaskCount:Math.max(0,countable.length-completed),progressPercentage:countable.length?Math.round(completed/countable.length*100):0}});
  data.sprints=(data.sprints??[]).map((sprint:Record<string,unknown>)=>{
    const objectives=(data.sprintObjectives??[]).filter((item:Record<string,unknown>)=>item.sprintId===sprint.id);
    const sprintTasks=new Map(taskRows.filter((task:Record<string,unknown>)=>task.sprintId===sprint.id&&task.status!=="Cancelled").map((task:Record<string,unknown>)=>[String(task.id),task]));
    for(const objective of objectives){const linked=objective.taskId?tasks.get(String(objective.taskId)):undefined;if(linked&&linked.status!=="Cancelled")sprintTasks.set(String(linked.id),linked)}
    const standalone=objectives.filter((item:Record<string,unknown>)=>!item.taskId),completedTasks=[...sprintTasks.values()].filter((task:Record<string,unknown>)=>task.status==="Completed").length,complete=completedTasks+standalone.filter((item:Record<string,unknown>)=>item.status==="Completed").length,total=sprintTasks.size+standalone.length;
    return {...sprint,objectiveCount:total,completedObjectives:complete,completionPercentage:total?Math.round(complete/total*100):0};
  });
  data.projects=(data.projects??[]).map((project:Record<string,unknown>)=>{const related=(data.tasks??[]).filter((task:Record<string,unknown>)=>task.projectId===project.id&&task.status!=="Cancelled");const completed=related.filter((task:Record<string,unknown>)=>task.status==="Completed").length;return related.length?{...project,progress:Math.round(completed/related.length*100)}:project});
  return data;
}

function calculate(data:Record<string,Array<Record<string,unknown>>>){
  const month=new Date().toISOString().slice(0,7),today=new Date().toISOString().slice(0,10);
  const payments=data.payments??[],invoices=data.invoices??[],leads=data.leads??[],expenses=data.expenses??[],goals=data.revenueGoals??[];
  const revenue=payments.filter(x=>String(x.paidAt).startsWith(month)).reduce((sum,x)=>sum+Number(x.amount||0),0);
  const totalRevenue=payments.reduce((sum,x)=>sum+Number(x.amount||0),0);
  const paymentByInvoice=new Map<string,number>(); payments.forEach(x=>paymentByInvoice.set(String(x.invoiceId),(paymentByInvoice.get(String(x.invoiceId))??0)+Number(x.amount||0)));
  const outstanding=invoices.reduce((sum,invoice)=>sum+Math.max(0,Number(invoice.amount||0)+Number(invoice.tax||0)-(paymentByInvoice.get(String(invoice.id))??0)),0);
  const weightedPipeline=leads.filter(x=>!["Won","Lost","Closed"].includes(String(x.stage))).reduce((sum,lead)=>sum+Number(lead.value||0)*Number(lead.probability||0)/100,0);
  const pipelineValue=leads.filter(x=>!["Lost","Closed"].includes(String(x.stage))).reduce((sum,lead)=>sum+Number(lead.value||0),0);
  const monthExpenses=expenses.filter(x=>String(x.incurredAt).startsWith(month)).reduce((sum,x)=>sum+Number(x.amount||0),0);
  const goal=Number(goals.find(x=>x.period===month)?.target||0);
  const history=Array.from({length:6},(_,offset)=>{const date=new Date();date.setMonth(date.getMonth()-(5-offset));const period=date.toISOString().slice(0,7);return{period,value:payments.filter(x=>String(x.paidAt).startsWith(period)).reduce((sum,x)=>sum+Number(x.amount||0),0)}});
  const dueTasks=(data.tasks??[]).filter(x=>!["Completed","Cancelled"].includes(String(x.status))&&x.dueDate&&String(x.dueDate)<=today).length;
  const upcomingMeetings=(data.meetings??[]).filter(x=>String(x.startsAt)>=new Date().toISOString()).length;
  return{month,revenue,totalRevenue,outstanding,weightedPipeline,pipelineValue,monthExpenses,profit:revenue-monthExpenses,goal,goalProgress:goal?Math.min(100,Math.round(revenue/goal*100)):0,history,dueTasks,upcomingMeetings,activeClients:(data.clients??[]).filter(x=>x.status==="Active").length,openInvoices:invoices.filter(x=>!["Paid","Void"].includes(String(x.status))).length};
}

async function recordRevision(entity:string,recordId:string,action:string,snapshot:Record<string,unknown>){
  const env=getRuntimeEnv(),timestamp=now();
  await env.DB.prepare("INSERT INTO revisions (id, entity, record_id, action, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id(),entity,recordId,action,JSON.stringify(snapshot),timestamp,timestamp).run();
}

async function recordActivity(config:EntityConfig,entity:string,recordId:string|undefined,action:string,row?:Record<string,unknown>){
  if(entity==="activityLogs"||entity==="revisions")return;
  const env=getRuntimeEnv(),timestamp=now();
  const verbs:Record<string,string>={create:"created",update:"updated",duplicate:"duplicated",delete:"deleted",bulkDelete:"deleted"};
  const label=entity==="tasks"&&action==="update"&&row?.status?`${labelFor(row,entity)} moved to ${String(row.status)}`:`${labelFor(row,entity)} ${verbs[action]??action}`;
  await env.DB.prepare("INSERT INTO activity_logs (id, category, action, entity, record_id, label, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id(),config.category,action,entity,recordId??null,label,JSON.stringify({source:"Founder OS"}),timestamp,timestamp).run();
}

async function syncLaunchObjectiveStatuses(){const env=getRuntimeEnv(),objectives=await env.DB.prepare("SELECT id FROM launch_objectives").all<{id:string}>(),timestamp=now();for(const objective of objectives.results){const linked=await env.DB.prepare("SELECT status FROM tasks WHERE objective_id=? AND status!='Cancelled'").bind(objective.id).all<{status:string}>(),statuses=linked.results.map(item=>item.status),completed=statuses.filter(status=>status==="Completed").length,status=!statuses.length?"Not started":completed===statuses.length?"Completed":statuses.includes("Blocked")?"Blocked":statuses.some(value=>["In progress","In review","Completed"].includes(value))?"In progress":"Not started";await env.DB.prepare("UPDATE launch_objectives SET status=?, updated_at=? WHERE id=?").bind(status,timestamp,objective.id).run()}}

export async function GET(){try{await ensureDatabase();const data=await loadAll();return NextResponse.json({data,metrics:calculate(data)});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load Founder OS data"},{status:500});}}

export async function POST(request:NextRequest){
  try{
    await ensureDatabase();const env=getRuntimeEnv();
    const body=await request.json() as{action?:string;entity?:string;id?:string;ids?:string[];data?:Record<string,unknown>};
    const entity=body.entity??"",config=entities[entity];if(!config)return NextResponse.json({error:"Unknown data model"},{status:400});
    let recordId=body.id,row:Record<string,unknown>|undefined;
    if(body.action==="delete"||body.action==="bulkDelete"){
      const ids=body.ids??(body.id?[body.id]:[]);if(!ids.length)return NextResponse.json({error:"No records selected"},{status:400});
      const existing=await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(ids[0]).first<Record<string,unknown>>();
      if(existing)await recordRevision(entity,ids[0],"delete",mapRow(existing));
      await env.DB.prepare(`DELETE FROM ${config.table} WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(...ids).run();
      row=existing?mapRow(existing):undefined;recordId=ids[0];
    }else if(body.action==="update"){
      if(!body.id)return NextResponse.json({error:"Missing record id"},{status:400});
      if(entity==="sprintObjectives"&&body.data?.sprintId==="")return NextResponse.json({error:"Choose a sprint for this daily objective"},{status:400});
      const existing=await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(body.id).first<Record<string,unknown>>();
      if(existing)await recordRevision(entity,body.id,"update",mapRow(existing));
      if(entity==="tasks"&&body.data?.status){const nextStatus=String(body.data.status),oldStatus=String(existing?.status??"To do");if(!["Backlog","To do","In progress","Blocked","In review","Completed","Cancelled"].includes(nextStatus))return NextResponse.json({error:"Unknown task status"},{status:400});if(nextStatus==="Completed"){body.data.previousStatus=oldStatus==="Completed"?String(existing?.previous_status??"To do"):oldStatus;body.data.completedAt=now()}else{body.data.completedAt=null;if(nextStatus!=="Cancelled")body.data.previousStatus=nextStatus}}
      const entries=Object.entries(body.data??{}).filter(([key])=>config.columns.includes(key));if(!entries.length)return NextResponse.json({error:"Nothing to update"},{status:400});
      await env.DB.prepare(`UPDATE ${config.table} SET ${entries.map(([key])=>`${snake(key)} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...entries.map(([key,value])=>normaliseValue(key,value)),now(),body.id).run();
      row={...(existing?mapRow(existing):{}),...(body.data??{})};recordId=body.id;
    }else{
      const source={...(body.data??{})};
      if(entity==="sprintObjectives"&&!source.sprintId)return NextResponse.json({error:"Choose a sprint for this daily objective"},{status:400});
      if(body.action==="duplicate"&&body.id){const existing=await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(body.id).first<Record<string,unknown>>();if(!existing)return NextResponse.json({error:"Record not found"},{status:404});Object.assign(source,mapRow(existing),{name:existing.name?`${existing.name} copy`:undefined,title:existing.title?`${existing.title} copy`:undefined});if(entity==="tasks")Object.assign(source,{status:"To do",previousStatus:"To do",completedAt:null});}
      const entries=Object.entries(source).filter(([key])=>config.columns.includes(key));recordId=id();const timestamp=now();
      const columns=["id",...entries.map(([key])=>snake(key)),"created_at","updated_at"];
      await env.DB.prepare(`INSERT INTO ${config.table} (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).bind(recordId,...entries.map(([key,value])=>normaliseValue(key,value)??null),timestamp,timestamp).run();
      row={id:recordId,...source};await recordRevision(entity,recordId,"create",row);
    }
    if(entity==="tasks")await syncLaunchObjectiveStatuses();
    await recordActivity(config,entity,recordId,body.action??"create",row);
    const data=await loadAll();return NextResponse.json({data,metrics:calculate(data)});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to save record"},{status:500});}
}
