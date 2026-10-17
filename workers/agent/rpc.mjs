import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export function openRpc({cli,args,cwd,env,onEvent=()=>{}}) {
  const child=spawn(process.execPath,[cli,...args],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const waiting=new Map(); let buffer='',closed=false;
  let resolveExit;
  const exited=new Promise(resolve=>{resolveExit=resolve;});
  const fail=error=>{for(const p of waiting.values()){clearTimeout(p.timer);p.reject(error);}waiting.clear();};
  child.on('error',error=>fail(error));
  child.stdin.on('error',error=>fail(error));
  child.stderr.resume(); // Never write arbitrary credential diagnostics to the web log.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    buffer+=chunk;
    if(Buffer.byteLength(buffer)>4*1024*1024){fail(new Error('Pi RPC record exceeds limit'));child.kill();return;}
    let i;
    while((i=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,i).replace(/\r$/,'');buffer=buffer.slice(i+1);if(!line)continue;
      let event;try{event=JSON.parse(line);}catch{fail(new Error('Invalid Pi RPC JSON'));child.kill();return;}
      if(event.type==='response'&&waiting.has(event.id)){
        const p=waiting.get(event.id);waiting.delete(event.id);clearTimeout(p.timer);
        event.success?p.resolve(event.data):p.reject(new Error(event.error||'Pi command rejected'));
      }else {try{onEvent(event);}catch{fail(new Error('Event handler failed'));child.kill();}}
    }
  });
  child.on('close',(code,signal)=>{closed=true;fail(new Error('Pi process exited'));resolveExit({code,signal});});
  return {
    pid:child.pid, exited,
    request(type,fields={},timeoutMs=30000){
      if(closed)return Promise.reject(new Error('Pi process is closed'));
      const id=randomUUID();
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{waiting.delete(id);reject(new Error(`Pi ${type} timed out`));},timeoutMs);
        waiting.set(id,{resolve,reject,timer});
        child.stdin.write(JSON.stringify({...fields,type,id})+'\n');
      });
    },
    async close(){
      if(!closed)child.stdin.end();
      const timer=setTimeout(()=>{if(!closed)child.kill();},3000);
      try{return await exited;}finally{clearTimeout(timer);}
    },
    kill(){if(!closed)child.kill();},
  };
}
