import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadConfig } from '../packages/config/index.mjs';
import { createJob } from '../packages/jobs/index.mjs';
import { createAgentManager } from '../workers/agent/manager.mjs';
import { executeWorkspaceTool } from '../workers/agent/workspace-tools.mjs';
test('真实 Pi 注册、持久化、幂等请求、缺模型阻断及中断恢复', async()=>{
  const config=await loadConfig();await mkdir(config.tempRoot,{recursive:true});
  const root=await mkdtemp(path.join(config.tempRoot,'agent-test-'));
  Object.assign(config,{dataRoot:path.join(root,'jobs'),piHome:path.join(root,'pi'),agent:{provider:'',model:''}});
  const job=await createJob(config,{title:'接入测试',account:'测试',product:'测试',language:'中文',requirements:'不调用模型',technicalSample:true,references:[]});
  const manager=createAgentManager(config),requestId=randomUUID();
  try{
    await assert.rejects(manager.start(job.id,{mode:'author',prompt:'编写分镜',requestId:randomUUID()}),/尚未配置/);
    const run=await manager.start(job.id,{requestId});
    await assert.rejects(manager.start(job.id,{requestId:randomUUID()}),/已有会话/);
    let record;
    for(let i=0;i<60;i++){record=(await manager.runs(job.id))[0];if(record.finishedAt)break;await new Promise(r=>setTimeout(r,250));}
    assert.equal(record.status,'completed',JSON.stringify(record));assert.ok(record.sessionId);
    assert.equal((await manager.start(job.id,{requestId})).id,run.id);
    assert.equal((await manager.runs(job.id)).length,1);
    const stale={...record,id:'run_'+randomUUID(),status:'running',requestId:randomUUID()};
    await writeFile(path.join(job.directory,'agent-runs',stale.id+'.json'),JSON.stringify(stale));
    assert.equal((await manager.runs(job.id)).find(r=>r.id===stale.id).status,'interrupted');
    const stopped=await manager.start(job.id,{requestId:randomUUID()});await manager.stop(job.id);await manager.shutdown();
    assert.equal((await manager.runs(job.id)).find(r=>r.id===stopped.id).status,'cancelled');
  }finally{await manager.shutdown();}
});
test('工程工具可落盘，拒绝目录越界和脚本写入',async()=>{
  const config=await loadConfig();await mkdir(config.tempRoot,{recursive:true});const workspace=await mkdtemp(path.join(config.tempRoot,'tools-'));
  const c={workspace,skillRoot:path.dirname(config.skillPath)};
  await executeWorkspaceTool('workspace_write',{path:'notes/plan.md',content:'真实方案'},c);
  assert.equal(await executeWorkspaceTool('workspace_read',{scope:'project',path:'notes/plan.md'},c),'真实方案');
  await assert.rejects(executeWorkspaceTool('workspace_read',{path:'../secret'},c),/relative/);
  await assert.rejects(executeWorkspaceTool('workspace_write',{path:'run.js',content:'bad'},c),/Only/);
  assert.match(await executeWorkspaceTool('workspace_read',{scope:'skill',path:'SKILL.md'},c),/hypit/i);
});
