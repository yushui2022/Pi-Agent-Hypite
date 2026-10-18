import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot,loadConfig } from '../packages/config/index.mjs';

const action=process.argv[2] || 'dev';
if(!['dev','check','smoke','test','qa'].includes(action))throw new Error('Expected dev, check, smoke, test or qa');
if(process.platform!=='win32')throw new Error('P1a currently validated for Windows only');
const temp='G:/DevCache/Temp/pi-agent-hypite/desktop';
await mkdir(temp,{recursive:true});
const config=await loadConfig(path.join(projectRoot,'config.example.json'));
const data=path.join(projectRoot,'.data',action==='smoke'?'desktop-smoke':action==='qa'?'desktop-qa':'desktop');
await mkdir(data,{recursive:true});
const configPath=path.join(data,'runtime-config.json');
await writeFile(configPath,JSON.stringify({...config,dataRoot:path.join(data,'jobs'),piHome:path.join(data,'pi'),tempRoot:temp},null,2));
const env={...process.env,CARGO_HOME:'G:/DevCache/CargoHome',CARGO_TARGET_DIR:'G:/DevCache/CargoTarget',TEMP:temp,TMP:temp,
  PI_WORKSPACE_ROOT:projectRoot,PI_WORKSPACE_NODE:process.execPath,PI_WORKSPACE_CONFIG:configPath};
if(action==='qa')env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-address=127.0.0.1 --remote-debugging-port=9431';
const args=['check','test'].includes(action)?[action]:['run'];
args.push('--locked');
args.push('--manifest-path',path.join(projectRoot,'apps/desktop/src-tauri/Cargo.toml'));
if(action==='smoke')args.push('--','--smoke-test');
const child=spawn('cargo',args,{cwd:projectRoot,env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code ?? 1;});
