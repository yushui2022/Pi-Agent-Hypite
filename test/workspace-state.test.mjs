import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeListState, selectJobs, parseView } from '../apps/web/workspace-state.js';
const jobs = [
  {id:'a',title:'Beta',createdAt:'2026-10-01',technicalSample:false,brief:{account:'English',product:'cup'}},
  {id:'b',title:'Alpha',createdAt:'2026-10-02',technicalSample:true,brief:{account:'test',product:'demo'}},
  {id:'c',title:'Gamma',createdAt:'2026-10-03',technicalSample:false,brief:{account:'English',product:'bag'}},
];
test('筛选与排序组合，不改变原始任务顺序',()=>{
  assert.deepEqual(selectJobs(jobs,{filter:'production',query:' ENGLISH ',sort:'newest'}).map(x=>x.id),['c','a']);
  assert.deepEqual(selectJobs(jobs,{sort:'oldest'}).map(x=>x.id),['a','b','c']);
  assert.deepEqual(selectJobs(jobs,{sort:'title'}).map(x=>x.id),['b','a','c']);
  assert.deepEqual(selectJobs(jobs,{query:'cup'}).map(x=>x.id),['a']);
  assert.deepEqual(jobs.map(x=>x.id),['a','b','c']);
});
test('无效恢复参数回落默认值，详情路由只接受任务ID',()=>{
  assert.deepEqual(normalizeListState({filter:'bad',query:42,sort:'bad'}),{filter:'all',query:'',sort:'newest'});
  assert.equal(parseView('#job/../../secret').type,'tasks');
  assert.equal(parseView('#services').type,'services');
  assert.deepEqual(parseView('#job/job_12345678-1234-1234-1234-123456789abc'),{type:'job',id:'job_12345678-1234-1234-1234-123456789abc'});
});
