const { chromium } = require('playwright-core');
const projects=[{id:1,name:'Nate Agent',description:'站内 RAG Agent',full_name:'natricknye/nate-agent',html_url:'https://github.com/natricknye/nate-agent',homepage:'',language:'JavaScript',stars:12,forks:1,relation:'ownership',status:'active',priority:'high',last_commit_at:'2026-11-24T10:00:00Z',is_private:false,visible:true,open_tasks:2,commit_count:4,last_synced_at:'2026-11-25T01:00:00Z'},{id:2,name:'Dela',description:'校园 Agent 贡献',full_name:'other/dela',html_url:'https://github.com/other/dela',homepage:'',language:'TypeScript',stars:120,forks:20,relation:'contribute',status:'planning',priority:'medium',last_commit_at:'2026-11-20T10:00:00Z',is_private:false,visible:true,open_tasks:0,commit_count:2,last_synced_at:'2026-11-25T01:00:00Z'},{id:3,name:'Private Lab',description:'private',full_name:'natricknye/private-lab',html_url:'',homepage:'',language:'Rust',stars:0,forks:0,relation:'ownership',status:'paused',priority:'low',last_commit_at:null,is_private:true,visible:false,open_tasks:1,commit_count:1,last_synced_at:null}];
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});const c=await b.newContext({viewport:{width:1366,height:900}});const p=await c.newPage();let loggedIn=false;const errors=[];p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});p.on('pageerror',e=>errors.push(String(e)));
await p.route('**/api/**',async r=>{const u=new URL(r.request().url());const path=u.pathname;const method=r.request().method();let body={};
if(path==='/api/session')body={authenticated:loggedIn,configured:true};
else if(path==='/api/login'){loggedIn=true;body={ok:true};}
else if(path==='/api/logout'){loggedIn=false;body={ok:true};}
else if(path==='/api/projects')body={projects:projects.filter(x=>!x.is_private)};
else if(path==='/api/admin/projects')body={projects};
else if(path==='/api/projects/1')body={project:projects[0]};
else if(path==='/api/admin/projects/1')body={project:projects[0]};
else if(path==='/api/admin/projects/1/tasks')body={tasks:[{id:1,title:'补 diff 缓存',status:'doing',priority:'high',due_date:null,created_at:'2026-11-24T10:00:00Z'},{id:2,title:'写 README',status:'done',priority:'medium',due_date:null,created_at:'2026-11-23T10:00:00Z'}]};
else if(path==='/api/admin/projects/1/notes')body={notes:[{id:1,body_md:'## 进展\n\n- RAG 链路已通\n- 下一步：评测',created_at:'2026-11-24T10:00:00Z'}]};
else if(path==='/api/admin/projects/1/commits')body={commits:[{id:1,sha:'abc1234def',message:'feat: add pm board',author_name:'Nate',author_login:'natricknye',committed_at:'2026-11-24T10:00:00Z',html_url:''},{id:2,sha:'def5678abc',message:'fix: webhook sync',author_name:'Nate',author_login:'natricknye',committed_at:'2026-11-23T10:00:00Z',html_url:''}]};
else if(path==='/api/admin/commits/1/abc1234def/diff')body={diff:'diff --git a/src/App.jsx b/src/App.jsx\n+export default function App(){}\n'};
else if(path==='/api/admin/sync'&&method==='GET')body={sync:{finished_at:'2026-11-25T01:00:00Z',status:'ok'}};
else if(path==='/api/admin/sync'&&method==='POST')body={ok:true,repos:2,commits:3,errors:[]};
else body={error:'not_found'};
await r.fulfill({status:path.includes('not_found')?404:200,contentType:'application/json',body:JSON.stringify(body)});});
await p.goto('http://127.0.0.1:4175/#/',{waitUntil:'domcontentloaded',timeout:60000});await p.waitForTimeout(800);
console.log('public',JSON.stringify(await p.evaluate(()=>({title:document.title,cards:document.querySelectorAll('.project-card').length,tabs:[...document.querySelectorAll('.relation-tab')].map(x=>x.innerText),private:[...document.querySelectorAll('.tag.private')].length}))));
await p.locator('.project-card').first().click();await p.waitForTimeout(500);console.log('public-project',JSON.stringify(await p.evaluate(()=>({h1:document.querySelector('.project-head h1')?.innerText,tabs:document.querySelectorAll('.tab').length,loginHint:!!document.querySelector('.login-hint')}))));
await p.goto('http://127.0.0.1:4175/#/login',{waitUntil:'domcontentloaded'});await p.waitForTimeout(300);await p.fill('input[type=password]','test-password');await p.click('button[type=submit]');await p.waitForTimeout(800);console.log('login',JSON.stringify(await p.evaluate(()=>({hash:location.hash,login:!!document.querySelector('.login-card'),cards:document.querySelectorAll('.project-card').length}))));
await p.goto('http://127.0.0.1:4175/#/p/1',{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);console.log('admin-project',JSON.stringify(await p.evaluate(()=>({h1:document.querySelector('.project-head h1')?.innerText,tabs:[...document.querySelectorAll('.tab')].map(x=>x.innerText),admin:!!document.querySelector('.admin-panel')}))));
await p.getByRole('button',{name:'任务'}).click();await p.waitForTimeout(500);console.log('tasks',JSON.stringify(await p.evaluate(()=>({rows:document.querySelectorAll('.task-row').length,text:document.body.innerText.includes('补 diff 缓存')}))));
await p.getByRole('button',{name:'笔记'}).click();await p.waitForTimeout(500);console.log('notes',JSON.stringify(await p.evaluate(()=>({notes:document.querySelectorAll('.note').length,md:document.querySelector('.markdown h2')?.innerText}))));
await p.getByRole('button',{name:'Commits'}).click();await p.waitForTimeout(500);await p.locator('.commit-row').first().click();await p.waitForTimeout(500);console.log('commits',JSON.stringify(await p.evaluate(()=>({rows:document.querySelectorAll('.commit-row').length,diff:document.querySelector('.diff')?.innerText.slice(0,40)}))));
console.log('errors',JSON.stringify(errors));await b.close()})();

