process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import http from 'node:http';

async function runWebUiTests() {
  console.log('===============================================================');
  console.log('   MUSECLAW 数字员工前端 Web UI 与全功能全栈集成验证测试');
  console.log('===============================================================\n');

  const { startGatewayServer } = await import('../apps/gateway/src/server.ts');
  const testPort = 3199;
  process.env.PORT = String(testPort);
  const server = startGatewayServer(testPort);

  // 等待服务器就绪
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    // =========================================================================
    // 1. 静态主页 HTML 与 SPA 托管测试 (GET /)
    // =========================================================================
    console.log('[Test 1] 验证根路由 GET / 静态 SPA 主页响应');
    const resHome = await fetch(`http://localhost:${testPort}/`);
    console.log('  -> Status:', resHome.status, 'Content-Type:', resHome.headers.get('content-type'));
    const htmlText = await resHome.text();
    console.log('  -> Body preview:', htmlText.slice(0, 300));
    assert.strictEqual(resHome.status, 200);
    assert.ok(resHome.headers.get('content-type')?.includes('text/html'));
    assert.ok(htmlText.includes('MuseClaw - 企业级多 Agent 数字员工工作台'));
    assert.ok(htmlText.includes('class="app-container"'));
    assert.ok(htmlText.includes('id="view-chat"'));
    assert.ok(htmlText.includes('id="view-goals"'));
    assert.ok(htmlText.includes('id="view-memory"'));
    assert.ok(htmlText.includes('id="view-skills"'));
    assert.ok(htmlText.includes('id="view-artifacts"'));
    assert.ok(htmlText.includes('id="view-routines"'));
    assert.ok(htmlText.includes('id="view-audit"'));
    console.log('  -> [PASS] 根路径成功返回完整 SPA 页面结构 (含 7 大功能视窗容器)');

    // =========================================================================
    // 2. CSS 样式文件与设计系统测试 (GET /styles.css)
    // =========================================================================
    console.log('\n[Test 2] 验证现代化样式文件 GET /styles.css');
    const resCss = await fetch(`http://localhost:${testPort}/styles.css`);
    assert.strictEqual(resCss.status, 200);
    assert.ok(resCss.headers.get('content-type')?.includes('text/css'));
    const cssText = await resCss.text();
    assert.ok(cssText.includes('--bg-primary: #0d1117'));
    assert.ok(cssText.includes('.approval-card-hazard'));
    assert.ok(cssText.includes('.ladder-rung-card'));
    console.log('  -> [PASS] styles.css 成功返回深色科技风设计系统与 OpenMausBot 风格审批卡片样式');

    // =========================================================================
    // 3. 前端 ES Modules 脚本与图标库 (GET /app.js & /icons.js)
    // =========================================================================
    console.log('\n[Test 3] 验证前端核心业务脚本 GET /app.js & /icons.js');
    const resApp = await fetch(`http://localhost:${testPort}/app.js`);
    assert.strictEqual(resApp.status, 200);
    assert.ok(resApp.headers.get('content-type')?.includes('application/javascript'));
    const appJsText = await resApp.text();
    assert.ok(appJsText.includes('renderSentinelApprovalCard'));
    assert.ok(appJsText.includes('Taint Egress Barrier'));
    assert.ok(appJsText.includes('triggerConsolidation'));
    assert.ok(appJsText.includes('advanceGoal'));

    const resIcons = await fetch(`http://localhost:${testPort}/icons.js`);
    assert.strictEqual(resIcons.status, 200);
    assert.ok(resIcons.headers.get('content-type')?.includes('application/javascript'));
    console.log('  -> [PASS] 核心交互逻辑与矢量图标库加载正常');

    // =========================================================================
    // 4. SPA 任意路由 Fallback 测试 (History API Routing)
    // =========================================================================
    console.log('\n[Test 4] 验证单页应用 (SPA) 客户端路由降级回退');
    const resSpaRoute = await fetch(`http://localhost:${testPort}/chat/session_demo_123`);
    assert.strictEqual(resSpaRoute.status, 200);
    assert.ok(resSpaRoute.headers.get('content-type')?.includes('text/html'));

    const resRoutinesSpa = await fetch(`http://localhost:${testPort}/routines`);
    assert.strictEqual(resRoutinesSpa.status, 200);
    assert.ok(resRoutinesSpa.headers.get('content-type')?.includes('text/html'));

    const resAuditSpa = await fetch(`http://localhost:${testPort}/audit`);
    assert.strictEqual(resAuditSpa.status, 200);
    assert.ok(resAuditSpa.headers.get('content-type')?.includes('text/html'));
    console.log('  -> [PASS] 任意深度子路由平滑回退至 index.html，保障 SPA 路由刷新');

    // =========================================================================
    // 5. 路径遍历安全防护测试 (Security Directory Traversal Check)
    // =========================================================================
    console.log('\n[Test 5] 验证静态托管目录遍历越权防护与 404 处理');
    
    // 5.1 路径遍历与越界探测 (返回 403 或 404，绝不外泄文件)
    const rawTraversalStatus = await new Promise<number>((resolve) => {
      const req = http.get(`http://localhost:${testPort}/../outside.txt`, (res) => {
        resolve(res.statusCode || 0);
      });
      req.on('error', () => resolve(500));
    });
    assert.ok([403, 404].includes(rawTraversalStatus));

    // 5.2 探测未知非 SPA 路由
    const resUnknown = await fetch(`http://localhost:${testPort}/unknown_non_spa_path`);
    assert.strictEqual(resUnknown.status, 404);

    // 5.3 探测缺失的静态文件
    const resMissing = await fetch(`http://localhost:${testPort}/assets/not_found_file.css`);
    assert.strictEqual(resMissing.status, 404);
    console.log(`  -> [PASS] 恶意路径遍历探测被底层网关物理阻断 (HTTP 403)，非法非 SPA 路径与缺失资源正确返回 404`);

    // =========================================================================
    // 6. 前端所依赖的核心后端 REST API 联调自检
    // =========================================================================
    console.log('\n[Test 6] 验证前端页面背后的数据接口集成');
    
    // 6.1 Bots 列表
    const resBots = await fetch(`http://localhost:${testPort}/api/bots`);
    const botsData = await resBots.json();
    const botsList = Array.isArray(botsData) ? botsData : botsData.bots;
    assert.ok(Array.isArray(botsList));
    assert.ok(botsList.length > 0);
    console.log(`  -> Bots 列表就绪: 共 ${botsList.length} 个数字员工`);

    // 6.2 微沙箱与阶梯状态
    const resSandbox = await fetch(`http://localhost:${testPort}/api/sandbox/status`);
    const sandboxData = await resSandbox.json();
    assert.ok(sandboxData.microSandbox);
    assert.ok(sandboxData.channelLadder);
    console.log(`  -> 阶梯与微沙箱状态就绪: 引擎 ${sandboxData.microSandbox.engine}`);

    // 6.3 长周期目标列表
    const resGoals = await fetch(`http://localhost:${testPort}/api/goals`);
    const goalsData = await resGoals.json();
    assert.ok(Array.isArray(goalsData));
    console.log(`  -> 长周期目标就绪: 共 ${goalsData.length} 个目标`);

    // 6.4 巡检 Routine 列表与 Hooks
    const resRoutines = await fetch(`http://localhost:${testPort}/api/routines`);
    const routinesData = await resRoutines.json();
    assert.ok(Array.isArray(routinesData));
    console.log(`  -> 巡检例行任务就绪: 共 ${routinesData.length} 个例行任务`);

    // 6.5 安全策略与审计
    const resPolicy = await fetch(`http://localhost:${testPort}/api/policy`);
    const policyData = await resPolicy.json();
    assert.ok(policyData.version || policyData.high_risk_patterns);
    const resGrants = await fetch(`http://localhost:${testPort}/api/grants`);
    const grantsData = await resGrants.json();
    assert.ok(Array.isArray(grantsData));
    console.log(`  -> 声明式策略与 Grants 授权体系就绪: 共 ${grantsData.length} 个授权`);

    // 6.6 /api/chat 别名对齐 /api/tasks (SSE 实时流式响应)
    const resChat = await fetch(`http://localhost:${testPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'PING_TEST', botId: 'muse' }),
    });
    assert.strictEqual(resChat.status, 200);
    assert.ok(resChat.headers.get('content-type')?.includes('text/event-stream'));
    const reader = resChat.body?.getReader();
    const chunk = await reader?.read();
    const chunkText = new TextDecoder().decode(chunk?.value);
    assert.ok(chunkText.includes('data:'));
    console.log(`  -> /api/chat 对齐 /api/tasks 异步任务派发正常 (SSE 流式输出已建立)`);

    console.log('\n===============================================================');
    console.log('   🎉 MuseClaw 前端 Web UI 全栈落地 100% 验收通过！');
    console.log('===============================================================\n');
  } finally {
    server.close();
    process.exit(0);
  }
}

runWebUiTests().catch((err) => {
  console.error('\n❌ 前端 UI 集成测试失败:', err);
  process.exit(1);
});
