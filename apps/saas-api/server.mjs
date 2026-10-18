import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {isIP} from 'node:net';
import {openStore,fault} from '../../packages/saas/store.mjs';
import {createRemixManager} from '../../packages/remix/index.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function createSaasServer({dataRoot=path.join(root,'.data/saas'),publicOrigin,serveWeb=true,trustProxy=false}={}){
 if(publicOrigin){const u=new URL(publicOrigin);if(u.origin!==publicOrigin||!['http:','https:'].includes(u.protocol))throw new Error('PUBLIC_ORIGIN 必须是无路径的 http/https origin');}
 const store=await openStore(dataRoot),managers=new Map(),pending=new Set(),attempts=new Map();let closing=false;
 function workspace(id){if(!managers.has(id)){const repository=store.repository(id),manager=createRemixManager({dataRoot:path.join(dataRoot,'media',id),remixRepository:repository,remixMediaBase:'/api/media'});let tail=Promise.resolve();managers.set(id,{manager,run(fn){const task=tail.then(fn);tail=task.catch(()=>{});return task;}});}return managers.get(id);}
 function throttle(key){const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const v=attempts.get(key)||{n:0,until:now+600000};if(v.n>=20)throw fault('尝试过于频繁，请 10 分钟后再试',429);v.n++;attempts.set(key,v);}
 async function handle(req,res){
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try{
   if(closing)throw fault('服务正在退出',503);
   if(req.url==='/healthz'&&req.method==='GET')return json(200,{ok:true});
   const origin=publicOrigin||`http://127.0.0.1:${res.socket.localPort}`,host=new URL(origin).host;
   if(req.headers.host!==host)throw fault('请求域名无效',403);
   if(req.headers.origin&&req.headers.origin!==origin)throw fault('拒绝跨站请求',403);
   if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)throw fault('请求来源无效',403);
   const route=new URL(req.url,origin).pathname;
   // Public UI illustrations are explicitly allowlisted; user media still uses authenticated /api/media.
   const uiImage=route.match(/^\/assets\/((?:(?:scenario-(?:product|travel|brand)|remix-storyboard)-(?:480|960)|creation-atmosphere-(?:dark|light))\.webp)$/);
   if(serveWeb&&req.method==='GET'&&uiImage){res.setHeader('Content-Type','image/webp');return res.end(await readFile(path.join(root,'apps/saas-web/assets',uiImage[1])));}
   const files={'/home.js':'apps/saas-web/home.js','/icons.js':'apps/saas-web/icons.js','/favicon.svg':'apps/saas-web/favicon.svg','/components.js':'apps/saas-web/components.js','/workspace-model.js':'apps/saas-web/workspace-model.js','/workspace.js':'apps/saas-web/workspace.js','/tokens.css':'apps/saas-web/tokens.css','/components.css':'apps/saas-web/components.css','/reference-upload.js':'apps/saas-web/reference-upload.js','/':'apps/saas-web/index.html','/saas.js':'apps/saas-web/app.js','/saas.css':'apps/saas-web/style.css','/remix.js':'apps/web/remix.js','/api.js':'apps/saas-web/api.js','/ui.js':'apps/web/ui.js','/style.css':'apps/web/style.css'};
   if(serveWeb&&req.method==='GET'&&files[route]){res.setHeader('Content-Type',route.endsWith('.svg')?'image/svg+xml':route.endsWith('.js')?'text/javascript; charset=utf-8':route.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');return res.end(await readFile(path.join(root,files[route])));}
   let body={};if(['POST','PUT'].includes(req.method)){if(req.headers['content-type']!=='application/json')throw fault('需要 JSON 请求',415);req.setEncoding('utf8');let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>65536)throw fault('请求过大',413);}try{body=JSON.parse(raw);}catch{throw fault('JSON 无效');}if(!body||typeof body!=='object'||Array.isArray(body))throw fault('请求无效');}
   const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('pi_saas_session='))?.slice(16)||'';
   const cookie=(value,maxAge)=>res.setHeader('Set-Cookie',`pi_saas_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.startsWith('https:')?'; Secure':''}`);
   if(req.method==='POST'&&['/api/auth/register','/api/auth/login'].includes(route)){const forwarded=req.headers['x-real-ip'];throttle(trustProxy&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:req.socket.remoteAddress);const session=route.endsWith('register')?await store.register(body):await store.login(body);store.logout(token);cookie(session,43200);return json(200,{user:store.identify(session)});}
   if(route==='/api/auth/logout'&&req.method==='POST'){store.logout(token);cookie('',0);return json(200,{ok:true});}
   const user=store.identify(token);
   if(route==='/api/auth/me'&&req.method==='GET')return json(200,{user,mode:publicOrigin?'single-server-saas':'local-saas-development',generation:false});
   const {manager,run}=workspace(user.workspace_id);
   const media=route.match(/^\/api\/media\/(remix_[a-f0-9-]{36})\/(asset_[a-f0-9-]{36})$/);
   if(media&&['GET','HEAD'].includes(req.method)){
    const a=await manager.media(media[1],media[2]),size=(await stat(a.file)).size;let start=0,end=size-1,status=200;
    if(req.headers.range){const r=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);if(!r||(!r[1]&&!r[2])){res.setHeader('Content-Range',`bytes */${size}`);return json(416,{error:'无效范围'});}start=r[1]?Number(r[1]):Math.max(0,size-Number(r[2]));if(r[1]&&r[2])end=Math.min(end,Number(r[2]));if(start>end||start>=size){res.setHeader('Content-Range',`bytes */${size}`);return json(416,{error:'范围越界'});}status=206;}
    res.writeHead(status,{'Content-Type':a.mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});if(req.method==='HEAD')return res.end();const stream=createReadStream(a.file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
   }
   if(route==='/api/remix'&&req.method==='GET')return json(200,await manager.list());
   if(route==='/api/remix'&&req.method==='POST')return json(201,await run(()=>manager.create(body)));
   const match=route.match(/^\/api\/remix\/(remix_[a-f0-9-]{36})(?:\/(begin|chunk|abort|finish|plan|batches|execute))?$/);
   if(match){const [,id,action]=match;if(req.method==='GET'&&!action)return json(200,await manager.show(id));if(req.method==='POST'&&action){// Ownership is checked before every action, including upload-session actions.
     store.repository(user.workspace_id).read(id);
     if(action==='execute')throw fault('当前只开放创作准备，真实制作服务尚未接入',409);
     const name={plan:'savePlan',batches:'makeBatch'}[action]||action;return json(200,await run(()=>manager[name](id,body)));}}
   throw fault('接口不存在',404);
  }catch(e){if(res.headersSent){res.destroy();return;}json(e.code==='ENOENT'?404:e.status||500,{error:e.code==='ENOENT'?'项目或素材不存在':e.status?e.message:'服务暂不可用，请稍后重试'});}
 }
 const server=http.createServer((req,res)=>{const work=handle(req,res);pending.add(work);work.finally(()=>pending.delete(work));});
 server.shutdown=async()=>{closing=true;await Promise.allSettled([...pending]);for(const {manager} of managers.values())await manager.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));store.close();};return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.env.NODE_ENV==='production'&&!process.env.PUBLIC_ORIGIN?.startsWith('https://'))throw new Error('部署模式必须配置 HTTPS PUBLIC_ORIGIN');
 const server=await createSaasServer({dataRoot:process.env.SAAS_DATA_ROOT||undefined,publicOrigin:process.env.PUBLIC_ORIGIN,serveWeb:process.env.SAAS_SERVE_WEB!=='false',trustProxy:process.env.SAAS_TRUST_PROXY==='true'});server.listen(Number(process.env.SAAS_PORT||4320),process.env.SAAS_HOST||'127.0.0.1',()=>console.log(`SaaS 服务已启动，端口 ${server.address().port}`));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.shutdown());
}
