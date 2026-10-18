import { loadConfig } from '../../packages/config/index.mjs';
import { createApplication } from '../../packages/application/index.mjs';

const config=await loadConfig(process.argv[2]);
const application=createApplication(config),pending=new Set(),ids=new Set();
let buffer='',closing=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function close(id){
  if(closing)return;
  closing=true;process.stdin.pause();
  const timeout=setTimeout(()=>process.exit(1),10000);
  await application.shutdown();
  clearTimeout(timeout);
  send({protocol:1,id,status:200,data:{stopped:true}});
  process.stdout.end(()=>process.exit(0));
}
async function line(raw){
  let input;try{input=JSON.parse(raw);}catch{send({protocol:1,id:null,status:400,data:{error:'Invalid JSON'}});return;}
  if(!input||input.protocol!==1||typeof input.id!=='string'||input.id.length>128){send({protocol:1,id:null,status:400,data:{error:'Invalid protocol or request id'}});return;}
  if(ids.has(input.id)){send({protocol:1,id:input.id,status:409,data:{error:'Request id already active'}});return;}
  if(input.command==='shutdown'){await close(input.id);return;}
  if(closing||pending.size>=32){send({protocol:1,id:input.id,status:503,data:{error:'Runtime busy or stopping'}});return;}
  ids.add(input.id);
  try{send({protocol:1,id:input.id,...await application.request(input)});}finally{ids.delete(input.id);}
}
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
  buffer+=chunk;
  let index;
  while(!closing&&(index=buffer.indexOf('\n'))>=0){
    const raw=buffer.slice(0,index);buffer=buffer.slice(index+1);
    if(Buffer.byteLength(raw)>65536){process.stderr.write('Request frame too large\n');void close(null);return;}
    const task=line(raw);pending.add(task);task.catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;}).finally(()=>pending.delete(task));
  }
  if(Buffer.byteLength(buffer)>65536){process.stderr.write('Request frame too large\n');void close(null);}
});
process.stdin.on('end',()=>{void close(null);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void close(null);});
send({protocol:1,event:'ready',pid:process.pid});
