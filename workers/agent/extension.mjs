import { Type } from '@earendil-works/pi-ai';
import { executeWorkspaceTool } from './workspace-tools.mjs';
export default function(pi) {
  const config=JSON.parse(process.env.WORKSPACE_AGENT_CONFIG);
  const tools=[
    ['workspace_list','List top-level task project files.',Type.Object({})],
    ['workspace_read','Read a text file in this task project or in the Hypit Skill reference tree.',Type.Object({scope:Type.Union([Type.Literal('project'),Type.Literal('skill')]),path:Type.String()})],
    ['workspace_write','Write an editable video source or Markdown plan in this task project. No scripts or runtime profiles.',Type.Object({path:Type.String(),content:Type.String()})],
    ['hypit_check','Check or plan a trusted task source through the installed Hypit CLI. Never submits a Build.',Type.Object({source:Type.String(),operation:Type.Union([Type.Literal('check'),Type.Literal('plan')])})],
  ];
  for(const [name,description,parameters] of tools)pi.registerTool({name,label:name,description,parameters,async execute(_id,params){const result=await executeWorkspaceTool(name,params,config);return {content:[{type:'text',text:typeof result==='string'?result:JSON.stringify(result)}],details:undefined};}});
  pi.registerCommand('workspace-status',{description:'Task-scoped Hypit tools are registered',handler:async()=>{}});
}
