import {DatabaseSync} from 'node:sqlite';
import {mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import path from 'node:path';
const derive=promisify(scrypt),digest=s=>createHash('sha256').update(s).digest('hex');
export const fault=(message,status=400)=>Object.assign(new Error(message),{status});
const sessionAge=12*60*60*1000;
export async function openStore(root){
 await mkdir(root,{recursive:true});const db=new DatabaseSync(path.join(root,'saas.sqlite'));
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL REFERENCES users(id),workspace_id TEXT NOT NULL REFERENCES workspaces(id),role TEXT NOT NULL,PRIMARY KEY(user_id,workspace_id));
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),workspace_id TEXT NOT NULL REFERENCES workspaces(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),document TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS projects_workspace ON projects(workspace_id);
 CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);`);
 const dummySalt=randomBytes(16).toString('hex');let hashing=0;
 async function key(password,salt){if(hashing>=4)throw fault('登录服务繁忙，请稍后重试',429);hashing++;try{return await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});}finally{hashing--;}}
 function credentials(body){const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw fault('请输入有效邮箱');if(typeof body.password!=='string'||body.password.length<10||body.password.length>128)throw fault('密码需为 10–128 个字符');return {email,password:body.password};}
 function session(userId,workspaceId){const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(token),userId,workspaceId,Date.now()+sessionAge);return token;}
 async function register(body){const {email,password}=credentials(body);const name=typeof body.name==='string'?body.name.trim():'';if(!name||name.length>80)throw fault('请填写不超过 80 字的昵称');const salt=randomBytes(16).toString('hex'),hash=(await key(password,salt)).toString('hex');const userId=randomUUID(),workspaceId=randomUUID();
  db.exec('BEGIN IMMEDIATE');try{if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw fault('此邮箱无法注册，请尝试登录',409);db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(userId,email,name,salt,hash);db.prepare('INSERT INTO workspaces VALUES (?,?)').run(workspaceId,name+'的创作空间');db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(userId,workspaceId,'owner');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return session(userId,workspaceId);
 }
 async function login(body){const {email,password}=credentials(body),u=db.prepare('SELECT * FROM users WHERE email=?').get(email);const actual=await key(password,u?.salt||dummySalt);if(!u||!timingSafeEqual(actual,Buffer.from(u.password_hash,'hex')))throw fault('邮箱或密码不正确',401);const m=db.prepare('SELECT workspace_id FROM memberships WHERE user_id=? LIMIT 1').get(u.id);return session(u.id,m.workspace_id);}
 function identify(token){if(!/^[a-f0-9]{64}$/.test(token||''))throw fault('请先登录',401);const row=db.prepare(`SELECT u.id,u.email,u.name,s.workspace_id,w.name AS workspace_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id JOIN workspaces w ON w.id=s.workspace_id WHERE s.token_hash=? AND s.expires_at>?`).get(digest(token),Date.now());if(!row)throw fault('登录已失效，请重新登录',401);return row;}
 function logout(token){if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));}
 function repository(workspaceId){return {
  ids:()=>db.prepare('SELECT id FROM projects WHERE workspace_id=?').all(workspaceId).map(r=>r.id),
  read(id){const p=db.prepare('SELECT document FROM projects WHERE id=? AND workspace_id=?').get(id,workspaceId);if(!p)throw Object.assign(fault('项目不存在',404),{code:'ENOENT'});return JSON.parse(p.document);},
  save(p){const current=db.prepare('SELECT workspace_id FROM projects WHERE id=?').get(p.id);if(current&&current.workspace_id!==workspaceId)throw fault('项目编号不可使用',409);if(!current&&db.prepare('SELECT count(*) AS n FROM projects WHERE workspace_id=?').get(workspaceId).n>=100)throw fault('当前开发版每空间最多 100 个项目');db.prepare('INSERT INTO projects VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document WHERE projects.workspace_id=excluded.workspace_id').run(p.id,workspaceId,JSON.stringify(p));}
 };}
 return {register,login,identify,logout,repository,close:()=>db.close()};
}
