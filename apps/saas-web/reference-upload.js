import {api} from './api.js';
export async function uploadReference(projectId,file,onProgress=()=>{}){
 const base='/api/remix/'+projectId;let uploadId;
 try{
  uploadId=(await api(base+'/begin','POST',{name:file.name,size:file.size})).uploadId;
  for(let offset=0;offset<file.size;offset+=32768){const bytes=new Uint8Array(await file.slice(offset,offset+32768).arrayBuffer());let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);await api(base+'/chunk','POST',{uploadId,offset,data:btoa(raw)});onProgress(Math.min(offset+32768,file.size),file.size);}
  const finished=await api(base+'/finish','POST',{uploadId});uploadId=null;
  const project=await api(base);
  return await api(base+'/plan','POST',{revision:project.revision,plan:{...project.plan,referenceId:finished.assetId}});
 }catch(error){if(uploadId)await api(base+'/abort','POST',{uploadId}).catch(()=>{});throw error;}
}
