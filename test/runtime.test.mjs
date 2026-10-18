import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../packages/config/index.mjs';

test('stdio：真实业务、坏请求、并发写入、重启持久化、正常退出', {timeout:20000}, async()=>{
  const base='G:/DevCache/Temp/pi-agent-hypite/stdio-tests';
  await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'run-'));
  const config=path.join(root,'config.json');
  await writeFile(config,JSON.stringify({dataRoot:path.join(root,'jobs'),piHome:path.join(root,'pi'),tempRoot:root}));
  function launch(){
    const child=spawn(process.execPath,['apps/runtime/stdio.mjs',config],{cwd:projectRoot,stdio:['pipe','pipe','pipe'],windowsHide:true});
    const exited=once(child,'exit');
    const pending=new Map();let sequence=0,stderr='';
    child.stderr.on('data',chunk=>stderr+=chunk);
    let readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);
    createInterface({input:child.stdout}).on('line',line=>{const result=JSON.parse(line);if(result.event==='ready')readyResolve(result);else{pending.get(result.id)?.(result);pending.delete(result.id);}});
    function request(payload){const id=String(++sequence);return new Promise(resolve=>{pending.set(id,resolve);child.stdin.write(JSON.stringify({protocol:1,id,...payload})+'\n');});}
    return {child,ready,request,exited,stderr:()=>stderr};
  }
  let session=launch();
  try{
    assert.equal((await session.ready).protocol,1);
    assert.equal((await session.request({route:'/api/no-such-route'})).status,404);
    assert.equal((await session.request({route:'/api/jobs',method:'POST',body:null})).status,400);
    const brief={title:'IPC验收',account:'内部',product:'待补充',language:'中文',requirements:'持久化测试',technicalSample:false,references:[]};
    const results=await Promise.all([1,2,3].map(()=>session.request({route:'/api/jobs',method:'POST',body:brief})));
    for(const result of results)assert.equal(result.status,201);
    assert.equal(new Set(results.map(r=>r.data.id)).size,3);
    const job=results[0].data;
    assert.equal((await session.request({command:'shutdown'})).data.stopped,true);
    assert.equal((await session.exited)[0],0,session.stderr());
    session=launch();await session.ready;
    assert.equal((await session.request({route:'/api/jobs'})).data.length,3);
    assert.equal((await session.request({route:`/api/jobs/${job.id}`})).data.title,'IPC验收');
    await session.request({command:'shutdown'});
    assert.equal((await session.exited)[0],0,session.stderr());
  }finally{session.child.kill();}
});

test('stdio：协议版本和超限帧拒绝，结束输入后不会遗留进程', {timeout:10000}, async()=>{
  const base='G:/DevCache/Temp/pi-agent-hypite/stdio-tests';await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'invalid-'));
  const config=path.join(root,'config.json');
  await writeFile(config,JSON.stringify({dataRoot:path.join(root,'jobs'),piHome:path.join(root,'pi'),tempRoot:root}));
  const child=spawn(process.execPath,['apps/runtime/stdio.mjs',config],{cwd:projectRoot,stdio:['pipe','pipe','pipe'],windowsHide:true});
  const exited=once(child,'exit'),lines=[];let stderr='';
  child.stderr.on('data',chunk=>stderr+=chunk);
  createInterface({input:child.stdout}).on('line',line=>lines.push(JSON.parse(line)));
  try{
    child.stdin.write('{invalid json}\n');
    child.stdin.write(JSON.stringify({protocol:2,id:'invalid',route:'/api/jobs'})+'\n');
    child.stdin.end('x'.repeat(65537));
    assert.equal((await exited)[0],0);
    assert.equal(lines.filter(line=>line.status===400).length,2);
    assert.match(stderr,/frame too large/);
    assert.equal(lines.at(-1).data.stopped,true);
  }finally{child.kill();}
});
