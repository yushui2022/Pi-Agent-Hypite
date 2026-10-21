import {mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'dist/saas-web');
await mkdir(out,{recursive:true});
for(const [from,to] of Object.entries({'apps/saas-web/home.js':'home.js','apps/saas-web/icons.js':'icons.js','apps/saas-web/favicon.svg':'favicon.svg','apps/saas-web/components.js':'components.js','apps/saas-web/workspace-model.js':'workspace-model.js','apps/saas-web/workspace.js':'workspace.js','apps/saas-web/tokens.css':'tokens.css','apps/saas-web/components.css':'components.css','apps/saas-web/reference-upload.js':'reference-upload.js','apps/saas-web/index.html':'index.html','apps/saas-web/app.js':'saas.js','apps/saas-web/style.css':'saas.css','apps/saas-web/api.js':'api.js','apps/web/ui.js':'ui.js','apps/web/remix.js':'remix.js','apps/web/remix-preparation.js':'remix-preparation.js','apps/web/remix-batch-editor.js':'remix-batch-editor.js','apps/web/upload-transport.js':'upload-transport.js','apps/web/style.css':'style.css'}))await copyFile(path.join(root,from),path.join(out,to));
await mkdir(path.join(out,'assets'),{recursive:true});
for(const name of ['scenario-product','scenario-travel','scenario-brand','remix-storyboard']){
 for(const width of [480,960]){
  const file=`${name}-${width}.webp`;
  await copyFile(path.join(root,'apps/saas-web/assets',file),path.join(out,'assets',file));
 }
}
for(const theme of ['dark','light']){
 const file=`creation-atmosphere-${theme}.webp`;
 await copyFile(path.join(root,'apps/saas-web/assets',file),path.join(out,'assets',file));
}
console.log(`Web 静态产物：${out}`);
