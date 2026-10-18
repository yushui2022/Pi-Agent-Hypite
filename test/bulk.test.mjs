import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile,writeFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../packages/application/index.mjs';
import { createBulkManager } from '../packages/bulk/index.mjs';
import { showJob,updateBrief } from '../packages/jobs/index.mjs';
import { parseAccountsTsv } from '../apps/web/bulk-format.js';
async function config(){const base='G:/DevCache/Temp/pi-agent-hypite/bulk-tests';await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-'));return {dataRoot:path.join(root,'jobs'),tempRoot:root};}
const account=i=>({accountKey:`shop-${i}`,name:`账号 ${i}`,group:i%2?'英语组':'西语组',language:i%2?'英语':'西班牙语',audience:'生活方式',style:'实用演示',spec:'9:16，20秒',active:true});
const input=ids=>({requestId:randomUUID(),title:'规模验收',product:'咖啡杯',requirements:'只建立需求与工程目录，不调用模型',accountIds:ids,perAccount:3});
async function settled(manager,id){for(let i=0;i<1500;i++){const b=await manager.getBatch(id);if(b.state!=='preparing')return b;await new Promise(r=>setTimeout(r,20));}throw new Error('批次超时');}

test('账号导入校验、去重、版本冲突与停用保护',async()=>{
  const c=await config(),app=createApplication(c);const request=(route,method='GET',body={})=>app.request({route,method,body});
  try{
    assert.equal((await request('/api/accounts/import','POST',{rows:[account(1),account(1)]})).status,400);
    assert.equal((await request('/api/accounts')).data.length,0);
    assert.equal((await request('/api/accounts/import','POST',{rows:[account(1)]})).data.added,1);
    assert.equal((await request('/api/accounts/import','POST',{rows:[{...account(1),accountKey:'SHOP-1',name:'不得覆盖'}]})).data.skipped,1);
    const a=(await request('/api/accounts')).data[0];assert.equal(a.name,'账号 1');
    const update={account:{...a,active:false},revision:a.revision};
    assert.equal((await request('/api/accounts/'+a.id,'PUT',update)).status,200);
    assert.equal((await request('/api/accounts/'+a.id,'PUT',update)).status,409);
    assert.equal((await request('/api/batches','POST',input([a.id]))).status,400);
    assert.equal((await request('/api/batches','POST',{...input([a.id]),perAccount:999})).status,400);
  }finally{await app.shutdown();}
});

test('200 账号 × 3 条：快照固定、暂停恢复、重复确认与 600 个真实任务', {timeout:120000},async()=>{
  const c=await config();let manager=createBulkManager(c);
  await manager.importAccounts(Array.from({length:200},(_,i)=>account(i)));
  const accounts=await manager.listAccounts(),plan=input(accounts.map(a=>a.id));
  const batch=await manager.createBatch(plan);assert.equal(batch.tasks.length,600);assert.equal(batch.prepared,0);
  assert.equal((await readdir(c.dataRoot)).filter(n=>n.startsWith('job_')).length,0);
  assert.equal((await manager.createBatch(plan)).id,batch.id);
  await assert.rejects(manager.createBatch({...plan,title:'不同请求'}),/请求 ID/);
  await manager.updateAccount(accounts[0].id,{...accounts[0],language:'日语'},accounts[0].revision);
  await manager.start(batch.id);await manager.pause(batch.id);await manager.shutdown();
  manager=createBulkManager(c);
  const paused=await manager.getBatch(batch.id);assert.equal(paused.state,'paused');
  await manager.start(batch.id);await manager.start(batch.id);
  const ready=await settled(manager,batch.id);assert.equal(ready.state,'ready',ready.error);assert.equal(ready.prepared,600);
  assert.equal((await readdir(c.dataRoot)).filter(n=>n.startsWith('job_')).length,600);
  const first=await showJob(c,ready.tasks[0].id);assert.equal(first.brief.language,'西班牙语');assert.equal(first.batchId,batch.id);assert.equal(first.status,'draft');
  const last=await showJob(c,ready.tasks.at(-1).id);assert.equal(last.brief.language,'英语');assert.equal(last.sequence,3);
  await manager.start(batch.id);assert.equal((await readdir(c.dataRoot)).filter(n=>n.startsWith('job_')).length,600);
  await manager.shutdown();
});

test('任务落盘但进度落盘前中断：恢复不重复、不覆盖已编辑需求',async()=>{
  const c=await config();let manager=createBulkManager(c);await manager.importAccounts([account(1)]);
  const batch=await manager.createBatch(input((await manager.listAccounts()).map(a=>a.id)));
  await manager.start(batch.id);const ready=await settled(manager,batch.id);await manager.shutdown();
  const job=await showJob(c,ready.tasks[0].id);await updateBrief(c,job.id,{...job.brief,requirements:'用户后来修改的内容'},job.revision);
  const file=path.join(c.dataRoot,'.bulk/batches',batch.id+'.json'),journal=JSON.parse(await readFile(file,'utf8'));
  journal.state='preparing';journal.prepared=0;await writeFile(file,JSON.stringify(journal));
  manager=createBulkManager(c);assert.equal((await manager.getBatch(batch.id)).state,'paused');
  await manager.start(batch.id);assert.equal((await settled(manager,batch.id)).prepared,3);
  assert.equal((await readdir(c.dataRoot)).filter(n=>n.startsWith('job_')).length,3);
  assert.equal((await showJob(c,job.id)).brief.requirements,'用户后来修改的内容');await manager.shutdown();
});

test('Excel TSV 解析保留空列，拒绝重复编号和非 Tab 输入',()=>{
  const rows=parseAccountsTsv('abc\t账号\t\t英语\t\t风格\r\n');assert.equal(rows[0].group,'');assert.equal(rows[0].style,'风格');
  assert.throws(()=>parseAccountsTsv('abc,账号,分组,英语'),/Tab/);
  assert.throws(()=>parseAccountsTsv('abc\t甲\t组\t英语\nABC\t乙\t组\t英语'),/重复/);
});
