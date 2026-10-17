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
  if (hash === '#services') return { type: 'services' };
  const match = hash.match(/^#job\/(job_[a-f0-9-]{36})$/);
  return match ? { type: 'job', id: match[1] } : { type: 'tasks' };
}
