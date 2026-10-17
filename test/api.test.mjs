import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../apps/api/server.mjs';

test('HTTP 闭环：创建、编辑、冲突保护、复制、重启持久化、跨站拒绝', async () => {
  const temp = 'G:/DevCache/Temp/pi-agent-hypite/api-tests';
  await mkdir(temp, {recursive:true});
  const root = await mkdtemp(path.join(temp, 'run-'));
  const config = {dataRoot:path.join(root,'jobs'),tempRoot:root,hypitRoot:'G:/Projects/hypit'};
  let server = createApp(config);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const request = (route,method='GET',body,headers={})=>fetch(base+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  try {
    const brief={title:'API验收',account:'内部',product:'待补充',language:'英语',requirements:'待补充',technicalSample:false,references:[]};
    assert.deepEqual(await (await request('/api/jobs')).json(),[]);
    assert.equal((await request('/')).status,200);
    const created=await request('/api/jobs','POST',brief); assert.equal(created.status,201);
    const job=await created.json();
    const saved=await (await request(`/api/jobs/${job.id}`)).json();
    const changed={...brief,title:'已修改',requirements:'已保存的创作要求'};
    assert.equal((await request(`/api/jobs/${job.id}/brief`,'PUT',{revision:saved.revision,brief:changed})).status,200);
    assert.equal((await request(`/api/jobs/${job.id}/brief`,'PUT',{revision:saved.revision,brief})).status,409);
    const duplicate=await (await request(`/api/jobs/${job.id}/duplicate`,'POST',{})).json();
    assert.notEqual(duplicate.id,job.id);
    assert.equal((await request('/api/jobs','POST',brief,{Origin:'https://foreign.invalid'})).status,403);
    assert.equal((await request('/api/jobs','POST',{...brief,title:''})).status,400);
    const rejectedHost = await new Promise((resolve,reject)=>{
      const req=http.get(base+'/api/jobs',{headers:{Host:'foreign.invalid'}},res=>{res.resume();resolve(res.statusCode);}); req.on('error',reject);
    });
    assert.equal(rejectedHost,403);
    await new Promise(resolve=>server.close(resolve));
    server=createApp(config); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    base=`http://127.0.0.1:${server.address().port}`;
    const after=await (await request(`/api/jobs/${job.id}`)).json();
    assert.equal(after.title,'已修改'); assert.equal(after.brief.requirements,changed.requirements);
    assert.equal((await (await request('/api/jobs')).json()).length,2);
    assert.equal((await (await request('/api/services')).json()).generation,false);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
