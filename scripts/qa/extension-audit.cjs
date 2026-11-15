/* eslint-disable @typescript-eslint/no-require-imports -- Directly executable CommonJS audit driver. */
const {chromium}=require('playwright');
const path=require('node:path');const fs=require('node:fs');
const dir=path.resolve('.unlazy/qa/evidence');
(async()=>{
 const extension=path.resolve('extension/dist');
 const context=await chromium.launchPersistentContext('.unlazy/qa/extension-profile',{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 const report={startedAt:new Date().toISOString(),checks:[],errors:[]};
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
  const id=new URL(worker.url()).host;report.extensionId=id;const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.getByLabel('App URL',{exact:true}).fill('http://localhost:3100');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.screenshot({path:path.join(dir,'extension-options-saved.png')});
  report.checks.push('Current extension built, loaded as an actual Chromium MV3 worker; options saved');
  await page.getByRole('button',{name:'Connect RoleSpec OS',exact:true}).click();
  await page.waitForTimeout(2500);
  const connect=context.pages().find(p=>p.url().includes('/extension/connect'));
  if(connect){
   await connect.getByRole('button',{name:'Connect',exact:true}).waitFor();await connect.screenshot({path:path.join(dir,'extension-consent.png')});await connect.getByRole('button',{name:'Connect',exact:true}).click();await page.waitForTimeout(1500);
   report.checks.push('Real extension consent and token handoff completed');
  }else report.blocked='Chrome identity authorization window was not exposed to headless page automation';
  if(!connect){
   const app=await context.newPage();await app.goto('http://localhost:3100/settings/api',{waitUntil:'domcontentloaded'});await app.getByLabel('Token name',{exact:true}).fill('Disposable browser QA');await app.getByRole('button',{name:'Create token',exact:true}).click();await app.locator('code').filter({hasText:/^rspec_/}).waitFor();const token=await app.locator('code').filter({hasText:/^rspec_/}).innerText();
   await page.getByLabel('API token',{exact:true}).fill(token);await page.getByRole('button',{name:'Save settings',exact:true}).click();await app.getByRole('button',{name:"I've saved it",exact:true}).click();report.checks.push('Fallback credential created through real web UI and saved in masked extension options; token omitted from evidence');
   const network=await worker.evaluate(async()=>{
    const settings=await chrome.storage.local.get(null);const stored=Object.values(settings).find(v=>v&&typeof v==='object'&&typeof v.apiToken==='string');
    const apiToken=stored?.apiToken||settings.apiToken;
    if(!apiToken)return {blocked:'Stored token could not be located without assuming storage schema'};
    const results=[];for(const route of ['/api/extension/profile','/api/extension/ats/answers','/api/extension/review-tasks']){try{const response=await fetch('http://localhost:3100'+route,{headers:{Authorization:'Bearer '+apiToken}});results.push({route,status:response.status})}catch(e){results.push({route,error:String(e)})}}return results;
   });report.extensionRequests=network;
   const row=app.locator('li').filter({has:app.getByText('Disposable browser QA',{exact:true})});await row.getByRole('button',{name:'Revoke',exact:true}).click();await row.waitFor({state:'hidden'});report.checks.push('Disposable QA token revoked after integration reads');await app.close();
  }
  await page.goto(`chrome-extension://${id}/sidepanel.html`);await page.waitForTimeout(1200);await page.screenshot({path:path.join(dir,'extension-sidepanel.png')});
  report.sidepanel=await page.locator('body').innerText();
 }finally{fs.writeFileSync(path.join(dir,'extension.json'),JSON.stringify(report,null,2));await context.close();}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
