import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testHttpPipeline() {
  console.log('=== 开始虚拟形象系统 HTTP 端到端流水线验证 ===\n');

  // 1. 动态启动 Gateway 服务进程
  const port = 19876;
  process.env.PORT = String(port);
  process.env.NODE_ENV = 'test';

  const { startGatewayServer } = await import('../apps/gateway/src/server.ts');
  const server = startGatewayServer(port);
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[HTTP:Gateway] 网关监听基地址: ${baseUrl}`);

  // 等待网关启动
  await new Promise((r) => setTimeout(r, 800));

  // 2. 测试 GET /api/avatar/presets
  console.log('\n--- 1. 预设形象查询接口验证 (GET /api/avatar/presets) ---');
  const presetsRes = await fetch(`${baseUrl}/api/avatar/presets`);
  assert.strictEqual(presetsRes.status, 200, 'presets 接口状态码应为 200');
  const presets = (await presetsRes.json()) as any[];
  console.log(`[HTTP:Presets] 返回预设数量: ${presets.length}`);
  assert.ok(presets.length >= 6, '预设形象库数量应 >= 6');
  assert.ok(presets.some((p) => p.id === 'dragon'), '应包含 dragon 预设');

  // 3. 测试 GET /api/avatar/status
  console.log('\n--- 2. 工坊状态查询接口验证 (GET /api/avatar/status) ---');
  const statusRes = await fetch(`${baseUrl}/api/avatar/status`);
  assert.strictEqual(statusRes.status, 200, 'status 接口状态码应为 200');
  const statusData = (await statusRes.json()) as any;
  console.log(`[HTTP:Status] 可用状态: ${statusData.available}, 图像模型: ${statusData.imageModel}`);
  assert.strictEqual(statusData.available, true);
  assert.ok(statusData.imageModel, '必须提供默认图像模型');

  // 4. 测试 POST /api/avatar/begin
  console.log('\n--- 3. 形象创建会话发起 (POST /api/avatar/begin) ---');
  const beginRes = await fetch(`${baseUrl}/api/avatar/begin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: '一只佩戴霓虹护目镜的星际探险猫',
      style: 'muse',
      thread: 'test_thread_http',
    }),
  });
  assert.strictEqual(beginRes.status, 200);
  const session = (await beginRes.json()) as any;
  console.log(`[HTTP:Begin] 会话创建成功: id=${session.id}, stage=${session.stage}`);
  assert.strictEqual(session.stage, 'estimate');

  // 5. 测试 POST /api/avatar/start (绘制 4 候选)
  console.log('\n--- 4. 候选图绘制触发 (POST /api/avatar/start) ---');
  const startRes = await fetch(`${baseUrl}/api/avatar/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: session.id }),
  });
  assert.strictEqual(startRes.status, 200);

  // 等待候选生成
  let chooseReady = false;
  let latestSess: any = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const curRes = await fetch(`${baseUrl}/api/avatar/status`);
    const st = (await curRes.json()) as any;
    if (st.current && st.current.stage === 'choose') {
      chooseReady = true;
      latestSess = st.current;
      break;
    }
  }
  assert.ok(chooseReady, '候选图应顺利生成至 choose 阶段');
  console.log('[HTTP:Start] 候选四宫格就绪:', latestSess.candidates);

  // 6. 测试候选图片静态托管服务 (GET /avatars/sessions/...)
  console.log('\n--- 5. 候选图片静态资源托管服务验证 ---');
  const candUrl = latestSess.candidates[0];
  const candImgRes = await fetch(`${baseUrl}${candUrl}`);
  assert.strictEqual(candImgRes.status, 200, `候选图片应可正常访问: ${candUrl}`);
  console.log(`[HTTP:Static] 候选图片 HTTP 200 OK, Content-Type: ${candImgRes.headers.get('content-type')}`);

  // 7. 测试 POST /api/avatar/choose (生成全套姿态并装配)
  console.log('\n--- 6. 候选定型与姿态生成 (POST /api/avatar/choose) ---');
  const chooseRes = await fetch(`${baseUrl}/api/avatar/choose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: session.id, index: 0, botId: 'muse' }),
  });
  assert.strictEqual(chooseRes.status, 200);

  let doneReady = false;
  let finalSess: any = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const curRes = await fetch(`${baseUrl}/api/avatar/status`);
    const st = (await curRes.json()) as any;
    if (st.current && st.current.stage === 'done') {
      doneReady = true;
      finalSess = st.current;
      break;
    }
  }
  assert.ok(doneReady, '全套姿态应顺利生成至 done 阶段');
  console.log('[HTTP:Choose] 全套情绪切图生成完毕:', finalSess.moods);

  // 8. 测试装配后情绪姿态静态托管 (GET /avatars/custom/...)
  console.log('\n--- 7. 生成的情绪姿态静态文件访问验证 ---');
  for (const mood of ['idle', 'working', 'waiting', 'happy', 'error']) {
    const moodUrl = finalSess.moods[mood];
    const mRes = await fetch(`${baseUrl}${moodUrl}`);
    assert.strictEqual(mRes.status, 200, `情绪切图 ${mood} 必须返回 HTTP 200`);
  }
  console.log('[HTTP:Static] 所有 5 种情绪切图静态访问均验证通过！');

  // 9. 对话交互自然语言拦截验证 (POST /api/chat)
  console.log('\n--- 8. 对话通道自然语言形象创建拦截验证 (POST /api/chat) ---');
  const chatRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '帮我换个形象：复古像素小法师',
    }),
  });
  assert.strictEqual(chatRes.status, 200);
  const sseText = await chatRes.text();
  console.log('[HTTP:Chat] 对话拦截返回 SSE 采样:', sseText.slice(0, 200));
  assert.ok(sseText.includes('"type":"avatar"'), '必须截获并返回 avatar 类型 SSE 卡片事件');
  assert.ok(sseText.includes('"stage":"estimate"'), '初次拦截应进入 estimate 阶段');

  // 清理测试资源
  console.log('\n--- 9. 清理测试资源 ---');
  const faceDir = path.resolve(__dirname, '../apps/gateway/data/avatars/custom', finalSess.face);
  if (fs.existsSync(faceDir)) fs.rmSync(faceDir, { recursive: true, force: true });
  const sessDir = path.resolve(__dirname, '../apps/gateway/data/avatars/sessions', session.id);
  if (fs.existsSync(sessDir)) fs.rmSync(sessDir, { recursive: true, force: true });

  console.log('🎉 虚拟形象系统全套 HTTP 接口与对话拦截测试全部通过！\n');
  process.exit(0);
}

testHttpPipeline().catch((err) => {
  console.error('HTTP 验证异常:', err);
  process.exit(1);
});
