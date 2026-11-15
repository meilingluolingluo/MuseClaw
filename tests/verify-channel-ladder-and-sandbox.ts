import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  MicroSandbox,
  commandNeedsNetwork,
  getSanitizedEnv,
  classifyToolChannel,
  selectOptimalChannel,
  ChannelLadderPolicy,
  CHANNEL_RANK,
  CHANNEL_DETAILS,
  createDefaultTools
} from '../packages/sandbox-core/src/index.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';

async function runTests() {
  console.log('===============================================================');
  console.log('   MUSECLAW 技能成本阶梯 (Channel Ladder) 与微沙箱隔离验证测试');
  console.log('===============================================================\n');

  // =========================================================================
  // 1. Bubblewrap 微沙箱探测与状态测试 (MicroSandbox Probe)
  // =========================================================================
  console.log('[Test 1] 验证 MicroSandbox 探测机制与环境能力');
  const sandbox = new MicroSandbox();
  const status = sandbox.getStatus();
  console.log('  -> 微沙箱状态:', JSON.stringify(status, null, 2));

  assert.strictEqual(typeof status.active, 'boolean');
  assert.strictEqual(typeof status.blocksNetwork, 'boolean');
  assert.ok(['bwrap', 'env_scrubbed'].includes(status.engine));

  if (process.platform === 'linux' && status.engine === 'bwrap') {
    assert.strictEqual(status.active, true);
    assert.strictEqual(status.blocksNetwork, true);
    console.log(`  -> [PASS] 检测到 Linux bubblewrap ${status.version}，支持全量命名空间与网络隔离`);
  } else {
    console.log(`  -> [INFO] 非 Linux 或未安装 bwrap，采用环境净化执行模式 (engine: ${status.engine})`);
  }

  // =========================================================================
  // 2. 微沙箱命令执行与文件系统隔离测试 (Filesystem Isolation)
  // =========================================================================
  console.log('\n[Test 2] 验证 MicroSandbox 进程启动与文件系统隔离');
  const execResult = await sandbox.execute('echo "micro-sandbox-ok" && pwd');
  console.log('  -> 命令输出:', execResult.stdout.trim());
  console.log('  -> 耗时:', `${execResult.durationMs}ms`, '| 引擎:', execResult.engine);

  assert.strictEqual(execResult.exitCode, 0);
  assert.ok(execResult.stdout.includes('micro-sandbox-ok'));
  assert.strictEqual(typeof execResult.durationMs, 'number');

  if (status.engine === 'bwrap') {
    assert.strictEqual(execResult.isSandboxed, true);

    // 验证宿主私密目录隔离 (Home Directory Masking)
    // 在 bwrap 沙箱内，HOME 被定向到 /tmp/home，宿主真实用户的主目录文件（如 .ssh, .bashrc）不可见
    const homeIsolationResult = await sandbox.execute('echo "SANDBOX_HOME=$HOME"; ls -la $HOME');
    console.log('  -> 沙箱内部 HOME 检查:\n' + homeIsolationResult.stdout.trim().split('\n').map(l => '     ' + l).join('\n'));
    assert.ok(homeIsolationResult.stdout.includes('SANDBOX_HOME=/tmp/home'));

    // 验证系统只读保护：禁止在 /usr 或 /etc 中创建或修改文件
    const readOnlyCheck = await sandbox.execute('touch /etc/unauthorized_file.txt 2>&1 || echo "WRITE_BLOCKED"');
    console.log('  -> 系统目录只读防护检查:', readOnlyCheck.stdout.trim());
    assert.ok(readOnlyCheck.stdout.includes('WRITE_BLOCKED') || readOnlyCheck.stderr.includes('Read-only file system'));
    console.log('  -> [PASS] 主目录成功屏蔽，/etc 与 /usr 严格只读挂载防护生效');
  }

  // =========================================================================
  // 3. 微沙箱内核网络命名空间隔离测试 (Network Isolation & needsNetwork)
  // =========================================================================
  console.log('\n[Test 3] 验证微沙箱网络需求探测与 --unshare-net 内核网络阻断');

  // 3.1 规则探测函数 commandNeedsNetwork
  assert.strictEqual(commandNeedsNetwork('cat README.md | grep title'), false);
  assert.strictEqual(commandNeedsNetwork('ls -lh /tmp'), false);
  assert.strictEqual(commandNeedsNetwork('node index.js'), false);
  assert.strictEqual(commandNeedsNetwork('curl https://api.internal.corp/data'), true);
  assert.strictEqual(commandNeedsNetwork('git clone https://github.com/foo/bar'), true);
  assert.strictEqual(commandNeedsNetwork('npm install express'), true);
  assert.strictEqual(commandNeedsNetwork('wget http://10.0.0.1/file.tar.gz'), true);
  console.log('  -> [PASS] commandNeedsNetwork 智能识别网络出站程序与 URL 规则');

  // 3.2 真实命令网络阻断
  if (status.engine === 'bwrap' && status.blocksNetwork) {
    // 强制关闭网络权限执行 curl 测试
    const netBlockedExec = await sandbox.execute('curl -s -m 2 http://1.1.1.1 || echo "NETWORK_UNSHARE_BLOCKED"', {
      allowNetwork: false
    });
    console.log('  -> 网络阻断执行结果:', netBlockedExec.stdout.trim());
    assert.strictEqual(netBlockedExec.networkBlocked, true);
    assert.ok(netBlockedExec.stdout.includes('NETWORK_UNSHARE_BLOCKED') || netBlockedExec.exitCode !== 0);
    console.log('  -> [PASS] --unshare-net 内核级切断出站网络，防止数据隐蔽回传');
  }

  // =========================================================================
  // 4. 微沙箱 Fallback 模式测试 (Scrubbed Environment)
  // =========================================================================
  console.log('\n[Test 4] 验证 MicroSandbox mode="off" 环境净化回退机制');
  const fallbackSandbox = new MicroSandbox({ mode: 'off' });
  const fallbackStatus = fallbackSandbox.getStatus();
  assert.strictEqual(fallbackStatus.active, false);
  assert.strictEqual(fallbackStatus.engine, 'env_scrubbed');

  const fallbackExec = await fallbackSandbox.execute('echo "fallback-env-test"');
  assert.strictEqual(fallbackExec.exitCode, 0);
  assert.strictEqual(fallbackExec.engine, 'env_scrubbed');
  assert.strictEqual(fallbackExec.isSandboxed, false);
  assert.ok(fallbackExec.stdout.includes('fallback-env-test'));
  console.log('  -> [PASS] 回退模式在无内核命名空间支持下仍能安全执行');

  // =========================================================================
  // 5. 技能成本阶梯 (Channel Ladder) 分级与工具映射测试
  // =========================================================================
  console.log('\n[Test 5] 验证 Channel Ladder 阶梯排序与工具自动分类');
  assert.strictEqual(CHANNEL_RANK.api, 1);
  assert.strictEqual(CHANNEL_RANK.cli, 2);
  assert.strictEqual(CHANNEL_RANK.web, 3);
  assert.strictEqual(CHANNEL_RANK.browser, 4);
  assert.strictEqual(CHANNEL_RANK.gui, 5);

  assert.strictEqual(classifyToolChannel('read_file'), 'api');
  assert.strictEqual(classifyToolChannel('save_artifact'), 'api');
  assert.strictEqual(classifyToolChannel('execute_shell'), 'cli');
  assert.strictEqual(classifyToolChannel('web_fetch'), 'web');
  assert.strictEqual(classifyToolChannel('http_fetch'), 'web');
  assert.strictEqual(classifyToolChannel('browser_open'), 'browser');
  assert.strictEqual(classifyToolChannel('phone_screen'), 'gui');
  assert.strictEqual(classifyToolChannel('phone_act'), 'gui');
  assert.strictEqual(classifyToolChannel('phone_task'), 'gui');
  console.log('  -> [PASS] 5 级成本阶梯与工具归类完全匹配设计规范');

  // 验证最优通道选择（严格就低不就高）
  const optimal1 = selectOptimalChannel(['browser', 'cli', 'api', 'gui']);
  assert.strictEqual(optimal1, 'api');

  const optimal2 = selectOptimalChannel(['browser', 'gui', 'web']);
  assert.strictEqual(optimal2, 'web');

  const optimalOffline = selectOptimalChannel(['web', 'browser', 'cli', 'gui'], { offlineOnly: true });
  assert.strictEqual(optimalOffline, 'cli');
  console.log('  -> [PASS] selectOptimalChannel 严格遵循最低成本优先与离线过滤');

  // =========================================================================
  // 6. 技能阶梯越级拦截与渐进升级策略测试 (Escalation Gate)
  // =========================================================================
  console.log('\n[Test 6] 验证 ChannelLadderPolicy 防越级拦截与阶梯跃迁机制');
  const ladderPolicy = new ChannelLadderPolicy();
  const testSessionId = 'session_ladder_test_01';

  // 场景 A: 会话刚刚开始，模型试图直接调用 Rung 5 (GUI: phone_act)
  const directGuiCheck = ladderPolicy.evaluateEscalation(testSessionId, 'phone_act');
  console.log('  -> 场景 A (无前置尝试直接调用 GUI):', directGuiCheck.reason);
  assert.strictEqual(directGuiCheck.allowed, false);
  assert.strictEqual(directGuiCheck.requiresApproval, true);
  assert.strictEqual(directGuiCheck.rung, 5);
  assert.ok(directGuiCheck.reason.includes('越级拦截'));

  // 场景 B: 正常按部就班执行 Rung 1 (API) 与 Rung 2 (CLI)
  ladderPolicy.recordExecution(testSessionId, 'read_file');
  ladderPolicy.recordExecution(testSessionId, 'execute_shell');

  // 场景 C: 低阶梯未能满足需求，合法升级到 Rung 5 (GUI)
  const escalatedGuiCheck = ladderPolicy.evaluateEscalation(testSessionId, 'phone_act');
  console.log('  -> 场景 C (前置低阶梯尝试后升级):', escalatedGuiCheck.reason);
  assert.strictEqual(escalatedGuiCheck.allowed, true);
  assert.strictEqual(escalatedGuiCheck.requiresApproval, false);
  ladderPolicy.recordExecution(testSessionId, 'phone_act');

  // 验证会话遥测审计数据
  const sessionStats = ladderPolicy.getSessionStats(testSessionId);
  console.log('  -> 会话阶梯统计摘要:', {
    totalSteps: sessionStats.totalSteps,
    maxRungReached: sessionStats.maxRungReached,
    channelCounts: sessionStats.channelCounts,
    totalCostScore: sessionStats.totalCostScore,
    complianceRate: sessionStats.ladderComplianceRate
  });
  assert.strictEqual(sessionStats.totalSteps, 3);
  assert.strictEqual(sessionStats.channelCounts.api, 1);
  assert.strictEqual(sessionStats.channelCounts.cli, 1);
  assert.strictEqual(sessionStats.channelCounts.gui, 1);
  assert.strictEqual(sessionStats.maxRungReached, 'gui');
  console.log('  -> [PASS] 防无故调用昂贵投屏机制与审计报告记录无误');

  // =========================================================================
  // 7. Sentinel 门禁集成阶梯校验测试 (Sentinel + Channel Ladder)
  // =========================================================================
  console.log('\n[Test 7] 验证 Sentinel 哨兵集成 Channel Ladder 越级拦截');
  const sentinel = new SentinelPolicyManager();
  const testSession2 = 'session_sentinel_ladder_02';

  // 7.1 直接尝试 phone_screen，未经历低阶梯，Sentinel 应当主动判定危险并挂起审批
  const sentinelGuiCheck = sentinel.evaluateToolCall(
    'phone_screen',
    { target: 'phone_1' },
    { sessionId: testSession2, approval_level: 'ask' }
  );
  console.log('  -> Sentinel 评估直接调用 phone_screen:', sentinelGuiCheck);
  assert.strictEqual(sentinelGuiCheck.isDangerous, true);
  assert.ok(sentinelGuiCheck.reason?.includes('越级拦截'));

  // 7.2 先执行一次微沙箱命令
  sentinel.evaluateToolCall('execute_shell', { command: 'echo "check env"' }, { sessionId: testSession2 });

  // 7.3 再次调用 phone_screen，前置低阶梯已有尝试，Sentinel 阶梯阻断解除
  const sentinelGuiCheck2 = sentinel.evaluateToolCall(
    'phone_screen',
    { target: 'phone_1' },
    { sessionId: testSession2, approval_level: 'auto_edits' }
  );
  assert.strictEqual(sentinelGuiCheck2.isDangerous, false);
  console.log('  -> [PASS] Sentinel 联动阶梯规则成功阻止无序升阶，前置尝试后平滑放行');

  // =========================================================================
  // 8. createDefaultTools 端到端装配测试
  // =========================================================================
  console.log('\n[Test 8] 验证 createDefaultTools 内置工具完整性与微沙箱挂载');
  const tools = createDefaultTools({ workspaceDir: process.cwd() });
  const toolNames = tools.map((t) => t.name);
  console.log('  -> 已加载内置工具集:', toolNames.join(', '));

  assert.ok(toolNames.includes('execute_shell'));
  assert.ok(toolNames.includes('web_fetch'));
  assert.ok(toolNames.includes('browser_open'));
  assert.ok(toolNames.includes('phone_screen'));
  assert.ok(toolNames.includes('phone_act'));
  assert.ok(toolNames.includes('save_artifact'));
  assert.ok(toolNames.includes('read_file'));

  // 调用 execute_shell 工具验证微沙箱执行结果封装
  const shellTool = tools.find((t) => t.name === 'execute_shell')!;
  const shellExecRes: any = await shellTool.execute({ command: 'echo "shell_tool_in_sandbox"' });
  console.log('  -> execute_shell 返回结果:', shellExecRes);
  assert.strictEqual(shellExecRes.exitCode, 0);
  assert.ok(shellExecRes.stdout.includes('shell_tool_in_sandbox'));
  assert.ok(shellExecRes.sandbox);
  assert.strictEqual(typeof shellExecRes.sandbox.isSandboxed, 'boolean');
  console.log('  -> [PASS] execute_shell 原生输出微沙箱执行元数据 (sandbox metadata)');

  console.log('\n===============================================================');
  console.log('   🎉 技能成本阶梯 (Channel Ladder) 与微沙箱隔离 全部测试通过 (100%)');
  console.log('===============================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ 测试执行失败:', err);
  process.exit(1);
});
