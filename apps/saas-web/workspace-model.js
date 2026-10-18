// Derived display facts; persisted plans remain the authority.
function missing(rows,assets){return rows.filter(r=>r.type==='text'?!r.value?.trim():!assets.some(a=>a.id===r.assetId&&a.available&&a.mime.startsWith(r.type+'/')));}
export function projectStage(p){
 const reference=p.assets.find(a=>a.id===p.plan.referenceId&&a.available&&a.mime.startsWith('video/'));
 if(!reference)return {key:'reference',label:'待导入参考',hint:'导入视频并指定为当前参考',tab:'assets',action:'完善参考',tone:'warning'};
 if(!p.plan.rows.length)return {key:'mapping',label:'待配置替换',hint:'标注要替换的时间段与内容',tab:'plan',action:'配置替换',tone:'neutral'};
 const count=missing(p.plan.rows,p.assets).length;
 if(count)return {key:'materials',label:'待补素材或文案',hint:`${count} 个替换位置未填完整`,tab:'plan',action:'补齐替换',tone:'warning'};
 if(!p.batches.length)return {key:'batch',label:'待安排批次',hint:'把方案分配为一个或多个版本',tab:'batches',action:'安排批次',tone:'neutral'};
 return {key:'planned',label:'已保存批次',hint:`${p.batches.length} 个批次 · 尚未提交执行`,tab:'batches',action:'查看批次',tone:'success'};
}
export function batchIssues(batch,p){const reasons=[];if(!p.assets.some(a=>a.id===batch.plan.referenceId&&a.available&&a.mime.startsWith('video/')))reasons.push('批次参考视频缺失');for(const v of batch.variants)for(const r of missing(v.rows,p.assets))reasons.push(`${v.label} / ${r.key}：${r.type==='text'?'缺少文案':'素材未分配或文件缺失'}`);return reasons;}
export function assetRole(asset,p){return asset.id===p.plan.referenceId?'reference':'replacement';}
export function filterItems(items,q,searchable){const query=q.trim().toLocaleLowerCase();return items.filter(item=>searchable(item).toLocaleLowerCase().includes(query));}
export function pageItems(items,page,size=12){const current=Math.min(Math.max(1,page),Math.max(1,Math.ceil(items.length/size)));return {page:current,rows:items.slice((current-1)*size,current*size)};}
