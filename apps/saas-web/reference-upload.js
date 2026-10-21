import {api} from './api.js';
import {uploadFile} from './upload-transport.js';
export async function uploadReference(projectId,file,onProgress=()=>{}){
 const base='/api/remix/'+projectId;
 const finished=await uploadFile({projectId,file,post:(action,body)=>api(base+'/'+action,'POST',body),onProgress});
 const project=await api(base);
 return await api(base+'/plan','POST',{revision:project.revision,plan:{...project.plan,referenceId:finished.assetId}});
}
