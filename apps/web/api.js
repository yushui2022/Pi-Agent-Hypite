export async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let result;
  try { result = await response.json(); } catch { throw new Error('服务返回异常，请稍后重试'); }
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result;
}
