export function parseAccountsTsv(source) {
  const lines=source.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());
  if(!lines.length)throw new Error('请先粘贴账号资料');
  if(lines.length>1000)throw new Error('每次最多粘贴 1000 行');
  const keys=new Set();
  return lines.map((line,index)=>{
    const cells=line.split('\t');
    if(cells.length<4||cells.length>7)throw new Error(`第 ${index+1} 行需要 4–7 列，使用 Tab 分隔，不含表头`);
    const [accountKey,name,group,language,audience='',style='',spec='']=cells.map(c=>c.trim());
    if(!accountKey||!name||!language)throw new Error(`第 ${index+1} 行缺少编号、名称或语言`);
    const key=accountKey.toLowerCase();if(keys.has(key))throw new Error(`第 ${index+1} 行编号重复：${accountKey}`);keys.add(key);
    const result={accountKey,name,group,language,audience,style,spec,active:true};
    for(const [field,max] of Object.entries({accountKey:120,name:120,group:80,language:40,audience:400,style:400,spec:120}))if(result[field].length>max)throw new Error(`第 ${index+1} 行 ${field} 过长`);
    return result;
  });
}
