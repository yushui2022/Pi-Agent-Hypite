export async function api(url, method = 'GET', body) {
  if(body!==undefined&&new TextEncoder().encode(JSON.stringify(body)).length>60000)throw new Error('本次提交内容过长，请拆分为较小计划后重试');
  if (window.__TAURI__?.core?.invoke) {
    let response;
    try { response=await window.__TAURI__.core.invoke('runtime_request',{route:url,method,body:body ?? {}}); }
    catch(error) { throw new Error(typeof error==='string' ? error : error?.message || '桌面运行时连接中断，请重新启动工作台'); }
    const {status,data}=response;
    if(status>=400)throw new Error(data.error || '操作失败');
    return data;
  }
  const response = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let result;
  try { result = await response.json(); } catch { throw new Error('服务返回异常，请稍后重试'); }
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result;
}
