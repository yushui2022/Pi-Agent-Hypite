import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {createSaasServer} from '../apps/saas-api/server.mjs';
test('SaaS：双用户隔离、素材鉴权、退出撤销和数据库重启恢复',async()=>{
 await mkdir('G:/DevCache/Temp/pi-agent-hypite/saas-tests',{recursive:true});
 const dataRoot=await mkdtemp('G:/DevCache/Temp/pi-agent-hypite/saas-tests/run-');let server,origin;
 async function start(){server=await createSaasServer({dataRoot});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;}
 async function request(route,{cookie='',body,headers={},method=body?'POST':'GET'}={}){return fetch(origin+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});}
 await start();try{
 assert.equal((await request('/api/remix')).status,401);
 async function register(email){const r=await request('/api/auth/register',{body:{email,name:email,password:'test-password-123'}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);return r.headers.get('set-cookie').split(';')[0];}
 const a=await register('a@example.test'),b=await register('b@example.test');
 assert.equal((await request('/api/auth/login',{body:{email:'a@example.test',password:'incorrect-password'}})).status,401);
 assert.equal((await request('/api/remix',{cookie:a,body:{},headers:{Origin:'https://evil.invalid'}})).status,403);
 const requestId=randomUUID();const created=await request('/api/remix',{cookie:a,body:{title:'私有中文项目',requestId}});assert.equal(created.status,201);const p=await created.json(),base='/api/remix/'+p.id;
 assert.equal((await request(base,{cookie:b})).status,404);
 assert.equal((await request(base+'/begin',{cookie:b,body:{name:'x.png',size:16}})).status,404);
 assert.equal((await request('/api/remix',{cookie:b,body:{title:'collision',requestId}})).status,409);
 assert.deepEqual(await (await request('/api/remix',{cookie:b})).json(),[]);
 const bytes=Buffer.from('89504e470d0a1a0a0000000000000000','hex');
 const begin=await (await request(base+'/begin',{cookie:a,body:{name:'图片.png',size:bytes.length}})).json();
 assert.equal((await request(base+'/chunk',{cookie:a,body:{uploadId:begin.uploadId,offset:0,data:bytes.toString('base64')}})).status,200);
 assert.equal((await request(base+'/finish',{cookie:a,body:{uploadId:begin.uploadId}})).status,200);
 const saved=await (await request(base,{cookie:a})).json(),url=saved.assets[0].url;
 assert.equal((await request(url)).status,401);assert.equal((await request(url,{cookie:b})).status,404);
 const media=await request(url,{cookie:a,headers:{Range:'bytes=0-7'}});assert.equal(media.status,206);assert.deepEqual(Buffer.from(await media.arrayBuffer()),bytes.subarray(0,8));
 assert.equal((await request(base+'/execute',{cookie:a,body:{}})).status,409);
 await server.shutdown();await start();assert.equal((await request(base,{cookie:a})).status,200);assert.equal((await request(url,{cookie:a})).status,200);
 assert.equal((await request('/api/auth/logout',{cookie:a,body:{}})).status,200);assert.equal((await request(url,{cookie:a})).status,401);
 assert.equal((await request('/api/auth/me',{cookie:b})).status,200);
 }finally{await server.shutdown();}
});
test('SaaS 部署边界：API 独立模式、HTTPS Cookie、域名和来源校验、完整想法持久化',async()=>{
 const dataRoot=await mkdtemp('G:/DevCache/Temp/pi-agent-hypite/saas-tests/deploy-');
 const server=await createSaasServer({dataRoot,publicOrigin:'https://studio.example.test',serveWeb:false});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 const request=(route,body,cookie,headers={})=>new Promise((resolve,reject)=>{const req=http.request(url+route,{method:body?'POST':'GET',headers:{Host:'studio.example.test',Origin:'https://studio.example.test',...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v]))})));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
 try{
 assert.equal((await fetch(url+'/healthz')).status,200);
 assert.equal((await request('/api/auth/register',{email:'deploy@example.test',password:'password-123456',name:'部署用户'},null,{Host:'attacker.test'})).status,403);
 assert.equal((await request('/api/auth/register',{email:'deploy@example.test',password:'password-123456',name:'部署用户'},null,{Origin:'https://attacker.test'})).status,403);
 const auth=await request('/api/auth/register',{email:'deploy@example.test',password:'password-123456',name:'部署用户'});assert.equal(auth.status,200);assert.match(auth.headers.get('set-cookie'),/; Secure/);const cookie=auth.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/',null,cookie)).status,404);
 const input={title:'完整想法',brief:'超过标题长度也必须完整保存。'.repeat(15),requestId:randomUUID()};
 const p=await (await request('/api/remix',input,cookie)).json();assert.equal(p.brief,input.brief);
 assert.equal((await request('/api/remix',{...input,brief:'同一编号不同想法'},cookie)).status,409);
 assert.equal((await request('/api/remix',{...input,requestId:randomUUID(),brief:'字'.repeat(2001)},cookie)).status,400);
 }finally{await server.shutdown();}
});
