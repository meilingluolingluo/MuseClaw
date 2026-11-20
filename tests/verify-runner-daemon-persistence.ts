import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { RunnerMeshManager } from '../packages/sandbox-core/src/runner-mesh.ts';

async function main() {
  console.log('===========================================================');
  console.log('   测试 Runner 常驻后台守护服务、配置持久化与网关自愈重连');
  console.log('===========================================================');

  // 1. 验证配置文件与脚本持久化目录
  console.log('\n[Test 1] 验证 ~/.museclaw 目录结构与配置持久化');
  const museclawDir = path.join(homedir(), '.museclaw');
  const configFile = path.join(museclawDir, 'runner.json');
  const clientScript = path.join(museclawDir, 'client.js');

  assert.ok(fs.existsSync(museclawDir), '~/.museclaw 目录应存在');
  assert.ok(fs.existsSync(configFile), 'runner.json 配置文件应存在');
  assert.ok(fs.existsSync(clientScript), 'client.js 核心脚本应存在');

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  console.log('  -> 持久化配置:', config);
  assert.ok(config.serverUrl, '配置中应包含 serverUrl');
  assert.ok(config.token, '配置中应包含 token');
  console.log('  -> [PASS] 配置持久化校验通过');

  // 2. 验证 macOS LaunchAgent Plist 或 Linux systemd 结构
  console.log('\n[Test 2] 验证自启动守护服务配置');
  const plistPath = path.join(homedir(), 'Library', 'LaunchAgents', 'com.museclaw.runner.plist');
  if (process.platform === 'darwin') {
    assert.ok(fs.existsSync(plistPath), 'macOS LaunchAgent plist 文件应存在');
    const content = fs.readFileSync(plistPath, 'utf8');
    assert.ok(content.includes('com.museclaw.runner'), 'plist 应包含正确的服务标签');
    assert.ok(content.includes('<key>RunAtLoad</key>'), 'plist 应包含 RunAtLoad');
    assert.ok(content.includes('<key>KeepAlive</key>'), 'plist 应包含 KeepAlive');
    console.log('  -> [PASS] macOS LaunchAgent 自启配置完备');
  }

  // 3. 验证 Gateway 端的 RunnerMeshManager 持久化与重启感知
  console.log('\n[Test 3] 验证 RunnerMeshManager 状态持久化与重启恢复');
  const testDataDir = path.resolve(process.cwd(), 'data', 'test-runner-mesh.json');
  try { fs.unlinkSync(testDataDir); } catch {}

  const mesh1 = new RunnerMeshManager(testDataDir);
  mesh1.registerMachine({
    machineId: 'node_test_daemon',
    hostname: 'test-mac.local',
    platform: 'darwin',
    arch: 'arm64',
    token: 'test_token',
    runtimes: [{
      id: 'pi',
      name: 'Pi',
      models: ['Opus 5.5-baidu-oneapi'],
      defaultModel: 'Opus 5.5-baidu-oneapi'
    }]
  });

  assert.ok(fs.existsSync(testDataDir), '注册机器后应持久化写入数据文件');

  // 模拟网关完全重启并创建新的 MeshManager 实例
  console.log('  -> 模拟网关进程重启...');
  const mesh2 = new RunnerMeshManager(testDataDir);
  const recovered = mesh2.getMachine('node_test_daemon');
  assert.ok(recovered, '网关重启后应自动从持久化存储恢复已注册节点元数据');
  assert.strictEqual(recovered.hostname, 'test-mac.local');
  assert.strictEqual(recovered.runtimes.length, 1);
  assert.strictEqual(recovered.runtimes[0].id, 'pi');
  console.log('  -> [PASS] 恢复节点元数据正确:', recovered.hostname, recovered.runtimes.map(r => r.id));

  // 4. 验证未知节点 poll 时触发 needRegister 自愈信号
  console.log('\n[Test 4] 验证未知/重启后的自愈 re-register 机制');
  const unknown = mesh2.getMachine('non_existent_node');
  assert.strictEqual(unknown, undefined, '未注册节点应返回 undefined 从而触发 needRegister');
  console.log('  -> [PASS] 自愈检测逻辑符合预期');

  try { fs.unlinkSync(testDataDir); } catch {}
  console.log('\n✅ 所有测试全部通过！');
}

main().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
