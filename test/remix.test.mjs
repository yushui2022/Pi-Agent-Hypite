import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../packages/application/index.mjs';
test('复刻项目：素材分片、范围预览、快照、多批次、缺素材和重启',async()=>{
 await mkdir('G:/DevCache/Temp/pi-agent-hypite/remix-tests',{recursive:true});
 const dataRoot=await mkdtemp('G:/DevCache/Temp/pi-agent-hypite/remix-tests/run-');let app=createApplication({dataRoot,tempRoot:dataRoot});
 const request=async(route,method='GET',body={})=>app.request({route,method,body});
 try{
 const c=await request('/api/remix','POST',{title:'无账号复刻项目',requestId:randomUUID()});assert.equal(c.status,201);const id=c.data.id,base='/api/remix/'+id;
 async function upload(name,bytes){const start=await request(base+'/begin','POST',{name,size:bytes.length});assert.equal(start.status,200);const uploadId=start.data.uploadId;assert.equal((await request(base+'/chunk','POST',{uploadId,offset:1,data:bytes.toString('base64')})).status,409);assert.equal((await request(base+'/chunk','POST',{uploadId,offset:0,data:bytes.toString('base64')})).status,200);return request(base+'/finish','POST',{uploadId});}
 // Header-only fixtures test transport and type guards, not video playback.
 const bytes=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(100)]);
 const first=await upload('参考.mp4',bytes);assert.equal(first.status,200);const ref=first.data.assetId;
 assert.equal((await upload('同内容.mp4',bytes)).data.duplicate,true);
 const image=Buffer.from('89504e470d0a1a0a0000000000000000','hex');const asset=(await upload('产品.png',image)).data.assetId;
 const p=(await request(base)).data;assert.equal(p.assets.length,2);
 const range=await fetch(p.assets[0].url,{headers:{Range:'bytes=4-11'}});assert.equal(range.status,206);assert.equal(await range.text(),'ftypisom');
 assert.equal((await fetch(p.assets[0].url.replace(/\/[a-f0-9]{48}\//,'/invalid/'))).status,404);
 assert.equal((await request(base+'/begin','POST',{name:'bad.html',size:10})).status,400);
 const plan={referenceId:ref,preserve:'保留结构',rows:[{key:'产品',start:0,end:3,type:'image',assetId:asset,value:''}]};
 const saved=await request(base+'/plan','POST',{revision:p.revision,plan});assert.equal(saved.status,200);
 assert.equal((await request(base+'/plan','POST',{revision:p.revision,plan})).status,409);
 const payload={requestId:randomUUID(),title:'批次A',revision:saved.data.revision,variants:[{label:'A1',overrides:{}}]};
 const b=await request(base+'/batches','POST',payload);assert.equal(b.status,200);assert.equal(b.data.batches[0].blocked.length,0);
 assert.equal((await request(base+'/batches','POST',payload)).data.batches.length,1);
 const edit=await request(base+'/plan','POST',{revision:b.data.revision,plan:{...plan,preserve:'新要求'}});assert.equal(edit.data.batches[0].plan.preserve,'保留结构');
 await unlink(path.join(dataRoot,'.remix',id,asset));
 const b2=await request(base+'/batches','POST',{...payload,requestId:randomUUID(),title:'批次B',revision:edit.data.revision});assert.equal(b2.data.batches.length,2);assert.match(b2.data.batches[1].blocked[0],/文件缺失/);
 assert.equal((await request(base+'/execute','POST',{})).status,409);
 await app.shutdown();app=createApplication({dataRoot,tempRoot:dataRoot});const restored=(await request(base)).data;assert.equal(restored.batches.length,2);assert.equal(restored.assets.find(a=>a.id===asset).available,false);assert.equal(restored.batches[0].outputs.length,0);
 }finally{await app.shutdown();}
});
