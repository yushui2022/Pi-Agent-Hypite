import {mkdir,readFile,writeFile,rename,readdir,stat,statfs,open,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import http from 'node:http';
import path from 'node:path';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const str=(s,max=200)=>{if(typeof s!=='string'||!s.trim()||s.length>max)fail('必填内容为空或过长');return s.trim();};
const types={'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.mp3':'audio/mpeg','.wav':'audio/wav'};
const maxSize=512*1024*1024;
export function createRemixManager(config){
  const root=path.join(config.dataRoot,'.remix'),uploads=new Map();let server,starting;
  const token=randomBytes(24).toString('hex');
  const dir=id=>{if(!/^remix_[a-f0-9-]{36}$/.test(id))fail('项目编号无效');return path.join(root,id);};
  async function read(id){dir(id);if(config.remixRepository)return config.remixRepository.read(id);return JSON.parse(await readFile(path.join(dir(id),'project.json'),'utf8'));}
  async function save(p){if(Buffer.byteLength(JSON.stringify(p))>2*1024*1024)fail('项目计划达到当前容量限制，请拆分为另一个项目');if(config.remixRepository)return config.remixRepository.save(p);await mkdir(dir(p.id),{recursive:true});const f=path.join(dir(p.id),'project.json'),tmp=f+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(p,null,2));await rename(tmp,f);}
  async function mediaServer(){
    if(starting)return starting;
    starting=new Promise((resolve,reject)=>{
      server=http.createServer(async(req,res)=>{
        try{
          if(req.headers.host!==`127.0.0.1:${server.address().port}`||!['GET','HEAD'].includes(req.method)){res.writeHead(403);return res.end();}
          const m=req.url.match(new RegExp(`^/${token}/(remix_[a-f0-9-]{36})/(asset_[a-f0-9-]{36})$`));if(!m){res.writeHead(404);return res.end();}
          const p=await read(m[1]),a=p.assets.find(a=>a.id===m[2]);if(!a){res.writeHead(404);return res.end();}
          const file=path.join(dir(p.id),a.id),size=(await stat(file)).size;let start=0,end=size-1,status=200;
          if(req.headers.range){const r=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);if(!r||(!r[1]&&!r[2])){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}if(!r[1])start=Math.max(0,size-Number(r[2]));else start=Number(r[1]);if(r[1]&&r[2])end=Math.min(end,Number(r[2]));if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}status=206;}
          res.writeHead(status,{'Content-Type':a.mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cache-Control':'no-store',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
          if(req.method==='HEAD')return res.end();const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
        }catch{if(!res.headersSent)res.writeHead(404);res.end();}
      });server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}/${token}`));
    });return starting;
  }
  async function show(id){const p=await read(id),base=config.remixMediaBase||await mediaServer();return {...p,revision:hash(p),assets:await Promise.all(p.assets.map(async a=>({...a,available:await stat(path.join(dir(id),a.id)).then(s=>s.size===a.size).catch(()=>false),url:`${base}/${id}/${a.id}`})))};}
  async function list(){await mkdir(root,{recursive:true});const rows=[];const ids=config.remixRepository?config.remixRepository.ids():await readdir(root);for(const id of ids){if(!/^remix_[a-f0-9-]{36}$/.test(id))continue;const p=await read(id);rows.push({id,title:p.title,createdAt:p.createdAt,assets:p.assets.length,batches:p.batches.length});}return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async function create(input){const title=str(input.title,120),brief=input.brief===undefined?'':str(input.brief,2000);if(!/^[a-f0-9-]{36}$/.test(input.requestId))fail('需要请求编号');const id='remix_'+input.requestId;try{const old=await read(id);if(old.title!==title||(old.brief||'')!==brief)fail('请求编号已使用',409);return show(id);}catch(e){if(e.code!=='ENOENT')throw e;}const p={id,title,brief,createdAt:new Date().toISOString(),assets:[],plan:{referenceId:'',preserve:'',rows:[]},batches:[]};await save(p);return show(id);}
  async function begin(id,input){await read(id);if(uploads.size>=4)fail('已有导入进行中，请先完成或取消');const name=str(input.name,240),mime=types[path.extname(name).toLowerCase()];if(!mime)fail('支持 MP4/WebM/MOV、PNG/JPEG、MP3/WAV');if(!Number.isInteger(input.size)||input.size<1||input.size>maxSize)fail('单个文件需为 1 字节至 512 MiB');await mkdir(dir(id),{recursive:true});const space=await statfs(dir(id));if(space.bavail*space.bsize<input.size+64*1024*1024)fail('素材目录剩余空间不足');const uploadId=randomUUID(),assetId='asset_'+randomUUID(),file=path.join(dir(id),assetId+'.part');await writeFile(file,'',{flag:'wx'});uploads.set(uploadId,{id,assetId,file,name,mime,size:input.size,offset:0});return {uploadId};}
  function upload(id,input){const u=uploads.get(input.uploadId);if(!u||u.id!==id)fail('导入会话已失效，请重新选择文件');return u;}
  async function chunk(id,input){const u=upload(id,input);if(!Number.isInteger(input.offset)||input.offset!==u.offset)fail('导入偏移不一致，请重新导入',409);if(typeof input.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))fail('素材分片无效');const bytes=Buffer.from(input.data,'base64');if(!bytes.length||bytes.length>32768||u.offset+bytes.length>u.size)fail('素材分片大小无效');const f=await open(u.file,'r+');try{let written=0;while(written<bytes.length){const result=await f.write(bytes,written,bytes.length-written,u.offset+written);written+=result.bytesWritten;}}finally{await f.close();}u.offset+=bytes.length;return {received:u.offset};}
  async function abort(id,input){const u=upload(id,input);await unlink(u.file).catch(e=>{if(e.code!=='ENOENT')throw e;});uploads.delete(input.uploadId);return {cancelled:true};}
  async function finish(id,input){const u=upload(id,input);if(u.offset!==u.size)fail('文件尚未传完');const f=await open(u.file,'r'),b=Buffer.alloc(16);try{await f.read(b,0,16,0);}finally{await f.close();}
    const ext=path.extname(u.name).toLowerCase();const valid=ext==='.png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['.jpg','.jpeg'].includes(ext)?b[0]===255&&b[1]===216:ext==='.wav'?b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE':ext==='.mp3'?b.toString('ascii',0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224):ext==='.webm'?b.subarray(0,4).equals(Buffer.from([26,69,223,163])):b.toString('ascii',4,8)==='ftyp';if(!valid)fail('文件内容与扩展名不符，请取消后选择有效媒体');
    const digest=createHash('sha256');for await(const bytes of createReadStream(u.file))digest.update(bytes);const sha256=digest.digest('hex'),p=await read(id),existing=p.assets.find(a=>a.sha256===sha256);
    if(existing){await abort(id,input);return {assetId:existing.id,duplicate:true};}
    await rename(u.file,path.join(dir(id),u.assetId));p.assets.push({id:u.assetId,name:u.name,mime:u.mime,size:u.size,sha256,createdAt:new Date().toISOString()});await save(p);uploads.delete(input.uploadId);return {assetId:u.assetId,duplicate:false};
  }
  async function savePlan(id,input){const p=await read(id);if(hash(p)!==input.revision)fail('项目已更新，请重新打开后再保存',409);const plan=input.plan;if(!plan||!Array.isArray(plan.rows)||plan.rows.length>100)fail('替换方案最多 100 项');const ref=p.assets.find(a=>a.id===plan.referenceId&&a.mime.startsWith('video/'));if(!ref)fail('请选择已导入的参考视频');const preserve=typeof plan.preserve==='string'&&plan.preserve.length<=2000?plan.preserve:fail('保留说明过长');const keys=new Set();const rows=plan.rows.map(r=>{const key=str(r.key,80);if(keys.has(key))fail('替换位置名称不能重复');keys.add(key);if(!['video','image','audio','text'].includes(r.type))fail('替换类型无效');const start=Number(r.start),end=Number(r.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)fail('时间段需满足结束大于开始，单位为秒');const value=typeof r.value==='string'&&r.value.length<=2000?r.value:fail('替换文案过长');if(r.assetId&&!p.assets.some(a=>a.id===r.assetId&&a.mime.startsWith(r.type+'/')))fail('替换素材类型不匹配');return {key,type:r.type,start,end,assetId:r.assetId||'',value};});p.plan={referenceId:ref.id,preserve,rows};await save(p);return show(id);}
  async function makeBatch(id,input){const p=await read(id);if(!/^[a-f0-9-]{36}$/.test(input.requestId))fail('请求编号无效');const old=p.batches.find(b=>b.id===input.requestId);const fingerprint=hash({title:input.title,variants:input.variants,revision:input.revision});if(old){if(old.fingerprint!==fingerprint)fail('请求编号已使用',409);return show(id);}if(hash(p)!==input.revision)fail('项目已更新，请重新打开后重试',409);if(!p.plan.referenceId||!p.plan.rows.length)fail('请先保存参考与替换方案');if(p.batches.length>=100)fail('每项目最多 100 个批次');if(!Array.isArray(input.variants)||!input.variants.length||input.variants.length>200)fail('每批 1–200 条明确变体');
    const variants=input.variants.map(v=>{const label=str(v.label,120);const overrides=v.overrides||{};if(Object.keys(overrides).some(k=>!p.plan.rows.some(r=>r.key===k)))fail('未知替换位置');const rows=p.plan.rows.map(row=>{const override=overrides[row.key];if(override===undefined)return {...row};if(row.type==='text')return {...row,value:str(override,2000)};if(!p.assets.some(a=>a.id===override&&a.mime.startsWith(row.type+'/')))fail('变体素材不匹配');return {...row,assetId:override};});return {id:'variant_'+randomUUID(),label,rows};});
    const blocked=[];for(const a of p.assets.filter(a=>a.id===p.plan.referenceId||variants.some(v=>v.rows.some(r=>r.assetId===a.id))))if(!await stat(path.join(dir(id),a.id)).then(s=>s.size===a.size).catch(()=>false))blocked.push(`文件缺失：${a.name}`);
    for(const v of variants)for(const r of v.rows)if(r.type==='text'?!r.value.trim():!r.assetId)blocked.push(`${v.label} / ${r.key} 尚未分配`);
    p.batches.push({id:input.requestId,title:str(input.title,120),createdAt:new Date().toISOString(),fingerprint,plan:structuredClone(p.plan),variants,blocked,state:'planned',outputs:[]});await save(p);return show(id);
  }
  async function media(id,assetId){const p=await read(id),a=p.assets.find(a=>a.id===assetId);if(!a)fail('素材不存在',404);return {...a,file:path.join(dir(id),a.id)};}
  return {list,show,create,begin,chunk,abort,finish,savePlan,makeBatch,media,async shutdown(){for(const u of uploads.values())await unlink(u.file).catch(()=>{});uploads.clear();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}};
}
