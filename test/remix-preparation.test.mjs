import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,unlink,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRemixManager} from '../packages/remix/index.mjs';

test('检查只读、冲突保护、文件变化、批次复制快照与幂等',async()=>{
  const temp='G:/DevCache/Temp/pi-agent-hypite/preparation-tests';await mkdir(temp,{recursive:true});
  const dataRoot=await mkdtemp(temp+'/run-'),manager=createRemixManager({dataRoot,remixMediaBase:'/api/media'});
  try {
    let project=await manager.create({requestId:randomUUID(),title:'本地准备测试'});
    const id=project.id;
    // Header-only transport fixture; not a media-decode or generation test.
    const bytes=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(100)]);
    const upload=await manager.begin(id,{name:'参考.mp4',size:bytes.length});
    await manager.chunk(id,{...upload,offset:0,data:bytes.toString('base64')});
    const {assetId}=await manager.finish(id,upload);project=await manager.show(id);
    const plan={referenceId:assetId,preserve:'原始要求',rows:[
      {key:'画面',start:0,end:15,type:'video',assetId,value:''},
      {key:'constructor',start:0,end:15,type:'text',assetId:'',value:'原始文案'},
    ]};
    project=await manager.savePlan(id,{revision:project.revision,plan});
    let report=await manager.check(id,{revision:project.revision});assert.equal(report.totals.errors,0);
    assert.equal((await manager.show(id)).revision,project.revision);
    await assert.rejects(()=>manager.check(id,{revision:'old'}),{status:409});
    await assert.rejects(()=>manager.check(id,{revision:project.revision,batchId:randomUUID()}),{status:404});
    const sourceId=randomUUID();project=await manager.makeBatch(id,{requestId:sourceId,title:'原批次',revision:project.revision,variants:[{label:'A',overrides:{}}]});
    const original=structuredClone(project.batches[0]);
    assert.equal(original.variants[0].rows[1].value,'原始文案');
    project=await manager.savePlan(id,{revision:project.revision,plan:{...plan,preserve:'当前要求已改',rows:[{...plan.rows[0],end:20}]}});
    assert.ok((await manager.check(id,{revision:project.revision})).totals.errors>0);
    assert.equal((await manager.check(id,{revision:project.revision,batchId:sourceId})).totals.errors,0);
    const body={requestId:randomUUID(),title:'新版本',revision:project.revision,sourceBatchId:sourceId,variants:[{label:'B',overrides:{constructor:'新的卖点'}}]};
    project=await manager.makeBatch(id,body);
    const copied=project.batches[1];assert.deepEqual(project.batches[0],original);
    assert.deepEqual(copied.plan,original.plan);assert.equal(copied.sourceBatchId,sourceId);
    assert.equal(copied.variants[0].rows[1].value,'新的卖点');
    assert.notEqual(copied.variants[0].id,original.variants[0].id);
    assert.equal(project.plan.preserve,'当前要求已改');
    assert.equal((await manager.makeBatch(id,body)).batches.length,2);
    await assert.rejects(()=>manager.makeBatch(id,{...body,title:'不同内容'}),{status:409});
    await assert.rejects(()=>manager.makeBatch(id,{...body,requestId:randomUUID(),revision:project.revision,sourceBatchId:randomUUID()}),{status:404});
    await assert.rejects(()=>manager.makeBatch(id,{...body,requestId:randomUUID(),revision:project.revision,sourceBatchId:42}),{status:400});
    await assert.rejects(()=>manager.makeBatch(id,{...body,requestId:randomUUID(),revision:project.revision,variants:Array.from({length:21},(_,i)=>({label:String(i),overrides:{}}))}),{status:400});
    await unlink(path.join(dataRoot,'.remix',id,assetId));
    report=await manager.check(id,{revision:project.revision,batchId:sourceId});
    assert.ok(report.issues.some(issue=>issue.code==='asset.missing'));
    assert.equal((await manager.show(id)).revision,project.revision);
    for(const damage of ['missing','truncated','same-size-corruption']){
      const target=path.join(dataRoot,'.remix',id,assetId);
      if(damage!=='missing')await writeFile(target,Buffer.alloc(damage==='truncated'?8:bytes.length));
      const replacement=await manager.begin(id,{name:'重新导入.mp4',size:bytes.length});
      await manager.chunk(id,{...replacement,offset:0,data:bytes.toString('base64')});
      const restored=await manager.finish(id,replacement);
      assert.deepEqual(restored,{assetId,duplicate:true,restored:true},damage);
      assert.deepEqual(await readFile(target),bytes);
      const reread=await manager.show(id);assert.equal(reread.assets.length,1);
      assert.equal(reread.revision,project.revision);assert.deepEqual(reread.batches[0],original);
      assert.equal((await manager.check(id,{revision:project.revision,batchId:sourceId})).totals.errors,0);
    }
  }finally{await manager.shutdown();}
});
