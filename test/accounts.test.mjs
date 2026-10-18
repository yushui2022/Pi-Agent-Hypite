import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../packages/application/index.mjs';
import {inspectImport,missingRules} from '../apps/web/accounts-model.js';
import {parseView} from '../apps/web/workspace-state.js';
test('映射导入保留行号、逐行错误、大小写重复与已存在跳过',()=>{
 const data='名称\t语言\t编号\n甲\t英语\tA\n乙\t\tB\n丙\t中文\ta\n丁\t英语\tD';
 const rows=inspectImport(data,[2,0,-1,1,-1,-1,-1,-1,-1],true,[{accountKey:'d'}]);
 assert.deepEqual(rows.map(r=>r.status),['new','error','error','skip']);
 assert.equal(rows[1].line,3);assert.match(rows[1].errors[0],/语言/);
 assert.throws(()=>inspectImport(data,[0,0]),/映射/);
 assert.deepEqual(missingRules({audience:'人群',style:' ',spec:''}),['风格','规格']);
 assert.deepEqual(parseView('#accounts/import'),{type:'accounts',id:'import'});
});
test('批量修改只更新指定字段和版本匹配项，关联批次保留旧规则',async()=>{
 await mkdir('G:/DevCache/Temp/pi-agent-hypite/accounts-tests',{recursive:true});
 const dir=await mkdtemp('G:/DevCache/Temp/pi-agent-hypite/accounts-tests/run-');
 const app=createApplication({dataRoot:dir,tempRoot:dir});
 const req=(route,method='GET',body={})=>app.request({route,method,body});
 try{
 const values=Array.from({length:45},(_,i)=>({accountKey:'a'+i,name:'账号'+i,group:'原分组',language:'英语',audience:'受众',style:'风格',spec:'9:16',active:true}));
 assert.equal((await req('/api/accounts/import','POST',{rows:values})).status,200);
 const old=(await req('/api/accounts')).data;
 const b=(await req('/api/batches','POST',{requestId:randomUUID(),title:'快照验收',product:'杯子',requirements:'演示',accountIds:[old[0].id],perAccount:1})).data;
 await req('/api/accounts/'+old[0].id,'PUT',{account:{...old[0],language:'中文'},revision:old[0].revision});
 const items=[old[0],old[40]].map(({id,revision})=>({id,revision}));
 const result=await req('/api/accounts/bulk-update','POST',{items,patch:{group:'新分组',market:'英国'}});
 assert.equal(result.status,200);assert.deepEqual(result.data.results.map(r=>r.ok),[false,true]);
 const now=(await req('/api/accounts')).data;assert.equal(now[0].group,'原分组');assert.equal(now[40].group,'新分组');assert.equal(now[40].style,'风格');assert.equal(now[39].group,'原分组');
 assert.equal((await req('/api/accounts/bulk-update','POST',{items:[{id:now[40].id,revision:now[40].revision}],patch:{language:''}})).status,400);
 assert.equal((await req('/api/accounts/bulk-update','POST',{items,patch:{name:'非法批量字段'}})).status,400);
 const related=(await req('/api/accounts/'+old[0].id+'/batches')).data;
 assert.equal(related[0].id,b.id);assert.equal(related[0].snapshot.language,'英语');assert.equal(related[0].tasks.length,1);
 }finally{await app.shutdown();}
});
