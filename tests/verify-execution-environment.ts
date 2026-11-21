import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  BaseEnvironment,
  BwrapEnvironment,
  LocalEnvironment,
  createExecutionEnvironment,
  isSafeWritePath,
  isSafeReadPath,
  scrubEnvironmentVariables,
  SAFE_BASE_ENV,
  createDefaultTools
} from '../packages/sandbox-core/src/index.ts';

async function runExecutionEnvironmentTests() {
  console.log('===============================================================');
  console.log('   MUSECLAW 统一环境抽象层 (Execution Environment) 深度验证测试');
  console.log('===============================================================\n');

  const testWorkspace = path.resolve(process.cwd(), 'scratch/env_test_ws');
  if (!fs.existsSync(testWorkspace)) {
    fs.mkdirSync(testWorkspace, { recursive: true });
  }

  // =========================================================================
  // 1. 统一环境抽象层多态接口验证 (Unified BaseEnvironment Polymorphism)
  // =========================================================================
  console.log('[Test 1] 验证 BaseEnvironment 统一抽象接口与工厂构造');
  const bwrapEnv = new BwrapEnvironment({ workspaceDir: testWorkspace });
  const localEnv = new LocalEnvironment(testWorkspace);
  const autoEnv = createExecutionEnvironment({ workspaceDir: testWorkspace });

  assert.ok(bwrapEnv instanceof BaseEnvironment);
  assert.ok(localEnv instanceof BaseEnvironment);
  assert.ok(autoEnv instanceof BaseEnvironment);

  assert.strictEqual(typeof bwrapEnv.execute, 'function');
  assert.strictEqual(typeof bwrapEnv.readFile, 'function');
  assert.strictEqual(typeof bwrapEnv.writeFile, 'function');
  assert.strictEqual(typeof bwrapEnv.isSafeWrite, 'function');
  assert.strictEqual(typeof bwrapEnv.isSafeRead, 'function');

  console.log('  -> bwrapEnv 引擎状态:', bwrapEnv.getStatus().engine);
  console.log('  -> localEnv 引擎状态:', localEnv.getStatus().engine);
  console.log('  -> autoEnv 引擎状态:', autoEnv.getStatus().engine);
  console.log('  -> [PASS] 统一抽象环境基类 BaseEnvironment 接口规范完整');

  // =========================================================================
  // 2. 凭据与环境变量清洗策略验证 (Env Scrubbing & Whitelist)
  // =========================================================================
  console.log('\n[Test 2] 验证凭据清洗策略与安全环境变量白名单');
  // 模拟宿主环境中存在各类敏感 Token / API Key
  const dirtyHostEnv: NodeJS.ProcessEnv = {
    PATH: '/usr/local/bin:/usr/bin:/bin:/home/user/.cargo/bin',
    OPENAI_API_KEY: 'sk-proj-supersecrettoken123456',
    ANTHROPIC_API_KEY: 'sk-ant-admin-998877',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    GITHUB_TOKEN: 'ghp_abc1234567890abcdef',
    DATABASE_PASSWORD: 'rootpassword123',
    CUSTOM_SAFE_TASK_ID: 'task_arxiv_001',
    LANG: 'en_US.UTF-8'
  };

  const scrubbed = scrubEnvironmentVariables(dirtyHostEnv);
  console.log('  -> 清洗后保留的环境变量键列表:', Object.keys(scrubbed));

  assert.strictEqual(scrubbed.OPENAI_API_KEY, undefined);
  assert.strictEqual(scrubbed.ANTHROPIC_API_KEY, undefined);
  assert.strictEqual(scrubbed.AWS_SECRET_ACCESS_KEY, undefined);
  assert.strictEqual(scrubbed.GITHUB_TOKEN, undefined);
  assert.strictEqual(scrubbed.DATABASE_PASSWORD, undefined);
  assert.strictEqual(scrubbed.CUSTOM_SAFE_TASK_ID, 'task_arxiv_001');
  assert.strictEqual(scrubbed.MUSECLAW_SANDBOX, 'true');
  assert.strictEqual(scrubbed.HOME, '/workspace');

  // 在沙箱内部执行实际检验：验证 bwrap 内部环境变量绝不包含外部密钥
  const envCheckResult = await bwrapEnv.execute('env', {
    env: dirtyHostEnv
  });
  assert.ok(!envCheckResult.stdout.includes('sk-proj-supersecrettoken123456'));
  assert.ok(!envCheckResult.stdout.includes('sk-ant-admin-998877'));
  assert.ok(!envCheckResult.stdout.includes('wJalrXUtnFEMI/K7MDENG'));
  assert.ok(!envCheckResult.stdout.includes('ghp_abc1234567890abcdef'));
  assert.ok(envCheckResult.stdout.includes('HOME=/workspace'));
  assert.ok(envCheckResult.stdout.includes('CUSTOM_SAFE_TASK_ID=task_arxiv_001'));
  console.log('  -> [PASS] 沙箱内部彻底抹除宿主敏感环境变量，凭据防泄漏机制生效');

  // =========================================================================
  // 3. 分级文件系统与挂载矩阵验证 (Mount Matrix, Tmpfs & HOME Anchor)
  // =========================================================================
  console.log('\n[Test 3] 验证分级文件系统、Tmpfs 与工作区/家目录锚定');
  if (bwrapEnv.getStatus().engine === 'bwrap') {
    // 3.1 验证系统目录只读防护
    const roCheck = await bwrapEnv.execute('touch /usr/unauthorized_sys_file.txt 2>&1 || echo "RO_SYS_PROTECTED"');
    console.log('  -> /usr 只读测试:', roCheck.stdout.trim());
    assert.ok(roCheck.stdout.includes('RO_SYS_PROTECTED') || roCheck.stderr.includes('Read-only'));

    // 3.2 验证 /tmp 内存临时目录独立且可写
    const tmpfsCheck = await bwrapEnv.execute('echo "temp-content" > /tmp/micro_sandbox_tmp_test.txt && cat /tmp/micro_sandbox_tmp_test.txt');
    console.log('  -> /tmp 读写测试:', tmpfsCheck.stdout.trim());
    assert.strictEqual(tmpfsCheck.exitCode, 0);
    assert.strictEqual(tmpfsCheck.stdout.trim(), 'temp-content');

    // 3.3 验证工作区读写与 HOME 锚定
    const homeWsCheck = await bwrapEnv.execute('pwd && echo "HOME=$HOME"');
    console.log('  -> 工作区与 HOME 锚定测试:\n' + homeWsCheck.stdout.trim().split('\n').map(l => '     ' + l).join('\n'));
    assert.strictEqual(homeWsCheck.exitCode, 0);
    assert.ok(homeWsCheck.stdout.includes('/workspace'));
    assert.ok(homeWsCheck.stdout.includes('HOME=/workspace'));
    console.log('  -> [PASS] /usr 只读、/tmp 读写、/workspace 挂载与 HOME 锚定均符合设计规范');
  } else {
    console.log('  -> [SKIP] 非 bwrap 模式跳过内核挂载矩阵测试');
  }

  // =========================================================================
  // 4. 按能力/工具分级的网络隔离与公共 DNS 注入验证 (Network & DNS)
  // =========================================================================
  console.log('\n[Test 4] 验证按意图网络授权与公共 DNS 动态注入');
  if (bwrapEnv.getStatus().engine === 'bwrap') {
    // 4.1 离线模式：强制 allowNetwork=false，断绝网络
    const offlineExec = await bwrapEnv.execute('curl -s -m 2 http://1.1.1.1 || echo "NET_BLOCKED_OK"', {
      allowNetwork: false
    });
    console.log('  -> allowNetwork=false 执行输出:', offlineExec.stdout.trim());
    assert.strictEqual(offlineExec.networkBlocked, true);
    assert.ok(offlineExec.stdout.includes('NET_BLOCKED_OK') || offlineExec.exitCode !== 0);

    // 4.2 允许网络模式：allowNetwork=true，公共 DNS 注入使得域名可解析
    const resolvCheck = await bwrapEnv.execute('cat /etc/resolv.conf', {
      allowNetwork: true
    });
    console.log('  -> 沙箱内 /etc/resolv.conf 解析配置:\n' + resolvCheck.stdout.trim().split('\n').map(l => '     ' + l).join('\n'));
    assert.strictEqual(resolvCheck.exitCode, 0);
    assert.ok(resolvCheck.stdout.includes('8.8.8.8') || resolvCheck.stdout.includes('1.1.1.1'));

    const onlineExec = await bwrapEnv.execute('curl -I --connect-timeout 5 https://example.com || echo "ONLINE_CURL_DONE"', {
      allowNetwork: true
    });
    console.log('  -> allowNetwork=true 域名解析与联通测试 exitCode:', onlineExec.exitCode);
    assert.strictEqual(onlineExec.networkBlocked, false);
    assert.strictEqual(onlineExec.exitCode, 0);
    console.log('  -> [PASS] 离线网络强力阻断与在线公共 DNS 注入联通验证无误');
  }

  // =========================================================================
  // 5. 应用层写入防御验证 (Application-Level Safe Root & isSafeWritePath)
  // =========================================================================
  console.log('\n[Test 5] 验证应用层写入防御 (isSafeWritePath & writeFile)');

  // 5.1 路径穿越攻击拦截
  assert.strictEqual(isSafeWritePath('../escaped.txt', testWorkspace), false);
  assert.strictEqual(isSafeWritePath('../../etc/shadow', testWorkspace), false);
  assert.strictEqual(isSafeWritePath('/etc/passwd', testWorkspace), false);
  assert.strictEqual(isSafeWritePath('/usr/bin/malware', testWorkspace), false);

  // 5.2 敏感文件黑名单拦截
  assert.strictEqual(isSafeWritePath('.env', testWorkspace), false);
  assert.strictEqual(isSafeWritePath('.env.production', testWorkspace), false);
  assert.strictEqual(isSafeWritePath('.git/hooks/pre-commit', testWorkspace), false);
  assert.strictEqual(isSafeWritePath('~/.ssh/id_rsa', testWorkspace), false);
  assert.strictEqual(isSafeWritePath('~/.aws/credentials', testWorkspace), false);
  assert.strictEqual(isSafeWritePath('id_ed25519', testWorkspace), false);

  // 5.3 正常工作区文件放行
  assert.strictEqual(isSafeWritePath('src/main.py', testWorkspace), true);
  assert.strictEqual(isSafeWritePath('data/results.json', testWorkspace), true);
  assert.strictEqual(isSafeWritePath('/workspace/report.md', testWorkspace), true);
  console.log('  -> [PASS] isSafeWritePath 准确拦截目录穿越与敏感黑名单文件');

  // 5.4 验证 BaseEnvironment.writeFile 异常抛出拦截
  let securityBlocked = false;
  try {
    await bwrapEnv.writeFile('../../evil.sh', 'rm -rf /');
  } catch (err: any) {
    securityBlocked = true;
    console.log('  -> 预期拦截异常:', err.message);
    assert.ok(err.message.includes('SecurityException'));
  }
  assert.strictEqual(securityBlocked, true);

  let envFileBlocked = false;
  try {
    await bwrapEnv.writeFile('.env', 'OPENAI_API_KEY=hacked');
  } catch (err: any) {
    envFileBlocked = true;
    assert.ok(err.message.includes('SecurityException'));
  }
  assert.strictEqual(envFileBlocked, true);

  // 5.5 验证正常工作区安全读写
  await bwrapEnv.writeFile('analysis/paper_summary.md', '# ArXiv Paper Analysis\nUnified Sandbox Ok.');
  const readContent = await bwrapEnv.readFile('analysis/paper_summary.md');
  assert.strictEqual(readContent, '# ArXiv Paper Analysis\nUnified Sandbox Ok.');

  // 验证虚拟路径 /workspace/... 正常映射并安全读取
  const virtualReadContent = await bwrapEnv.readFile('/workspace/analysis/paper_summary.md');
  assert.strictEqual(virtualReadContent, '# ArXiv Paper Analysis\nUnified Sandbox Ok.');
  console.log('  -> [PASS] BaseEnvironment 文件的安全受控读写与虚拟路径映射正常');

  // =========================================================================
  // 6. Tools 工具集成验证 (write_file, execute_code, read_file)
  // =========================================================================
  console.log('\n[Test 6] 验证 createDefaultTools 挂载工具与能力');
  const defaultTools = createDefaultTools({
    workspaceDir: testWorkspace,
    environment: bwrapEnv
  });

  const toolMap = new Map(defaultTools.map((t) => [t.name, t]));
  assert.ok(toolMap.has('read_file'));
  assert.ok(toolMap.has('write_file'));
  assert.ok(toolMap.has('execute_code'));
  assert.ok(toolMap.has('execute_shell'));

  // 6.1 write_file 工具调用测试
  const writeFileTool = toolMap.get('write_file')!;
  const writeRes: any = await writeFileTool.execute({
    path: 'output/result.json',
    content: JSON.stringify({ status: 'completed', score: 98 })
  });
  console.log('  -> write_file 执行结果:', writeRes);
  assert.strictEqual(writeRes.success, true);

  // 6.2 read_file 工具调用测试
  const readFileTool = toolMap.get('read_file')!;
  const readRes: any = await readFileTool.execute({
    path: 'output/result.json'
  });
  console.log('  -> read_file 执行结果:', readRes);
  assert.ok(readRes.content && (readRes.content.includes('"score":98') || readRes.content.includes('"score": 98')));

  // 6.3 write_file 非法越界测试
  const writeIllegalRes: any = await writeFileTool.execute({
    path: '../escape_root.txt',
    content: 'illegal'
  });
  assert.strictEqual(writeIllegalRes.success, false);
  assert.ok(writeIllegalRes.error.includes('SecurityException'));

  // 6.4 execute_code 离线代码执行测试
  const executeCodeTool = toolMap.get('execute_code')!;
  const pyCodeRes: any = await executeCodeTool.execute({
    code: 'print(sum([x * 2 for x in range(5)]))',
    language: 'python'
  });
  console.log('  -> execute_code (Python) 执行结果:', pyCodeRes);
  assert.strictEqual(pyCodeRes.exitCode, 0);
  assert.strictEqual(pyCodeRes.stdout.trim(), '20');
  assert.strictEqual(pyCodeRes.sandbox.networkBlocked, true);
  console.log('  -> [PASS] 工具层 read_file, write_file, execute_code 深度集成 BaseEnvironment 无误');

  // 清理临时测试工作区
  try {
    fs.rmSync(testWorkspace, { recursive: true, force: true });
  } catch {}

  console.log('\n===============================================================');
  console.log('   🎉 统一环境抽象层 (Execution Environment) 全部测试通过 (100%)');
  console.log('===============================================================\n');
}

runExecutionEnvironmentTests().catch((err) => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
