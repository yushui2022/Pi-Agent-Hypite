import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { loadConfig } from '../packages/config/index.mjs';
const c=await loadConfig();await mkdir(c.piHome,{recursive:true});await mkdir(c.tempRoot,{recursive:true});
const child=spawn(process.execPath,[c.piCli,...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,PI_CODING_AGENT_DIR:c.piHome,TEMP:c.tempRoot,TMP:c.tempRoot}});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
