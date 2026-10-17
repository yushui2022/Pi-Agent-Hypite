import test from 'node:test';
import assert from 'node:assert/strict';
import { access,readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig,projectRoot } from '../packages/config/index.mjs';
import { createAgentManager } from '../workers/agent/manager.mjs';
import { opencodeGoProvider } from '../vendor/pi/packages/ai/dist/providers/opencode-go.js';

test('默认执行本仓库源码，不回退到发布包或外部安装',async()=>{
  const config=await loadConfig(path.join(projectRoot,'config.example.json'));
  assert.equal(config.piCli,path.join(projectRoot,'vendor/pi/packages/coding-agent/dist/bundle/cli.js'));
  assert.equal(config.hypitRoot,path.join(projectRoot,'vendor/hypit'));
  const state=await createAgentManager(config).status();
  assert.equal(state.sourceIntegration,true);assert.equal(state.piInstalled,true);assert.equal(state.hypitInstalled,true);
  const pkg=JSON.parse(await readFile(path.join(projectRoot,'package.json'),'utf8'));
  assert.equal(pkg.dependencies?.['@earendil-works/pi-coding-agent'],undefined);
  assert.equal(pkg.dependencies?.['@hypit/hypit'],undefined);
});
test('完整上游快照文件均在仓库，保留修改入口与许可证',async()=>{
  const inventory=JSON.parse(await readFile(path.join(projectRoot,'vendor/upstream-sources.json'),'utf8'));
  for(const source of inventory.sources){
    assert.ok(Object.keys(source.files).length>1000);
    // Bounded filesystem concurrency avoids flooding Windows handles.
    const files=Object.keys(source.files);
    for(let i=0;i<files.length;i+=32)await Promise.all(files.slice(i,i+32).map(file=>access(path.join(projectRoot,source.directory,file))));
  }
});
test('修改后的 Pi 模型注册模块可从本地构建加载',()=>{
  const provider=opencodeGoProvider();
  assert.equal(provider.id,'opencode-go');
  assert.ok(provider.getModels().length>0);
  assert.ok(provider.getModels().every(m=>m.provider==='opencode-go'));
});
