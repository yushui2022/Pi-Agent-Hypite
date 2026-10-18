export const accountFields = [
  ['accountKey','账号编号',120],['name','账号名称',120],['group','分组',80],
  ['language','目标语言',40],['audience','目标受众',400],['style','内容风格',400],
  ['spec','输出规格',120],['market','目标市场',80],['restrictions','禁用表达',400],
];
export const missingRules = a => [['audience','受众'],['style','风格'],['spec','规格']].filter(([k])=>!a[k]?.trim()).map(([,label])=>label);
export function inspectImport(source, mapping=accountFields.map((_,i)=>i), header=false, existing=[]) {
  const lines=source.replace(/^\uFEFF/,'').split(/\r?\n/);
  if(lines.filter(l=>l.trim()).length>1001)throw new Error('每次最多导入 1000 条资料');
  const assigned=mapping.filter(i=>i>=0);
  if(new Set(assigned).size!==assigned.length)throw new Error('同一列不能映射到多个字段');
  const known=new Set(existing.map(a=>a.accountKey.toLowerCase())),seen=new Set(),results=[];
  for(let i=header?1:0;i<lines.length;i++){
    if(!lines[i].trim())continue;
    const cells=lines[i].split('\t'),account={active:true},errors=[];
    accountFields.forEach(([key,label,max],j)=>{
      const value=mapping[j]>=0?(cells[mapping[j]]??'').trim():'';account[key]=value;
      if(['accountKey','name','language'].includes(key)&&!value)errors.push(`${label}必填`);
      if(value.length>max)errors.push(`${label}超过 ${max} 字`);
    });
    const key=account.accountKey.toLowerCase();
    if(key&&seen.has(key))errors.push('本次资料内编号重复');
    if(key)seen.add(key);
    results.push({line:i+1,account,errors,status:errors.length?'error':known.has(key)?'skip':'new'});
  }
  if(!results.length)throw new Error('请先粘贴资料');
  return results;
}
