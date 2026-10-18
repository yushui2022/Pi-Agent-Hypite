import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ensureBatchJob } from '../jobs/index.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fileOperations = new Map();
function withFile(file, operation) {
  // Polling readers must close their Windows handles before an atomic replacement.
  const previous = fileOperations.get(file) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  fileOperations.set(file, current);
  return current.finally(() => {
    if (fileOperations.get(file) === current) fileOperations.delete(file);
  });
}
function fail(message, status=400) { throw Object.assign(new Error(message), {status}); }
function text(value, name, max, required=false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${name}不能为空或超过${max}字`);
  return value.trim();
}
export function validateAccount(input) {
  if (!input || typeof input !== 'object') fail('账号资料无效');
  const result = {};
  for (const [key, label, max, required] of [['accountKey','账号编号',120,true],['name','账号名称',120,true],['group','分组',80,false],['language','语言',40,true],['audience','受众',400,false],['style','风格',400,false],['spec','输出规格',120,false],['market','目标市场',80,false],['restrictions','禁用表达',400,false]]) {
    result[key] = text(input[key] ?? '', label, max, required);
  }
  if(typeof input.active!=='boolean') fail('账号启用状态无效');
  return {...result, active: input.active};
}
async function read(file, fallback) { return withFile(file, async () => { try { return JSON.parse(await readFile(file,'utf8')); } catch(e) { if(e.code==='ENOENT' && fallback!==undefined)return fallback; throw e; } }); }
async function save(file,value) {
  return withFile(file, async () => {
  await mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  for(let attempt=0;;attempt++) {
    try { await rename(temp,file);return; } catch(e) { if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt===10)throw e; await new Promise(r=>setTimeout(r,30*(attempt+1))); }
  }
  });
}
const accountView = account => ({...account,revision:hash(account)});

export function createBulkManager(config) {
  const root=path.join(config.dataRoot,'.bulk'), accountFile=path.join(root,'accounts.json');
  const active=new Map(); let stopping=false;
  const accounts=()=>read(accountFile,[]);
  function batchFile(id) { if(!/^batch_[a-f0-9-]{36}$/.test(id))fail('批次 ID 无效'); return path.join(root,'batches',id+'.json'); }
  async function listAccounts() { return (await accounts()).map(accountView); }
  async function importAccounts(rows) {
    if(!Array.isArray(rows)||!rows.length||rows.length>200)fail('每次导入 1–200 个账号');
    const validated=rows.map(validateAccount), keys=validated.map(a=>a.accountKey.toLowerCase());
    if(new Set(keys).size!==keys.length)fail('导入内容存在重复账号编号');
    const existing=await accounts(),known=new Set(existing.map(a=>a.accountKey.toLowerCase()));
    const added=validated.filter(a=>!known.has(a.accountKey.toLowerCase())).map(a=>({...a,id:'account_'+randomUUID(),updatedAt:new Date().toISOString()}));
    if(existing.length+added.length>1000)fail('当前最多保存 1000 个账号');
    await save(accountFile,[...existing,...added]);
    return {added:added.length,skipped:rows.length-added.length,total:existing.length+added.length};
  }
  async function updateAccount(id,input,revision) {
    const data=validateAccount(input),all=await accounts(),index=all.findIndex(a=>a.id===id);
    if(index<0)fail('账号不存在',404);
    if(hash(all[index])!==revision)fail('账号资料已更新，请刷新后重试',409);
    if(all.some(a=>a.id!==id&&a.accountKey.toLowerCase()===data.accountKey.toLowerCase()))fail('账号编号已存在',409);
    all[index]={...data,id,updatedAt:new Date().toISOString()}; await save(accountFile,all);return accountView(all[index]);
  }
  async function createBatch(input) {
    if(!uuid.test(input.requestId))fail('需要有效的批次请求 ID');
    const title=text(input.title,'批次名称',120,true),product=text(input.product,'商品事实',4000,true),requirements=text(input.requirements,'制作要求',4000,true);
    if(!Array.isArray(input.accountIds)||!input.accountIds.length||input.accountIds.length>1000||input.accountIds.some(id=>typeof id!=='string'))fail('请选择有效账号');
    if(new Set(input.accountIds).size!==input.accountIds.length)fail('账号不可重复选择');
    if(!Number.isInteger(input.perAccount)||input.perAccount<1||input.perAccount>20||input.accountIds.length*input.perAccount>2000)fail('每账号 1–20 条，每批最多 2000 条');
    const normalized={title,product,requirements,accountIds:input.accountIds,perAccount:input.perAccount},fingerprint=hash(normalized);
    const id='batch_'+input.requestId,file=batchFile(id),old=await read(file,null);
    if(old) { if(old.fingerprint!==fingerprint)fail('此请求 ID 已用于另一个批次',409);return getBatch(id); }
    const all=await accounts();
    const snapshots=input.accountIds.map(id=>{const a=all.find(a=>a.id===id);if(!a||!a.active)fail('所选账号已停用或不存在，请刷新');return {...a};});
    const tasks=snapshots.flatMap(a=>Array.from({length:input.perAccount},(_,i)=>({id:'job_'+randomUUID(),accountId:a.id,sequence:i+1})));
    const batch={format:'production-batch@1',id,createdAt:new Date().toISOString(),fingerprint,title,product,requirements,perAccount:input.perAccount,accounts:snapshots,tasks,state:'planned',prepared:0,error:null};
    await save(file,batch);return getBatch(id);
  }
  async function bulkUpdateAccounts(items,patch) {
    const allowed=['group','language','audience','style','spec','market','restrictions','active'];
    if(!Array.isArray(items)||!items.length||items.length>200||items.some(i=>!i||typeof i.id!=='string'||typeof i.revision!=='string')||new Set(items.map(i=>i.id)).size!==items.length)fail('请选择 1–200 个不重复账号并提供版本');
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(k=>!allowed.includes(k)))fail('批量修改字段无效');
    // Validate the complete patch before any mutation, including requests with missing IDs.
    validateAccount({accountKey:'validation',name:'validation',language:'英语',active:true,...patch});
    const all=await accounts(),results=[];
    for(const item of items){
      const index=all.findIndex(a=>a.id===item.id);
      if(index<0){results.push({id:item.id,ok:false,error:'账号不存在'});continue;}
      if(hash(all[index])!==item.revision){results.push({id:item.id,ok:false,error:'资料已被修改，请查看最新资料后重新选择'});continue;}
      all[index]={...validateAccount({...all[index],...patch}),id:item.id,updatedAt:new Date().toISOString()};
      results.push({id:item.id,ok:true});
    }
    if(results.some(r=>r.ok))await save(accountFile,all);
    return {results};
  }
  async function accountBatches(id){
    if(!(await accounts()).some(a=>a.id===id))fail('账号不存在',404);
    const matches=[];
    for(const summary of await listBatches()){
      const batch=await getBatch(summary.id),snapshot=batch.accounts.find(a=>a.id===id);
      if(snapshot)matches.push({...summary,snapshot,tasks:batch.tasks.filter(t=>t.accountId===id)});
    }
    return matches;
  }
  async function getBatch(id) {
    const b=await read(batchFile(id));
    if(b.state==='preparing'&&!active.has(id))return {...b,state:'paused',error:'上次建档中断；点击继续建档，不会重复创建任务。'};
    return {...b,pauseRequested:!!active.get(id)?.paused};
  }
  async function listBatches() {
    await mkdir(path.join(root,'batches'),{recursive:true});
    const names=(await readdir(path.join(root,'batches'))).filter(n=>/^batch_[a-f0-9-]{36}\.json$/.test(n));
    const items=[];
    for(const name of names) { const b=await getBatch(name.slice(0,-5));items.push({id:b.id,title:b.title,createdAt:b.createdAt,state:b.state,prepared:b.prepared,total:b.tasks.length,accountCount:b.accounts.length,error:b.error}); }
    return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async function start(id) {
    if(stopping)fail('工作台正在退出',503);
    if(active.has(id))return getBatch(id);
    const b=await getBatch(id);
    if(b.state==='ready')return b;
    if(active.size)fail('已有批次正在建档，请先暂停或等待完成',409);
    const slot={paused:false,done:null};active.set(id,slot);
    b.state='preparing';b.error=null;
    try { await save(batchFile(id),b); }
    catch(e){active.delete(id);throw e;}
    slot.done=(async()=>{
      try {
        for(let i=b.prepared;i<b.tasks.length;i++) {
          if(slot.paused||stopping)break;
          const task=b.tasks[i],account=b.accounts.find(a=>a.id===task.accountId);
          const brief={title:`${b.title} · ${account.name} · ${task.sequence}`,account:account.name,language:account.language,product:b.product,requirements:[b.requirements,account.market&&`目标市场：${account.market}`,account.audience&&`目标受众：${account.audience}`,account.style&&`账号风格：${account.style}`,account.spec&&`输出规格：${account.spec}`,account.restrictions&&`禁用表达：${account.restrictions}`,`本账号第 ${task.sequence} 条，请另行确定内容差异。`].filter(Boolean).join('\n'),technicalSample:false,references:[]};
          await ensureBatchJob(config,brief,{id:task.id,batchId:id,accountId:account.id,sequence:task.sequence});
          b.prepared=i+1;await save(batchFile(id),b);
        }
        b.state=b.prepared===b.tasks.length?'ready':'paused';
      }catch(e){b.state='failed';b.error=e.message;}
      await save(batchFile(id),b);
    })().catch(e=>console.error('Batch progress persistence failed:',e.message)).finally(()=>active.delete(id));
    return {...b};
  }
  async function pause(id) { const b=await getBatch(id);const slot=active.get(id);if(slot)slot.paused=true;return {...b,pauseRequested:!!slot}; }
  return {listAccounts,importAccounts,updateAccount,bulkUpdateAccounts,accountBatches,createBatch,listBatches,getBatch,start,pause,
    async shutdown(){stopping=true;for(const slot of active.values())slot.paused=true;await Promise.all([...active.values()].map(slot=>slot.done));}};
}
