import { spawn } from 'node:child_process';
import { mkdir, access, cp } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../packages/config/index.mjs';

// Run through npm so the same Node/npm installation is used on Windows and Unix.
const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error('Use npm run source:setup / source:build / source:models');
const command=process.argv[2];
if(!['setup','build','models','hypit'].includes(command))throw new Error('Unknown source action');
let cache=path.join(projectRoot,'.cache');
if(process.platform==='win32'){try{await access('G:/');cache='G:/DevCache';}catch{}}
const temp=path.join(cache,'Temp/pi-agent-hypite');await mkdir(temp,{recursive:true});
const env={...process.env,npm_config_cache:path.join(cache,'npm'),TEMP:temp,TMP:temp,TMPDIR:temp,HUSKY:'0',PUPPETEER_SKIP_DOWNLOAD:'true',COREPACK_HOME:path.join(cache,'corepack'),PNPM_HOME:path.join(cache,'pnpm')};
async function npm(cwd,args){
  console.log(`\n[source] ${path.relative(projectRoot,cwd)}: npm ${args.join(' ')}`);
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[npmCli,...args],{cwd,env,stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Source command exited ${code}`)));
  });
}
const pi=path.join(projectRoot,'vendor/pi'),hypit=path.join(projectRoot,'vendor/hypit');
if(command==='setup'){
  await npm(pi,['ci','--ignore-scripts','--no-audit','--no-fund']);
  await npm(hypit,['exec','--yes','--package=pnpm@10.33.0','--','pnpm','install','--frozen-lockfile','--ignore-scripts','--store-dir',path.join(cache,'pnpm-store')]);
}
if(command==='setup')await cp(path.join(projectRoot,'vendor/pi-model-data'),path.join(pi,'packages/ai/src/providers/data'),{recursive:true});
if(command==='models'){
  await npm(pi,['run','hydrate:model-data']);
  await cp(path.join(pi,'packages/ai/src/providers/data'),path.join(projectRoot,'vendor/pi-model-data'),{recursive:true});
}
if(command==='setup'||command==='build')await npm(pi,['run','build:offline']);
if(command==='hypit'){
  const child=spawn(process.execPath,[path.join(hypit,'bin/hypit.mjs'),...process.argv.slice(3)],{cwd:projectRoot,env,stdio:'inherit',windowsHide:true});
  child.on('error',e=>{console.error(e.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
}
