import { createAgentManager } from '../../workers/agent/manager.mjs';
import { listJobs,createJob,showJob,updateBrief,inspectJob } from '../jobs/index.mjs';
import { createBulkManager } from '../bulk/index.mjs';
import { createRemixManager } from '../remix/index.mjs';

// HTTP and desktop IPC share this domain entry; neither owns a second task state.
export function createApplication(config) {
  const agent=createAgentManager(config),checks=new Set(),pending=new Set();
  const bulk=createBulkManager(config);
  const remix=createRemixManager(config);
  let writes=Promise.resolve(),closing=false;
  const serialize=fn=>{const result=writes.then(fn);writes=result.catch(()=>{});return result;};
  async function dispatch({route,method='GET',body={}}) {
    if(closing)return {status:503,data:{error:'运行时正在退出'}};
    if(typeof route!=='string'||!['GET','POST','PUT'].includes(method)||body===null||typeof body!=='object'||Array.isArray(body))return {status:400,data:{error:'无效请求'}};
    const send=(status,data)=>({status,data});
    try {
      if(route==='/api/remix'&&method==='GET')return send(200,await remix.list());
      if(route==='/api/remix'&&method==='POST')return send(201,await serialize(()=>remix.create(body)));
      const remixRoute=route.match(/^\/api\/remix\/(remix_[a-f0-9-]{36})(?:\/(begin|chunk|abort|finish|plan|batches|check|execute))?$/);
      if(remixRoute){const [,id,action]=remixRoute;if(method==='GET'&&!action)return send(200,await remix.show(id));if(method==='POST'&&action){if(action==='execute')return send(409,{error:'真实替换制作尚未接通。计划已保存，未提交生成请求，也未产生制作费用。'});const fn={plan:'savePlan',batches:'makeBatch'}[action]||action;return send(200,await serialize(()=>remix[fn](id,body)));}}
      if(method==='GET'&&route==='/api/accounts')return send(200,await bulk.listAccounts());
      if(method==='POST'&&route==='/api/accounts/bulk-update')return send(200,await serialize(()=>bulk.bulkUpdateAccounts(body.items,body.patch)));
      const accountBatches=route.match(/^\/api\/accounts\/(account_[a-f0-9-]{36})\/batches$/);
      if(accountBatches&&method==='GET')return send(200,await bulk.accountBatches(accountBatches[1]));
      if(method==='POST'&&route==='/api/accounts/import')return send(200,await serialize(()=>bulk.importAccounts(body.rows)));
      const accountRoute=route.match(/^\/api\/accounts\/(account_[a-f0-9-]{36})$/);
      if(accountRoute&&method==='PUT')return send(200,await serialize(()=>bulk.updateAccount(accountRoute[1],body.account,body.revision)));
      if(method==='GET'&&route==='/api/batches')return send(200,await bulk.listBatches());
      if(method==='POST'&&route==='/api/batches')return send(201,await serialize(()=>bulk.createBatch(body)));
      const batchRoute=route.match(/^\/api\/batches\/(batch_[a-f0-9-]{36})(?:\/(start|pause))?$/);
      if(batchRoute&&method==='GET'&&!batchRoute[2])return send(200,await bulk.getBatch(batchRoute[1]));
      if(batchRoute&&method==='POST'&&batchRoute[2])return send(202,await serialize(()=>bulk[batchRoute[2]](batchRoute[1])));
      if(method==='GET'&&route==='/api/services')return send(200,{mode:'local',generation:false,agent:await agent.status(),message:'Pi 会话与 Hypit 检查已接入。配置模型后可准备工程；视频生成服务尚未接通。'});
      if(method==='GET'&&route==='/api/jobs')return send(200,await listJobs(config,{summary:true}));
      if(method==='POST'&&route==='/api/jobs')return send(201,await serialize(()=>createJob(config,body)));
      const match=route.match(/^\/api\/jobs\/(job_[a-f0-9-]{36})(?:\/(brief|duplicate|inspect|agent-runs|agent-stop))?$/);
      if(!match)return send(404,{error:'接口不存在'});
      const [,id,action]=match;
      if(method==='GET'&&!action)return send(200,await showJob(config,id));
      if(method==='GET'&&action==='agent-runs')return send(200,await agent.runs(id));
      if(method==='POST'&&action==='agent-runs')return send(202,await agent.start(id,body));
      if(method==='POST'&&action==='agent-stop')return send(202,await agent.stop(id));
      if(method==='PUT'&&action==='brief')return send(200,await serialize(()=>updateBrief(config,id,body.brief,body.revision)));
      if(method==='POST'&&action==='duplicate'){
        const job=await showJob(config,id);
        return send(201,await serialize(()=>createJob(config,{...job.brief,title:`${job.title} · 变体`})));
      }
      if(method==='POST'&&action==='inspect'){
        if(checks.has(id))return send(409,{error:'此任务正在检查，请稍后再试'});
        checks.add(id);
        try{return send(200,await inspectJob(config,id,body.operation,body.source));}finally{checks.delete(id);}
      }
      return send(404,{error:'接口不存在'});
    }catch(error){return send(error.status||(error.code==='ENOENT'?404:400),{error:error.code==='ENOENT'?'文件或任务不存在，请先准备工程文件':error.message});}
  }
  return {
    agent,
    request(input){const task=dispatch(input && typeof input==='object' ? input : {});pending.add(task);task.then(()=>pending.delete(task),()=>pending.delete(task));return task;},
    async shutdown(){closing=true;await Promise.allSettled([...pending]);await bulk.shutdown();await remix.shutdown();await agent.shutdown();await writes;},
  };
}
