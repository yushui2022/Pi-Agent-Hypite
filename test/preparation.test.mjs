import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPreparation} from '../packages/remix/preparation.mjs';

// Metadata fixtures intentionally do not represent decoded or generated media.
const fixture = () => ({id:'project', assets:[
  {id:'reference',name:'reference.mp4',mime:'video/mp4',available:true,size:1024,sha256:'expected-only'},
  {id:'product',name:'product.png',mime:'image/png',available:true,size:128},
], plan:{referenceId:'reference',rows:[
  {key:'商品',type:'image',start:0,end:15,assetId:'product',value:''},
  {key:'卖点',type:'text',start:0,end:15,assetId:'',value:'夏日轻装上阵'},
]}, batches:[]});
const codes = report => report.issues.map(issue=>issue.code);

test('准备检查只报告已知规格，不改变工程或假定媒体可以执行',()=>{
  const project=fixture(),before=structuredClone(project);
  const report=inspectPreparation(project,{revision:'r1'});
  assert.equal(report.status,'checked');assert.equal(report.canExecute,false);
  assert.deepEqual(report.totals,{errors:0,warnings:0});assert.equal(report.revision,'r1');
  assert.equal(report.assets[0].hashVerified,false);assert.equal(report.pendingChecks.length,3);
  assert.deepEqual(project,before);
  project.plan.rows[0].end=5;
  const partial=inspectPreparation(project);assert.equal(partial.totals.errors,0);
  assert.deepEqual(partial.variants[0].gaps,[{start:5,end:15}]);
  assert.ok(codes(partial).includes('visual.gaps'));
});

test('准备检查拒绝超界/错帧、同轨重叠、不支持字幕和不可用素材',()=>{
  const project=fixture();
  project.assets[0].name='reference.mov';project.assets[0].size=100_000_000;
  project.assets[1].available=false;
  project.plan.rows.push(
    {key:'冲突画面',type:'video',start:2.01,end:9,assetId:''},
    {key:'超长时间',type:'image',start:14,end:16,assetId:'product'},
    {key:'冲突字幕',type:'text',start:3,end:10,value:'🙂\nabcdefghijklmnop\n第三行'},
  );
  const report=inspectPreparation(project);
  for(const code of ['asset.format','asset.too-large','asset.missing','asset.unassigned','time.frame','time.range','visual.overlap','caption.overlap','caption.width','caption.lines','caption.characters']) assert.ok(codes(report).includes(code),code);
  assert.equal(report.status,'needs-changes');
  assert.equal(report.issues.find(issue=>issue.code==='visual.overlap').rowKey,'冲突画面');
});

test('批次检查遵循快照，识别改名或换顺序后的重复组合，保留历史大批次',()=>{
  const project=fixture(),plan=structuredClone(project.plan);
  project.batches.push({id:'old',plan,variants:Array.from({length:21},(_,index)=>({id:String(index),label:`版本 ${index}`,rows:index%2?[...plan.rows].reverse():plan.rows}))});
  project.plan={referenceId:'missing',rows:[]};
  const report=inspectPreparation(project,{batchId:'old'});
  assert.equal(report.source,'batch-snapshot');assert.equal(report.variants.length,21);
  assert.equal(report.totals.errors,1);assert.equal(report.totals.warnings,20);
  assert.ok(codes(report).includes('batch.limit'));
  assert.equal(report.issues.filter(issue=>issue.code==='variant.duplicate').length,20);
  assert.equal(project.batches[0].variants.length,21);
  assert.throws(()=>inspectPreparation(project,{batchId:'other'}),{status:404});
});

test('大量问题限制展示但保留准确的总数',()=>{
  const project=fixture();
  const rows=Array.from({length:100},(_,i)=>({key:`字幕 ${i}`,type:'text',start:0,end:15,value:''}));
  project.batches=[{id:'large',plan:project.plan,variants:Array.from({length:20},(_,i)=>({id:String(i),label:`版本 ${i}`,rows}))}];
  const report=inspectPreparation(project,{batchId:'large'});
  assert.equal(report.issues.length,500);assert.equal(report.truncated,true);
  assert.equal(report.issueCount,report.totals.errors+report.totals.warnings);
  assert.ok(report.issueCount>500);
});
