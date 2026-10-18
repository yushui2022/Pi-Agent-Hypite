export async function api(url,method='GET',body){
 const raw=body===undefined?undefined:JSON.stringify(body);
 if(raw&&new TextEncoder().encode(raw).length>60000)throw new Error('请求过大，请拆分后重试');
 const res=await fetch(url,{method,credentials:'same-origin',headers:raw?{'Content-Type':'application/json'}:{},body:raw});
 const data=await res.json();
 if(!res.ok){if(res.status===401&&!url.startsWith('/api/auth/'))window.dispatchEvent(new Event('saas-session-expired'));throw new Error(data.error||'请求失败');}return data;
}
