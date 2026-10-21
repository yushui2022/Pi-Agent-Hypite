import {mkdir,writeFile,rename,stat,statfs,open,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import {createRemixService} from './service.mjs';
import {createLocalRepository} from './local-repository.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const str=(s,max=200)=>{if(typeof s!=='string'||!s.trim()||s.length>max)fail('必填内容为空或过长');return s.trim();};
const types={'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.mp3':'audio/mpeg','.wav':'audio/wav'};
const maxSize=512*1024*1024;
export function createRemixManager(config){
  const root=path.join(config.dataRoot,'.remix'),uploads=new Map();let server,starting;
  const token=randomBytes(24).toString('hex');
  const dir=id=>{if(!/^remix_[a-f0-9-]{36}$/.test(id))fail('项目编号无效');return path.join(root,id);};
  const service=createRemixService({
    repository:config.remixRepository||createLocalRepository(root),
    media:{
      available:(id,a)=>stat(path.join(dir(id),a.id)).then(s=>s.size===a.size).catch(()=>false),
      url:async(id,a)=>`${config.remixMediaBase||await mediaServer()}/${id}/${a.id}`,
    },
  });
  const {read,list,show,create,savePlan,makeBatch,check}=service;
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
  async function begin(id,input){await read(id);if(uploads.size>=4)fail('已有导入进行中，请先完成或取消');const name=str(input.name,240),mime=types[path.extname(name).toLowerCase()];if(!mime)fail('支持 MP4/WebM/MOV、PNG/JPEG、MP3/WAV');if(!Number.isInteger(input.size)||input.size<1||input.size>maxSize)fail('单个文件需为 1 字节至 512 MiB');await mkdir(dir(id),{recursive:true});const space=await statfs(dir(id));if(space.bavail*space.bsize<input.size+64*1024*1024)fail('素材目录剩余空间不足');const uploadId=randomUUID(),assetId='asset_'+randomUUID(),file=path.join(dir(id),assetId+'.part');await writeFile(file,'',{flag:'wx'});uploads.set(uploadId,{id,assetId,file,name,mime,size:input.size,offset:0});return {uploadId};}
  function upload(id,input){const u=uploads.get(input.uploadId);if(!u||u.id!==id)fail('导入会话已失效，请重新选择文件');return u;}
  async function chunk(id,input){const u=upload(id,input);if(!Number.isInteger(input.offset)||input.offset!==u.offset)fail('导入偏移不一致，请重新导入',409);if(typeof input.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))fail('素材分片无效');const bytes=Buffer.from(input.data,'base64');if(!bytes.length||bytes.length>32768||u.offset+bytes.length>u.size)fail('素材分片大小无效');const f=await open(u.file,'r+');try{let written=0;while(written<bytes.length){const result=await f.write(bytes,written,bytes.length-written,u.offset+written);written+=result.bytesWritten;}}finally{await f.close();}u.offset+=bytes.length;return {received:u.offset};}
  async function abort(id,input){const u=upload(id,input);await unlink(u.file).catch(e=>{if(e.code!=='ENOENT')throw e;});uploads.delete(input.uploadId);return {cancelled:true};}
  async function finish(id,input){const u=upload(id,input);if(u.offset!==u.size)fail('文件尚未传完');const f=await open(u.file,'r'),b=Buffer.alloc(16);try{await f.read(b,0,16,0);}finally{await f.close();}
    const ext=path.extname(u.name).toLowerCase();const valid=ext==='.png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['.jpg','.jpeg'].includes(ext)?b[0]===255&&b[1]===216:ext==='.wav'?b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE':ext==='.mp3'?b.toString('ascii',0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224):ext==='.webm'?b.subarray(0,4).equals(Buffer.from([26,69,223,163])):b.toString('ascii',4,8)==='ftyp';if(!valid)fail('文件内容与扩展名不符，请取消后选择有效媒体');
    const digest=createHash('sha256');for await(const bytes of createReadStream(u.file))digest.update(bytes);const sha256=digest.digest('hex'),p=await read(id),existing=p.assets.find(a=>a.sha256===sha256);
    if(existing){
      const target=path.join(dir(id),existing.id);let matches=false;
      try{
        if((await stat(target)).size===existing.size){
          const storedHash=createHash('sha256');for await(const bytes of createReadStream(target))storedHash.update(bytes);
          matches=storedHash.digest('hex')===sha256;
        }
      }catch(error){if(error.code!=='ENOENT')throw error;}
      if(matches){await abort(id,input);return {assetId:existing.id,duplicate:true};}
      // The uploaded bytes have the original hash. Restore the original ID so
      // every frozen plan continues to refer to the same content.
      await rename(u.file,target);uploads.delete(input.uploadId);
      return {assetId:existing.id,duplicate:true,restored:true};
    }
    const target=path.join(dir(id),u.assetId);await rename(u.file,target);
    let result;
    try{
      result=await service.registerAsset(id,{id:u.assetId,name:u.name,mime:u.mime,size:u.size,sha256,createdAt:new Date().toISOString()});
    }catch(error){
      // Keep verified bytes retryable when metadata storage rejects or is temporarily unavailable.
      await rename(target,u.file);throw error;
    }
    uploads.delete(input.uploadId);
    if(result.assetId!==u.assetId)await unlink(target);
    return result;
  }
  async function media(id,assetId){const p=await read(id),a=p.assets.find(a=>a.id===assetId);if(!a)fail('素材不存在',404);return {...a,file:path.join(dir(id),a.id)};}
  return {list,show,create,begin,chunk,abort,finish,savePlan,makeBatch,check,media,async shutdown(){for(const u of uploads.values())await unlink(u.file).catch(()=>{});uploads.clear();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}};
}
