import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import crypto from 'node:crypto';
const root = path.resolve(new URL('..', import.meta.url).pathname);

test('HTTP integration: auth, both HTML entries, account isolation, concurrent existing/new read writes', {timeout:60000}, async t => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(),'ftw-update-api-'));
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const password=crypto.randomUUID();
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:data,FTW_STORAGE:'json',PORT:String(port),FTW_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await fs.rm(data,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert(ready,log);
  const get=async(p,user)=>fetch(base+p,{headers:user?{Authorization:'Bearer '+user.token}:{}});
  const post=async(p,body,user)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},body:JSON.stringify(body)});
  const v=await get('/api/version');assert.equal(v.headers.get('cache-control'),'no-store');const version=await v.json();assert.deepEqual(Object.keys(version).sort(),['buildId','updating']);
  assert.equal((await get('/api/announcement')).status,401);
  assert.equal((await post('/api/announcement/read',{})).status,401);
  for(const page of ['/','/index.html','/salesflow.html']){const html=await (await get(page)).text();assert(html.includes('window.__FTW_BUILD__='+JSON.stringify(version.buildId)));assert(html.includes('update-notice.js'));}
  for(const p of ['/server.js','/app.js.bak-test','/.env'])assert.equal((await get(p)).status,404);
  const admin=await (await post('/api/login',{username:'admin',password})).json();assert(admin.token);
  const a=await get('/api/announcement',admin);assert.equal(a.headers.get('cache-control'),'no-store');const announcement=(await a.json()).announcement;assert(announcement.id);
  assert.equal((await post('/api/announcement/read',{userId:'wrong-user',id:announcement.id},admin)).status,409);
  assert.equal((await post('/api/announcement/read',{userId:admin.id,id:'wrong-id'},admin)).status,409);
  const writes=Array.from({length:12},(_,i)=>post('/api/notifications/dismiss',{key:'test|'+i},admin));
  writes.push(post('/api/announcement/read',{id:announcement.legacyIds?.[0] || announcement.id,userId:admin.id},admin));
  for(const r of await Promise.all(writes))assert.equal(r.status,200,await r.text());
  const saved=JSON.parse(await fs.readFile(path.join(data,'notifications.json'),'utf8'));
  assert.equal(Object.keys(saved[admin.id]).length,13);
  assert.equal(saved[admin.id]['announce:'+announcement.id].read,true);
  assert.equal((await (await get('/api/announcement',admin)).json()).read,true);
  assert.equal((await post('/api/users',{username:'second',password,name:'Test B'},admin)).status,201);
  const second=await (await post('/api/login',{username:'second',password})).json();
  const b=await (await get('/api/announcement',second)).json();assert.equal(b.userId,second.id);assert.equal(b.read,false);
});
