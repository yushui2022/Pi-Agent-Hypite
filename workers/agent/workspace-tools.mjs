import { readFile,writeFile,mkdir,readdir,realpath } from 'node:fs/promises';
import path from 'node:path';
import { inspectSource } from '../../packages/hypit-adapter/index.mjs';
export async function contained(root,relative,{write=false}={}) {
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(x=>x==='..'||x.startsWith('.')))throw new Error('Use a non-hidden project-relative path');
  const base=await realpath(root),target=path.resolve(base,relative);
  const inside=p=>{const r=path.relative(base,p);return !r.startsWith('..')&&!path.isAbsolute(r);};
  if(!inside(target))throw new Error('Path escapes workspace');
  if(write){
    let parent=path.dirname(target),tail=[];
    while(true){try{const actual=await realpath(parent);if(!inside(actual))throw new Error('Parent escapes workspace');break;}catch(e){if(e.code!=='ENOENT')throw e;tail.push(parent);parent=path.dirname(parent);}}
    try{if(!inside(await realpath(target)))throw new Error('Target escapes workspace');}catch(e){if(e.code!=='ENOENT')throw e;}
    await mkdir(path.dirname(target),{recursive:true});
  }else if(!inside(await realpath(target)))throw new Error('Target escapes workspace');
  return target;
}
export async function executeWorkspaceTool(name,params,config) {
  if(name==='workspace_list')return (await readdir(config.workspace,{withFileTypes:true})).filter(x=>!x.name.startsWith('.')).map(x=>({name:x.name,directory:x.isDirectory()}));
  if(name==='workspace_read'){
    const root=params.scope==='skill'?config.skillRoot:config.workspace;
    const file=await contained(root,params.path);const data=await readFile(file);
    if(data.length>256*1024)throw new Error('File too large; maximum 256 KiB');return data.toString('utf8');
  }
  if(name==='workspace_write'){
    if(!['.svml','.svrun','.svs','.md'].includes(path.extname(params.path)))throw new Error('Only SVML, SVRun, SVS and Markdown may be written');
    if(typeof params.content!=='string'||Buffer.byteLength(params.content)>256*1024)throw new Error('Content too large');
    const file=await contained(config.workspace,params.path,{write:true});await writeFile(file,params.content);return {saved:params.path};
  }
  if(name==='hypit_check'){
    const source=await contained(config.workspace,params.source);
    return inspectSource({cli:config.hypitCli,workspace:config.workspace,source,operation:params.operation,tempRoot:config.tempRoot});
  }
  throw new Error('Unknown workspace tool');
}
