export function normalizeListState(value = {}) {
  return {
    filter: ['all','production','sample'].includes(value.filter) ? value.filter : 'all',
    query: typeof value.query === 'string' ? value.query.slice(0, 500) : '',
    sort: ['newest','oldest','title'].includes(value.sort) ? value.sort : 'newest',
  };
}
export function selectJobs(jobs, state) {
  const { filter, query, sort } = normalizeListState(state);
  const text = query.trim().toLocaleLowerCase();
  return jobs.filter(j => (filter === 'all' || j.technicalSample === (filter === 'sample')) &&
    `${j.title} ${j.brief.account} ${j.brief.product}`.toLocaleLowerCase().includes(text))
    .sort((a,b) => (sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') :
      sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)) || a.id.localeCompare(b.id));
}
export function parseView(hash) {
  if(!hash||hash==='#remix')return {type:'remix'};
  const remix=hash.match(/^#remix\/(remix_[a-f0-9-]{36})$/);
  if(remix)return {type:'remix',id:remix[1]};
  const account=hash.match(/^#accounts\/(account_[a-f0-9-]{36}|new|import)$/);
  if(account)return {type:'accounts',id:account[1]};
  if(['#accounts','#batches','#batch-new'].includes(hash))return {type:hash.slice(1)};
  const batch=hash.match(/^#batch\/(batch_[a-f0-9-]{36})$/);
  if(batch)return {type:'batch',id:batch[1]};
  if (hash === '#services') return { type: 'services' };
  const match = hash.match(/^#job\/(job_[a-f0-9-]{36})$/);
  return match ? { type: 'job', id: match[1] } : { type: 'tasks' };
}
