import test from 'node:test';
import assert from 'node:assert/strict';
import {projectStage,batchIssues,filterItems,pageItems} from '../apps/saas-web/workspace-model.js';
test('项目下一步以真实参考、映射和素材为依据；旧批次按自己的快照核对',()=>{
 const p={assets:[],plan:{referenceId:'v',rows:[]},batches:[]};
 assert.equal(projectStage(p).key,'reference');
 p.assets.push({id:'v',available:true,mime:'video/webm'});assert.equal(projectStage(p).key,'mapping');
 p.plan.rows=[{key:'文案',type:'text',value:'  '}];assert.equal(projectStage(p).key,'materials');
 p.plan.rows[0].value='已填写';assert.equal(projectStage(p).key,'batch');
 const batch={plan:{referenceId:'v'},variants:[{label:'旧版本',rows:[{key:'产品',type:'image',assetId:'missing'}]}]};p.batches.push(batch);
 assert.equal(projectStage(p).key,'planned');assert.equal(batchIssues(batch,p).length,1);
 p.assets.push({id:'missing',available:true,mime:'image/png'});assert.deepEqual(batchIssues(batch,p),[]);
 p.assets[0].available=false;assert.equal(projectStage(p).key,'reference');assert.match(batchIssues(batch,p)[0],/参考视频缺失/);
});
test('筛选后页码收敛且保留匹配项目，不因旧页码显示假空结果',()=>{
 const items=Array.from({length:25},(_,i)=>({title:i===24?'中文 Project':'其他'+i}));
 const filtered=filterItems(items,'PROJECT',p=>p.title);const page=pageItems(filtered,3);
 assert.equal(page.page,1);assert.equal(page.rows[0].title,'中文 Project');assert.equal(pageItems([],5).page,1);
});
