// Deterministic development icon, no external image or branding dependency.
import { mkdir,writeFile } from 'node:fs/promises';
const size=32,pixels=Buffer.alloc(size*size*4),mask=Buffer.alloc(size*4),bmp=Buffer.alloc(40);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const ink=(y>=8&&y<12&&x>=7&&x<25)||(y>=12&&y<25&&((x>=10&&x<14)||(x>=20&&x<24)));
  const i=((size-1-y)*size+x)*4;
  pixels.set(ink?[240,240,240,255]:[50,45,35,255],i);
}
bmp.writeUInt32LE(40);bmp.writeInt32LE(size,4);bmp.writeInt32LE(size*2,8);bmp.writeUInt16LE(1,12);bmp.writeUInt16LE(32,14);bmp.writeUInt32LE(pixels.length+mask.length,20);
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=size;header[7]=size;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(bmp.length+pixels.length+mask.length,14);header.writeUInt32LE(22,18);
const folder=new URL('../apps/desktop/src-tauri/icons/',import.meta.url);
await mkdir(folder,{recursive:true});await writeFile(new URL('icon.ico',folder),Buffer.concat([header,bmp,pixels,mask]));
