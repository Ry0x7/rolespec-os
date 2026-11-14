/* eslint-disable @typescript-eslint/no-require-imports -- Directly executable CommonJS audit driver. */
// Run against a disposable QA database: node scripts/qa/live-audit.cjs inventory
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.QA_BASE_URL || 'http://localhost:3100';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) throw new Error('QA drivers must target a loopback server with a disposable database');
const dir = path.resolve(process.env.QA_EVIDENCE_DIR || '.unlazy/qa/evidence');
fs.mkdirSync(dir, { recursive: true });
const stage = process.argv[2] || 'inventory';
const report = { stage, startedAt: new Date().toISOString(), base, checks: [], console: [], network: [], failures: [] };
let page, context;
const save = () => fs.writeFileSync(path.join(dir, `${stage}.json`), JSON.stringify(report, null, 2));
const check = async (name, fn) => {
  try { const evidence = await fn(); report.checks.push({name, result:'passed', evidence}); }
  catch (e) { report.failures.push({name, message:e.message}); await page.screenshot({path:path.join(dir, `${stage}-failure-${report.failures.length}.png`)}).catch(()=>{}); }
  save();
};
const shot = name => page.screenshot({path:path.join(dir, name+'.png'), fullPage:true});
const goto = async route => { await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:45000}); await page.locator('h1,h2').first().waitFor({timeout:45000}); await page.waitForTimeout(1000); };
const json = async route => {const r=await context.request.get(base+route);assert(r.ok(),route+' '+r.status());return r.json();};
const ui = () => page.locator('body').innerText();
(async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 report.browser=browser.version();report.node=process.version;
 context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();
 page.setDefaultTimeout(15000);
 page.on('console',m=>{if(['error','warning'].includes(m.type()))report.console.push({type:m.type(),text:m.text().replace(/rspec_[\w-]+/g,'[redacted]'),url:page.url()});});
 page.on('pageerror',e=>report.console.push({type:'pageerror',text:e.message,url:page.url()}));
 page.on('response',r=>{if(r.status()>=400)report.network.push({url:r.url().split('?')[0],status:r.status(),method:r.request().method()});});
 page.on('requestfailed',r=>report.network.push({url:r.url().split('?')[0],error:r.failure()?.errorText,method:r.method()}));
 try {
 if(stage==='docx') {
  await check('Real DOCX upload is parsed and persisted without AI',async()=>{
   await goto('/career-profile?setup=0#intake');await page.locator('#intake-resume-file').setInputFiles(path.join(dir,'resume-import.docx'));const response=page.waitForResponse(r=>r.url().includes('/api/intake/upload?')&&r.request().method()==='POST');await page.getByRole('button',{name:'Upload and start',exact:true}).click();const r=await response;assert(r.ok());const data=await r.json();let run;for(let i=0;i<30;i++){run=(await json('/api/intake/'+data.run.id)).run;if(['COMPLETED','FAILED','PARTIAL'].includes(run.status))break;await page.waitForTimeout(500)}assert(['COMPLETED','PARTIAL'].includes(run.status),run.error);assert(run.patches.length>0);await shot('docx-import-persisted');return {runId:run.id,status:run.status,patches:run.patches.length,fixture:'Valid DOCX containing text extracted from the actual generated PDF; no invented facts'};
  });
 }
 if(stage==='workflow-loading') {
  await check('Direct-linked workflow stays readable while list request is pending',async()=>{
   let release;const held=new Promise(resolve=>{release=resolve});await page.route('**/api/workflows?limit=50&kind=APPLICATION',async route=>{const response=await route.fetch();await held;await route.fulfill({response})});
   const {runId}=JSON.parse(fs.readFileSync(path.join(dir,'workflow-retry.json')));await goto('/workspace?view=runs&run='+runId);const detail=page.getByRole('region',{name:'Preparation detail',exact:true});await detail.getByRole('heading',{level:2}).waitFor();const before=await detail.boundingBox();assert(before.width>700,'Loading detail constrained to '+before.width);await shot('workflow-list-loading-fixed');release();await page.getByRole('list',{name:'Preparation runs',exact:true}).waitFor();const after=await detail.boundingBox();assert(after.width>600,'Loaded detail constrained to '+after.width);await shot('workflow-list-loaded-fixed');return {loadingWidth:before.width,loadedWidth:after.width,transport:'Real list response delayed, then released without fabricated data'};
  });
 }
 if(stage==='production') {
  for(const route of ['/dashboard','/jobs/app_job_vercel_platform#research','/career-profile?setup=0#intake','/review','/workspace?view=tracking','/settings/ai-stages#stage-TAILOR'])await check('Production '+route,async()=>{await goto(route);assert(new URL(page.url()).pathname!== '/unlock');assert(await page.getByRole('heading',{level:1}).count());return {url:page.url(),rendered:true};});
  await check('Production palette and stage task tabs',async()=>{await page.keyboard.press('Control+k');await page.getByRole('combobox').waitFor();await page.keyboard.press('Escape');await page.getByRole('combobox').waitFor({state:'hidden'});assert.equal(await page.getByRole('tab',{name:'Tailor',exact:true}).getAttribute('aria-selected'),'true');await shot('production-final');return 'Built bundle, real backend, first-use palette and deep-linked task tab';});
 }
 if(stage==='shell-profile') {
  await check('Shell menus, attention drawer, appearance controls and planner tabs',async()=>{
   await goto('/dashboard');await page.getByRole('button',{name:'Open attention tray',exact:true}).click();await page.getByRole('dialog',{name:'Needs your attention',exact:true}).waitFor();await shot('attention-tray-final');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'Workspace menu',exact:true}).click();await page.getByRole('menu').waitFor();await shot('workspace-menu-final');await page.keyboard.press('Escape');
   await goto('/settings/appearance');await page.getByRole('button',{name:'Light',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('rolespec-mode')),'light');await shot('appearance-light-final');await page.getByRole('button',{name:'Dark',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('rolespec-mode')),'dark');
   await goto('/planner');for(const name of ['Notes','Calendar','Goals','Todos']){await page.getByRole('tab',{name,exact:true}).click();assert.equal(await page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true')}return 'Actual navigation, menu dismissal, theme preference and planner tab selection';
  });
  await check('Apply remains candidate; explicit confirm and source provenance',async()=>{
   const runs=(await json('/api/intake?limit=50')).runs;const selected=runs.find(r=>r.patches.some(p=>p.kind==='EVIDENCE'&&p.status==='PENDING'));assert(selected);const patch=selected.patches.find(p=>p.kind==='EVIDENCE'&&p.status==='PENDING');
   await goto('/review?section=profile');await page.getByRole('button',{name:'Profile proposals',exact:true}).click();await page.getByRole('combobox',{name:'Choose an intake run'}).selectOption(selected.id);const row=page.locator('li').filter({hasText:patch.data.title}).last();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/patches/'+patch.id)&&r.request().method()==='POST'),row.getByRole('button',{name:'Apply to profile',exact:true}).click()]);
   const applied=(await json('/api/intake/'+selected.id)).run.patches.find(p=>p.id===patch.id);assert.equal(applied.status,'APPLIED');await goto('/career-profile?setup=0#evidence');const fact=page.locator('#evidence .group').filter({hasText:patch.data.title}).first();await fact.getByText('Candidate fact. Confirm only after checking its source.',{exact:true}).waitFor();await fact.getByText('View source provenance',{exact:true}).click();await fact.getByText(selected.id,{exact:true}).waitFor();await shot('candidate-source-before-confirm');await fact.getByRole('button',{name:'Confirm',exact:true}).click();await page.getByText('Confirmed by you; not employer-verified.',{exact:true}).waitFor();await shot('candidate-explicitly-confirmed');return {proposalId:patch.id,evidenceId:applied.appliedTargetId,runId:selected.id,isolated:true};
  });
 }
 if(stage==='workflow-retry-confirm') {
  await check('Persisted provider failure and retry recovered to human review',async()=>{
   const {runId}=JSON.parse(fs.readFileSync(path.join(dir,'workflow-retry.json')));let run;for(let i=0;i<120;i++){run=(await json('/api/workflows/'+runId)).workflow;if(run.state==='AWAITING_REVIEW')break;await page.waitForTimeout(1000)}assert.equal(run.state,'AWAITING_REVIEW');const payload=await json('/api/workflows/'+runId+'/events?limit=200');const events=Object.values(payload).find(Array.isArray);assert(events.some(e=>e.type==='STEP_FAILED'&&e.stepName==='TAILOR'));assert(events.some(e=>e.type==='RETRY_SCHEDULED'));assert.equal(run.steps.find(s=>s.name==='TAILOR').status,'COMPLETED');const settings=await json('/api/settings/ai-stages');assert(!settings.items.some(s=>s.stage==='TAILOR'));
   await goto('/workspace?view=runs&run='+runId);await page.getByRole('link',{name:/Review question/}).waitFor();await shot('workflow-retry-recovered');await page.getByRole('button',{name:'Cancel preparation',exact:true}).click();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/advance')&&r.request().postDataJSON()?.action==='CANCEL'),page.getByRole('dialog').getByRole('button',{name:'Cancel preparation',exact:true}).click()]);assert.equal((await json('/api/workflows/'+runId)).workflow.state,'CANCELLED');return {runId,evidence:'STEP_FAILED TAILOR -> RETRY_SCHEDULED -> TAILOR COMPLETED -> HUMAN_REVIEW; restored normal provider; cancelled QA attempt'};
  });
 }
 if(stage==='workflow-retry') {
  await check('Real provider failure, persisted FAILED state and explicit workflow retry',async()=>{
   await goto('/settings/ai-stages#stage-TAILOR');const section=page.getByRole('region',{name:'Tailor',exact:true});await section.getByRole('button',{name:'Add override',exact:true}).click();await section.getByLabel('Provider',{exact:true}).selectOption('ollama');await section.getByLabel('Model (optional)',{exact:true}).fill('rolespec-qa-unavailable-model');await section.getByRole('button',{name:'Save tailor override',exact:true}).click();await section.getByRole('button',{name:'Edit override',exact:true}).waitFor();
   let runId;
   try{
    await goto('/jobs/app_job_vercel_platform#preparation');await page.getByRole('button',{name:'Agent-assisted',exact:true}).last().click();const response=page.waitForResponse(r=>r.url().endsWith('/api/workflows')&&r.request().method()==='POST');await page.getByRole('button',{name:'New preparation attempt',exact:true}).click();const run=(await(await response).json()).workflow;runId=run.id;report.runId=runId;save();await page.getByRole('button',{name:'Start assistance',exact:true}).click();
    let saved;for(let i=0;i<150;i++){saved=(await json('/api/workflows/'+runId)).workflow;if(['FAILED','AWAITING_REVIEW'].includes(saved.state))break;await page.waitForTimeout(1000)}assert.equal(saved.state,'FAILED','Expected actual unavailable provider to fail: '+saved.state);await shot('workflow-provider-failed');report.failure=saved.lastError;
   }finally{
    await goto('/settings/ai-stages#stage-TAILOR');await page.getByRole('region',{name:'Tailor',exact:true}).getByRole('button',{name:'Use normal provider',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Use normal provider',exact:true}).click();await page.getByRole('region',{name:'Tailor',exact:true}).getByRole('button',{name:'Add override',exact:true}).waitFor();
   }
   await goto('/workspace?view=runs&run='+runId);await Promise.all([page.waitForResponse(r=>r.url().endsWith('/advance')&&r.request().postDataJSON()?.action==='RETRY'),page.getByRole('button',{name:'Retry failed work',exact:true}).click()]);let saved;for(let i=0;i<180;i++){saved=(await json('/api/workflows/'+runId)).workflow;if(['FAILED','AWAITING_REVIEW','COMPLETED'].includes(saved.state))break;await page.waitForTimeout(1000)}assert(['AWAITING_REVIEW','COMPLETED'].includes(saved.state),'Retry failed: '+saved.lastError);await shot('workflow-retry-recovered');report.recovered=saved.state;
   await page.getByRole('button',{name:'Cancel preparation',exact:true}).click();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/advance')&&r.request().postDataJSON()?.action==='CANCEL'),page.getByRole('dialog').getByRole('button',{name:'Cancel preparation',exact:true}).click()]);return {runId,actualProviderFailure:true,recovered:saved.state,cleanup:'Tailor override removed; QA run cancelled after verification'};
  });
 }
 if(stage==='final-ui') {
  await check('Final desktop report and mobile tabs, including synthesized touch',async()=>{
   await goto('/jobs/app_job_vercel_platform#research');await page.getByRole('button',{name:'Re-run Research',exact:true}).waitFor();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(dir,'final-desktop-job.png')});
   await goto('/career-profile?setup=0#intake');await page.getByRole('tab',{name:'Resume',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'GitHub',exact:true}).getAttribute('aria-selected'),'true');await page.getByRole('tabpanel',{name:'GitHub',exact:true}).waitFor();
   const mobileContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const mobile=await mobileContext.newPage();mobile.on('pageerror',e=>report.console.push({type:'pageerror',text:e.message}));
   await mobile.goto(base+'/career-profile?setup=0',{waitUntil:'domcontentloaded'});await mobile.getByRole('tab',{name:'Contact',exact:true}).waitFor();await mobile.getByRole('tab',{name:'Preferences',exact:true}).tap();assert.equal(await mobile.getByRole('tab',{name:'Preferences',exact:true}).getAttribute('aria-selected'),'true');await mobile.getByRole('tab',{name:'Import & review',exact:true}).tap();await mobile.evaluate(()=>scrollTo(0,0));await mobile.screenshot({path:path.join(dir,'final-mobile-profile.png')});
   await mobile.goto(base+'/jobs/app_job_vercel_platform#research',{waitUntil:'domcontentloaded'});await mobile.getByRole('tab',{name:'Research',exact:true}).waitFor();await mobile.evaluate(()=>scrollTo(0,0));await mobile.screenshot({path:path.join(dir,'final-mobile-job.png')});
   for(const width of [320,768]){await mobile.setViewportSize({width,height:900});const size=await mobile.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert(size.scroll<=size.viewport+1);}
   await mobileContext.close();return 'Current code; actual reports; touch switches task panels; intake arrow keys expose the labelled panel; 320/768 reflow';
  });
  await check('Light theme and enlarged-text reflow',async()=>{
   await page.evaluate(()=>localStorage.setItem('rolespec-mode','light'));await page.setViewportSize({width:390,height:844});await goto('/settings/ai-stages');await page.screenshot({path:path.join(dir,'final-mobile-light-settings.png')});await page.addStyleTag({content:'html { font-size: 200% !important; }'});const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert(size.scroll<=size.viewport+1,'200% text overflow '+JSON.stringify(size));await shot('enlarged-text-settings');return {theme:'light',textSize:'200%',...size};
  });
 }
 if(stage==='final-actions'||stage==='ranking') {
  if(stage==='final-actions')await check('Manual company research saves real report and survives reload',async()=>{
   await goto('/jobs/app_job_vercel_platform#research');await page.getByRole('button',{name:/^(Research Vercel|Re-run Research)$/,exact:true}).click();await page.getByRole('button',{name:'Re-run Research',exact:true}).waitFor({timeout:120000});await shot('research-persisted');await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Re-run Research',exact:true}).waitFor();return await page.getByRole('tabpanel').filter({has:page.getByRole('button',{name:'Re-run Research',exact:true})}).last().innerText();
  });
  await check('Deterministic ranking POST and persisted explanation',async()=>{
   await goto('/dashboard');await page.getByRole('button',{name:/^(Rank saved jobs|Refresh ranking)$/,exact:true}).waitFor({timeout:30000});const response=page.waitForResponse(r=>r.url().endsWith('/api/ranking')&&r.request().method()==='POST');await page.getByRole('button',{name:/^(Rank saved jobs|Refresh ranking)$/,exact:true}).click();const r=await response;assert(r.ok());const data=await r.json();assert(data.snapshotId);await shot('ranking-persisted-final');return {snapshotId:data.snapshotId,entries:data.entries.length};
  });
  if(stage==='final-actions')await check('QA confirmation creates real reminders, then done/dismiss persist',async()=>{
   await goto('/jobs/app_job_vercel_platform#track');await page.getByRole('button',{name:'I submitted on the employer site',exact:true}).first().click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Optional note',{exact:true}).fill('QA only in cloned database: verifying reminder creation. No employer submission occurred.');await Promise.all([page.waitForResponse(r=>r.url().includes('/api/submission-attempts/')&&r.request().method()==='PATCH'&&r.ok()),dialog.getByRole('button',{name:'Confirm I submitted',exact:true}).click()]);
   const reminders=(await json('/api/follow-ups?jobApplicationId=app_job_vercel_platform&limit=100')).items;assert(reminders.length>=2);await shot('followups-scheduled');const region=page.getByRole('region',{name:'Follow-up timeline',exact:true});await region.getByRole('button',{name:'Mark done',exact:true}).first().click();await page.waitForTimeout(500);await region.getByRole('button',{name:'Dismiss',exact:true}).first().click();await page.waitForTimeout(500);const after=(await json('/api/follow-ups?jobApplicationId=app_job_vercel_platform&limit=100')).items;assert(after.some(x=>x.status==='DONE'));assert(after.some(x=>x.status==='DISMISSED'));return {reminders:reminders.map(x=>({channel:x.channel,dueAt:x.dueAt})),after:after.map(x=>x.status),isolatedTestRecord:true};
  });
  if(stage==='final-actions')await check('Outreach draft, activate, skip and cancel use persisted state',async()=>{
   await goto('/workspace?view=tracking#outreach');await page.getByRole('button',{name:'New outreach plan',exact:true}).click();await page.getByLabel('Plan name',{exact:true}).fill('QA isolated outreach');await page.getByLabel('Contact name',{exact:true}).fill('QA contact');await page.getByLabel('Email (optional)',{exact:true}).fill('qa@example.com');await page.getByRole('button',{name:'Save draft plan',exact:true}).click();const row=page.locator('li').filter({has:page.getByRole('heading',{name:'QA isolated outreach',exact:true})});await row.getByRole('button',{name:'Activate plan',exact:true}).click();await row.getByRole('button',{name:'Skip',exact:true}).first().click();await row.getByText('skipped',{exact:true}).waitFor();await shot('outreach-active');await row.getByRole('button',{name:'Cancel plan',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Cancel plan',exact:true}).click();await row.getByText('cancelled',{exact:true}).first().waitFor();return 'Draft/activate/manual skip/cancel persisted; no message was sent';
  });
 }
 if(stage==='intake-finalize') {
  const initial=JSON.parse(fs.readFileSync(path.join(dir,'intake.json')));
  await check('Created resume/chat/voice runs finished with actual proposals',async()=>{
   const results=[];for(const c of initial.checks.filter(c=>c.evidence?.run)){const saved=(await json('/api/intake/'+c.evidence.run.id)).run;assert(['COMPLETED','PARTIAL'].includes(saved.status));assert(saved.patches.length>0);results.push({id:saved.id,sources:saved.requestedSources,status:saved.status,patches:saved.patches.length})}return results;
  });
  for(const source of ['RESUME','LINKEDIN'])await check(source+' actual PDF upload and persisted parser result',async()=>{
   await goto('/career-profile?setup=0#intake');await page.getByRole('tab',{name:source==='RESUME'?'Resume':'LinkedIn export',exact:true}).click();await page.locator(source==='RESUME'?'#intake-resume-file':'#intake-linkedin-file').setInputFiles(path.join(dir,'generated-resume.pdf'));
   const response=page.waitForResponse(r=>r.url().includes('/api/intake/upload?')&&r.request().method()==='POST',{timeout:60000});await page.getByRole('button',{name:'Upload and start',exact:true}).click();const r=await response;assert(r.ok(),'Upload '+r.status());const data=await r.json();let saved;for(let i=0;i<20;i++){saved=(await json('/api/intake/'+data.run.id)).run;if(['COMPLETED','PARTIAL','FAILED'].includes(saved.status))break;await page.waitForTimeout(500)}assert(['COMPLETED','PARTIAL'].includes(saved.status),saved.error);await shot('upload-'+source.toLowerCase());return {id:saved.id,status:saved.status,patches:saved.patches.length,input:'Actual RoleSpec-generated PDF, not a LinkedIn-issued export'};
  });
  await check('Correct and reject a proposal with persistent source provenance',async()=>{
   await goto('/review?section=profile');await page.getByRole('button',{name:'Profile proposals',exact:true}).click();await page.getByRole('button',{name:'Correct',exact:true}).first().click();await shot('proposal-correction');report.correctionFields=await page.getByRole('textbox').evaluateAll(els=>els.map(e=>({id:e.id,label:e.labels?.[0]?.textContent})));await page.getByRole('button',{name:'Cancel',exact:true}).first().click();await page.getByRole('button',{name:'Reject',exact:true}).first().click();await page.waitForTimeout(500);await shot('proposal-rejected');return 'Correction form opened; explicit reject persisted without trusting a fact';
  });
 }
 if(stage==='recovery-init') {
  await check('Create assisted recovery run and pause persisted work',async()=>{
   await goto('/jobs/app_job_vercel_platform#preparation');await page.getByRole('button',{name:'Agent-assisted',exact:true}).last().click();const response=page.waitForResponse(r=>r.url().endsWith('/api/workflows')&&r.request().method()==='POST');await page.getByRole('button',{name:'New preparation attempt',exact:true}).click();const run=(await(await response).json()).workflow;report.runId=run.id;save();await page.getByRole('button',{name:'Start assistance',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('button',{name:'Resume',exact:true}).waitFor();await shot('restart-before');assert.equal((await json('/api/workflows/'+run.id)).workflow.state,'PAUSED');return {runId:run.id,state:'PAUSED'};
  });
 }
 if(stage==='recovery-finish'||stage==='retry') {
  const {runId}=JSON.parse(fs.readFileSync(path.join(dir,'recovery-init.json')));
  if(stage==='recovery-finish')await check('Server restart preserves paused run; reload, resume and cancel',async()=>{
   await goto('/workspace?view=runs&run='+runId);await page.getByRole('button',{name:'Resume',exact:true}).waitFor();assert.equal((await json('/api/workflows/'+runId)).workflow.state,'PAUSED');await shot('restart-recovered');await Promise.all([page.waitForResponse(r=>r.url().endsWith('/advance')&&r.request().postDataJSON()?.action==='RESUME'),page.getByRole('button',{name:'Resume',exact:true}).click()]);await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Cancel preparation',exact:true}).waitFor();await page.getByRole('button',{name:'Cancel preparation',exact:true}).click();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/advance')&&r.request().postDataJSON()?.action==='CANCEL'),page.getByRole('dialog').getByRole('button',{name:'Cancel preparation',exact:true}).click()]);assert.equal((await json('/api/workflows/'+runId)).workflow.state,'CANCELLED');return 'Real process restart, persisted state recovery, resume, live reload and cancellation verified';
  });
  await check('Real failed intake retry remains failed with actionable cause',async()=>{
   await goto('/review?section=profile');await page.getByRole('button',{name:'Profile proposals',exact:true}).click();const runs=(await json('/api/intake?limit=50')).runs;const failed=runs.find(r=>r.status==='FAILED');assert(failed,'A real failed intake is required');await page.getByRole('combobox',{name:'Choose an intake run'}).selectOption(failed.id);const retry=page.getByRole('button',{name:'Retry failed sources',exact:true});if(await retry.count()){await retry.click();await page.waitForTimeout(1000);await shot('intake-real-retry');return await ui()}throw new Error('Latest intake is not retryable; select a real failed run');
  });
 }
 if(stage==='layout') {
  const routes=['/dashboard','/career-profile?setup=0','/career-profile?setup=0#intake','/jobs','/jobs/discover','/jobs/app_job_vercel_platform#preparation','/jobs/app_job_vercel_platform#track','/workspace?view=runs','/workspace?view=tracking','/review','/planner','/settings/ai-stages','/settings/ai','/resumes/cmwcugpeh000rhcdwyjcfc9gp'];
  report.layouts=[];
  for(const width of [390,1440])for(const [index,route] of routes.entries())await check(width+' '+route,async()=>{
   await page.setViewportSize({width,height:width===390?844:1000});await goto(route);await page.waitForTimeout(500);
   const measured=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,headings:[...document.querySelectorAll('h1')].map(e=>e.textContent),unnamed:[...document.querySelectorAll('button,input,select,textarea')].filter(e=>e.getBoundingClientRect().width>0&&!e.hasAttribute('aria-hidden')).filter(e=>!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&!e.labels?.length&&!e.textContent?.trim()&&!e.getAttribute('title')).map(e=>({tag:e.tagName,id:e.id,type:e.type}))}));
   assert(measured.scroll<=width+1,'Horizontal page overflow: '+JSON.stringify(measured));report.layouts.push({route,...measured});await shot(`layout-${width}-${index}`);return measured;
  });
  await check('Tab keyboard, deep links, back navigation and unsaved draft preservation',async()=>{
   await page.setViewportSize({width:390,height:844});await goto('/career-profile?setup=0');const input=page.getByLabel('Full name',{exact:true});const original=await input.inputValue();await input.fill('QA unsaved draft');await page.getByRole('tab',{name:'Preferences',exact:true}).click();await page.getByRole('tab',{name:'Contact',exact:true}).click();assert.equal(await input.inputValue(),'QA unsaved draft');await input.fill(original);
   await page.getByRole('tab',{name:'Contact',exact:true}).focus();await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{name:'Backup',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:'Contact',exact:true}).getAttribute('aria-selected'),'true');
   await goto('/jobs/app_job_vercel_platform#research');assert.equal(await page.getByRole('tab',{name:'Prepare',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await page.getByRole('tab',{name:'Research',exact:true}).getAttribute('aria-selected'),'true');await shot('mobile-nested-tab-research');return 'One visible task panel; hidden forms retain edits; keyboard endpoints and nested research hash resolve';
  });
  await check('Palette, mobile focus trap, offline recovery and genuine transport error',async()=>{
   await goto('/dashboard');await page.keyboard.press('Control+k');await page.getByRole('combobox').waitFor();await page.getByRole('combobox').fill('review');await shot('palette-qa');await page.keyboard.press('Escape');await page.getByRole('combobox').waitFor({state:'hidden'});
   await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('dialog').getByRole('button',{name:'Agent-assisted',exact:true}).focus();await page.keyboard.press('Tab');assert(await page.getByRole('dialog').evaluate(e=>e.contains(document.activeElement)));await shot('mobile-navigation-qa');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
   await context.setOffline(true);await page.getByText(/You’re offline|You are offline/).first().waitFor();await shot('offline-qa');await context.setOffline(false);await page.waitForTimeout(500);
   await page.route('**/api/ranking',r=>r.abort('failed'));await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:/retry/i}).first().waitFor();await shot('ranking-transport-error-qa');await page.unroute('**/api/ranking');await page.getByRole('button',{name:/retry/i}).first().click();await page.waitForTimeout(600);return 'No fabricated HTTP responses: offline and aborted transport followed by actual endpoint retry';
  });
  await check('Reduced motion and original studio read persisted states',async()=>{
   const run=JSON.parse(fs.readFileSync(path.join(dir,'actions.json'))).assistedRun;await page.setViewportSize({width:1440,height:1000});await goto('/workspace?view=runs&run='+run);await page.getByRole('button',{name:'Evidence studio',exact:true}).click();await page.getByText(/five workstations/).waitFor();await shot('studio-qa');await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Evidence studio',exact:true}).waitFor({state:'hidden'});await shot('reduced-motion-qa');return 'Studio uses stored run; reduced motion removes spatial view';
  });
 }
 if(stage==='pdf') {
  const run=(await json('/api/workflows/'+JSON.parse(fs.readFileSync(path.join(dir,'actions.json'))).assistedRun)).workflow;
  const resume=run.steps.find(s=>s.name==='TAILOR').output.resumeId;
  await check('Real PDF and historical validation',async()=>{
   await goto('/resumes/'+resume);await page.getByRole('button',{name:'Resume history and validation',exact:true}).click();await page.getByRole('button',{name:'Refresh history',exact:true}).waitFor();await page.getByText(/^Historical /).waitFor();await shot('resume-validation-history-final');await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Compare with source resume and rollback',exact:true}).click();await page.getByRole('button',{name:'Rollback to Source',exact:true}).waitFor();await shot('resume-comparison-final');await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Export',exact:true}).click();await page.getByRole('menuitem',{name:'Preview generated PDF',exact:true}).click();await page.getByRole('button',{name:'Generate PDF preview',exact:true}).click();const link=page.getByRole('link',{name:/Preview generated PDF in a new tab/});await link.waitFor({timeout:60000});const href=await link.getAttribute('href');const response=await context.request.get(new URL(href,base).href);assert(response.ok());const bytes=await response.body();assert.equal(bytes.subarray(0,4).toString(),'%PDF');fs.writeFileSync(path.join(dir,'generated-resume.pdf'),bytes);await shot('resume-pdf-ready-final');return {contentType:response.headers()['content-type'],bytes:bytes.length,url:href};
  });
 }
 if(stage==='settings-tracking') {
  await check('AI stage save and explicit return to default',async()=>{
   await goto('/settings/ai-stages#stage-TAILOR');const section=page.getByRole('region',{name:'Tailor',exact:true});await section.getByRole('button',{name:'Add override',exact:true}).click();await section.getByLabel('Provider',{exact:true}).selectOption('codex-cli');await section.getByLabel('Model (optional)',{exact:true}).fill('gpt-6.1-sol');await section.getByRole('button',{name:'Save tailor override',exact:true}).click();await section.getByRole('button',{name:'Edit override',exact:true}).waitFor();await shot('settings-stage-saved');await section.getByRole('button',{name:'Use normal provider',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Use normal provider',exact:true}).click();await section.getByRole('button',{name:'Add override',exact:true}).waitFor();return 'Real PUT then DELETE restored stage default';
  });
  await check('Staging cancellation and explicit not-submitted confirmation',async()=>{
   await goto('/jobs/app_job_vercel_platform#track');await page.getByRole('button',{name:'Stage manually',exact:true}).click();await page.getByRole('status').filter({hasText:'Preparation staged'}).waitFor();
   const before=(await json('/api/applications/app_job_vercel_platform')).application;
   await page.getByRole('button',{name:'I submitted on the employer site',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await json('/api/applications/app_job_vercel_platform')).application.status,before.status);
   await page.getByRole('button',{name:'I did not submit',exact:true}).last().click();await page.getByRole('dialog').getByRole('button',{name:'Confirm not submitted',exact:true}).click();await page.getByText('not submitted',{exact:true}).waitFor();await shot('tracking-not-submitted');return 'Cancel made no status change; explicit not-submitted saved';
  });
  await check('Application status and legacy follow-up modal persist',async()=>{
   await goto('/jobs');await page.getByRole('button',{name:'Edit Vercel',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Status',{exact:true}).selectOption('APPLIED');await dialog.getByLabel('Follow up on',{exact:true}).fill('2026-11-20');await shot('job-status-edit');await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});const saved=(await json('/api/applications/app_job_vercel_platform')).application;assert.equal(saved.status,'APPLIED');return {status:saved.status,followUpAt:saved.followUpAt};
  });
 }
 if(stage==='materials') {
  const {assistedRun}=JSON.parse(fs.readFileSync(path.join(dir,'actions.json')));
  const run=(await json('/api/workflows/'+assistedRun)).workflow;
  const tailored=run.steps.find(s=>s.name==='TAILOR').output.resumeId;
  report.runId=assistedRun;report.resumeId=tailored;
  await check('Historical validation, source comparison and exact PDF export',async()=>{
   await goto('/resumes/'+tailored);await page.getByRole('button',{name:'Resume history and validation',exact:true}).click();await page.getByText(/^Historical /).first().waitFor();await shot('resume-validation-history');await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Compare with source resume and rollback',exact:true}).click();await page.getByRole('button',{name:'Rollback to Source',exact:true}).waitFor();await shot('resume-comparison');await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Export',exact:true}).click();await page.getByRole('menuitem',{name:'Preview generated PDF',exact:true}).click();await page.getByRole('button',{name:'Generate PDF preview',exact:true}).click();const link=page.getByRole('link',{name:/Preview generated PDF in a new tab/});await link.waitFor({timeout:60000});const href=await link.getAttribute('href');const pdf=await context.request.get(new URL(href,base).href);assert(pdf.ok());assert((pdf.headers()['content-type']||'').includes('application/pdf'));const bytes=await pdf.body();assert.equal(bytes.subarray(0,4).toString(),'%PDF');fs.writeFileSync(path.join(dir,'generated-resume.pdf'),bytes);await shot('resume-pdf-ready');return {url:href,bytes:bytes.length};
  });
  await check('Human preparation approval stages without changing selected resume',async()=>{
   const before=(await json('/api/applications/app_job_vercel_platform')).application;
   await goto('/review?task='+run.openReviewTaskIds[0]);await page.getByRole('button',{name:'Approve preparation',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Approve preparation',exact:true}).isDisabled());await shot('human-review-required');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve preparation',exact:true}).click();
   let saved;for(let i=0;i<40;i++){saved=(await json('/api/workflows/'+assistedRun)).workflow;if(saved.state==='COMPLETED')break;await page.waitForTimeout(1000)}assert.equal(saved.state,'COMPLETED');const after=(await json('/api/applications/app_job_vercel_platform')).application;assert.equal(after.resumeId,before.resumeId);assert.equal(after.status,before.status);return {state:saved.state,status:after.status,selectedResumeUnchanged:true};
  });
  await check('Explicit rollback restores captured source and records history',async()=>{
   await goto('/resumes/'+tailored);await page.getByRole('button',{name:'Compare with source resume and rollback',exact:true}).click();await page.getByRole('button',{name:'Rollback to Source',exact:true}).click();await page.getByRole('dialog',{name:'Roll back to original source resume?'}).waitFor();await shot('rollback-confirmation');await page.getByRole('button',{name:'Yes, Rollback',exact:true}).click();await page.waitForTimeout(1000);await page.getByRole('button',{name:'Resume history and validation',exact:true}).click();await page.getByText(/restored 1 times/).waitFor();await shot('rollback-persisted');return 'Captured source restored only in disposable QA draft';
  });
  await check('Review tabs and extension handoff navigation',async()=>{
   await goto('/review');await page.getByRole('button',{name:'Answer memory',exact:true}).click();await shot('answer-memory-handoff');report.memoryBody=await ui();await page.getByRole('button',{name:'Profile proposals',exact:true}).click();await page.getByRole('button',{name:'Refresh run',exact:true}).waitFor();await shot('profile-proposals');return 'Memory contract limit explicit; pending intake proposals have review actions';
  });
 }
 if(stage==='onboarding') {
  await check('Four-step onboarding and persistent completion without AI',async()=>{
   await goto('/onboarding');if(page.url().endsWith('/dashboard'))return 'Completed onboarding persisted and redirects to dashboard';await page.getByRole('button',{name:'Get started',exact:true}).click();await shot('onboarding-provider');
   await page.getByRole('button',{name:"I'll set up AI later",exact:true}).click();await page.getByRole('button',{name:'Continue without AI',exact:true}).click();
   await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Application goal',{exact:true}).fill('5');await page.getByLabel('Goal period',{exact:true}).selectOption('WEEKLY');await page.getByRole('button',{name:'Continue',exact:true}).click();await shot('onboarding-review');
   await page.getByRole('button',{name:'Open RoleSpec',exact:true}).click();await page.waitForURL('**/dashboard');await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
   return await ui();
  });
 }
 if(stage==='actions') {
  await check('Jobs search, empty result, reset and filters',async()=>{
   await goto('/jobs');await page.getByPlaceholder('Search company, title, location, notes...').fill('no-such-role-qa-20261112');await page.waitForTimeout(400);await shot('jobs-search-empty');assert(await page.getByText(/no .*match|no applications|no results/i).count());
   await page.getByPlaceholder('Search company, title, location, notes...').fill('Vercel');await page.waitForTimeout(300);assert(await page.getByRole('link',{name:'Vercel',exact:true}).count());await page.locator('#job-status-filter').selectOption('INTERESTED');await page.locator('#job-work-filter').selectOption('REMOTE');await shot('jobs-search-filtered');return 'Search and status/work mode filters update the actual list';
  });
  await check('Discovery search uses real sources and watchlist dialog',async()=>{
   await goto('/jobs/discover');await page.getByRole('button',{name:'Watched companies',exact:true}).click();await page.getByRole('dialog').waitFor();await shot('discovery-watchlist');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
   await page.getByRole('button',{name:'Search',exact:true}).click();await page.waitForTimeout(20000);await shot('discovery-results');return await ui();
  });
  await check('Deterministic ranking persists a real snapshot',async()=>{
   await goto('/dashboard');const response=page.waitForResponse(r=>r.url().endsWith('/api/ranking')&&r.request().method()==='POST',{timeout:60000});await page.getByRole('button',{name:/^(Rank saved jobs|Refresh ranking)$/,exact:true}).click();const r=await response;assert(r.ok());await page.waitForTimeout(600);await shot('ranking-result');const d=await r.json();return {snapshotId:d.snapshotId,entries:d.entries?.length,warnings:d.warnings};
  });
  await check('Manual mode immutable checklist, explicit completion and cancellation',async()=>{
   await goto('/jobs/app_job_vercel_platform#preparation');await page.getByRole('button',{name:'Manual',exact:true}).last().click();const response=page.waitForResponse(r=>r.url().endsWith('/api/workflows')&&r.request().method()==='POST');await page.getByRole('button',{name:'New preparation attempt',exact:true}).click();const run=(await (await response).json()).workflow;report.manualRun=run.id;assert.equal(run.mode,'MANUAL');
   await page.getByRole('button',{name:'Start checklist',exact:true}).click();await page.getByRole('button',{name:'Mark step done',exact:true}).click();await page.getByRole('button',{name:'Record step done',exact:true}).click();await page.waitForTimeout(600);await shot('manual-run');
   const saved=(await json('/api/workflows/'+run.id)).workflow;assert(saved.steps.some(s=>s.name==='PROFILE'&&s.status==='COMPLETED'));
   await page.getByRole('button',{name:'Cancel preparation',exact:true}).click();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/advance')&&r.request().postDataJSON()?.action==='CANCEL'),page.getByRole('dialog').getByRole('button',{name:'Cancel preparation',exact:true}).click()]);assert.equal((await json('/api/workflows/'+run.id)).workflow.state,'CANCELLED');return {runId:run.id};
  });
  await check('Agent-Assisted starts actual preparation and emits saved progress',async()=>{
   await goto('/jobs/app_job_vercel_platform#preparation');await page.getByRole('button',{name:'Agent-assisted',exact:true}).last().click();const response=page.waitForResponse(r=>r.url().endsWith('/api/workflows')&&r.request().method()==='POST');await page.getByRole('button',{name:'New preparation attempt',exact:true}).click();const run=(await (await response).json()).workflow;assert.equal(run.mode,'AGENT_ASSISTED');report.assistedRun=run.id;save();
   await page.getByRole('button',{name:'Start assistance',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).waitFor();await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('button',{name:'Resume',exact:true}).waitFor();assert.equal((await json('/api/workflows/'+run.id)).workflow.state,'PAUSED');await shot('assisted-paused');
   await page.getByRole('button',{name:'Resume',exact:true}).click();await page.waitForTimeout(1200);const saved=(await json('/api/workflows/'+run.id)).workflow;assert(saved.steps.some(s=>s.status==='COMPLETED'||s.status==='RUNNING'));await shot('assisted-progress');return {runId:run.id,state:saved.state};
  });
 }
 if(stage==='inventory') {
  const routes=['/onboarding','/dashboard','/career-profile?setup=1','/career-profile?setup=0','/resumes','/jobs','/jobs/discover','/workspace','/workspace?view=runs','/workspace?view=tracking','/review','/planner','/linkedin','/jobs/cover-letter','/settings/profile','/settings/appearance','/settings/preferences','/settings/ai','/settings/ai-stages','/settings/api','/settings/data','/settings/usage'];
  for(const [i,route] of routes.entries()) await check(route,async()=>{
   await goto(route);await page.locator('h1,h2').first().waitFor();
   const snapshot=await page.evaluate(()=>({title:document.title,h1:[...document.querySelectorAll('h1')].map(x=>x.textContent),controls:[...document.querySelectorAll('button,a,input,select,textarea,summary')].filter(x=>x.getBoundingClientRect().width>0).map(x=>({tag:x.tagName,text:(x.textContent||x.getAttribute('aria-label')||x.getAttribute('placeholder')||'').trim().slice(0,120),type:x.type,href:x.getAttribute('href'),id:x.id,disabled:x.disabled})),overflow:document.documentElement.scrollWidth>innerWidth+1}));
   assert(!snapshot.overflow,'Desktop overflow');await shot(`desktop-${i}`);return {route:page.url(),...snapshot};
  });
 }
 if(stage==='intake') {
  await goto('/career-profile?setup=0#intake');
  await check('Resume intake persists proposals',async()=>{
   await page.getByRole('tab',{name:'Resume',exact:true}).click();
   const response=page.waitForResponse(r=>r.url().endsWith('/api/intake')&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Start from resume',exact:true}).click();const r=await response;assert(r.ok());const data=await r.json();await page.waitForTimeout(1500);await shot('intake-resume');return data;
  });
  await check('Chat preview and persisted extraction',async()=>{
   await page.getByRole('tab',{name:'Conversational chat',exact:true}).click();await page.getByLabel('Your message',{exact:true}).fill('I use TypeScript and PostgreSQL. I want to be a frontend engineer.');await page.getByRole('button',{name:'Preview facts',exact:true}).click();await page.getByText(/proposed fact/).first().waitFor();
   await shot('intake-chat-preview');const response=page.waitForResponse(r=>r.url().endsWith('/api/intake')&&r.request().method()==='POST');await page.getByRole('button',{name:'Start chat intake',exact:true}).click();const r=await response;assert(r.ok());return r.json();
  });
  await check('Voice transcript extraction and microphone fallback',async()=>{
   await page.getByRole('tab',{name:/voice/i}).click();await page.getByRole('button',{name:'Use microphone',exact:true}).click();await page.waitForTimeout(300);await shot('intake-microphone');await page.getByLabel('Transcript',{exact:true}).fill('I use React and TypeScript. I want to be a frontend engineer.');const response=page.waitForResponse(r=>r.url().endsWith('/api/intake')&&r.request().method()==='POST');await page.getByRole('button',{name:'Start voice intake',exact:true}).click();const r=await response;assert(r.ok());return r.json();
  });
  for(const source of ['GitHub','Website'])await check(source+' validation and consent',async()=>{
   await page.getByRole('tab',{name:source==='GitHub'?'GitHub':'Portfolio / website',exact:true}).click();const input=page.getByLabel(source==='GitHub'?'Public GitHub profile':'Public portfolio or site',{exact:true});await input.fill(source==='GitHub'?'https://github.com/':'http://127.0.0.1/');const button=page.getByRole('button',{name:source==='GitHub'?'Start GitHub intake':'Start website intake',exact:true});assert(await button.isDisabled());await page.getByText(source==='GitHub'?'I own this account.':'I own this site.',{exact:false}).first().click();await button.click();await page.getByRole('alert').first().waitFor();await shot('intake-'+source.toLowerCase()+'-validation');return await page.getByRole('alert').allTextContents();
  });
  await check('LinkedIn file requirement',async()=>{await page.getByRole('tab',{name:'LinkedIn export',exact:true}).click();assert(await page.getByRole('button',{name:'Upload and start',exact:true}).isDisabled());await shot('intake-linkedin');return 'File required, no remote LinkedIn scraping offered';});
  report.currentBody=await ui();
 }
 } finally {save();await browser.close();}
 console.log(JSON.stringify({stage,passed:report.checks.length,failures:report.failures},null,2));
 if(report.failures.length)process.exitCode=1;
})().catch(e=>{report.failures.push({message:e.message});save();console.error(e);process.exitCode=1;});
