import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotRegistry } from '../apps/gateway/bots/registry.ts';
import { AvatarStudio } from '../apps/gateway/avatar/studio.ts';
import { parseAvatarRequest, parseAvatarChoice } from '../apps/gateway/avatar/parser.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runAvatarVerification() {
  console.log('=== 开始测试虚拟形象系统闭环功能 ===');

  // 1. 自然语言意图解析测试 (Natural Language Intent Parser)
  console.log('\n--- 1. 自然语言意图解析测试 ---');
  const testPrompts = [
    { text: '帮我换个形象：一只太空宇航猫', expected: '一只太空宇航猫' },
    { text: '把你的虚拟形象改成为复古蒸汽朋克猫头鹰。', expected: '复古蒸汽朋克猫头鹰' },
    { text: '换个新头像：赛博朋克机械柴犬！', expected: '赛博朋克机械柴犬' },
    { text: '变成一只戴着厨师帽的萌宠水豚吧', expected: '一只戴着厨师帽的萌宠水豚' },
    { text: 'change your avatar into a cute baby robot', expected: 'cute baby robot' },
    { text: 'new avatar: an astronaut puppy', expected: 'astronaut puppy' },
  ];

  for (const { text, expected } of testPrompts) {
    const result = parseAvatarRequest(text);
    console.log(`[Parser:Request] 输入: "${text}" => 解析结果: "${result}"`);
    assert.strictEqual(result, expected, `解析结果不匹配: 期望 "${expected}", 实际 "${result}"`);
  }

  // 2. 候选选择与指令解析测试 (Choice Parser)
  console.log('\n--- 2. 交互指令与选择解析测试 ---');
  const testChoices = [
    { text: '第1个', expected: 0 },
    { text: '选第二个吧', expected: 1 },
    { text: '我要第3张', expected: 2 },
    { text: '4号', expected: 3 },
    { text: '左上角那个', expected: 0 },
    { text: '右下角', expected: 3 },
    { text: 'pick the 2nd one', expected: 1 },
    { text: '重新生成', expected: 'regenerate' },
    { text: '再来一组', expected: 'regenerate' },
    { text: '算了', expected: 'cancel' },
    { text: 'never mind', expected: 'cancel' },
  ];

  for (const { text, expected } of testChoices) {
    const result = parseAvatarChoice(text);
    console.log(`[Parser:Choice] 输入: "${text}" => 解析结果: "${result}"`);
    assert.strictEqual(result, expected, `选择解析不匹配: 期望 "${expected}", 实际 "${result}"`);
  }

  // 3. 形象工坊全生命周期状态机测试 (Avatar Studio Lifecycle)
  console.log('\n--- 3. 形象工坊生命周期状态机与切图标注测试 ---');
  const testDataDir = path.resolve(__dirname, '../apps/gateway/data/avatars');
  const botRegistry = new BotRegistry();
  const studio = new AvatarStudio(botRegistry, testDataDir);

  // 3.1 预设检查
  const presets = studio.getPresets();
  console.log(`[Presets] 已注册预设形象数量: ${presets.length}`);
  assert.ok(presets.length >= 6, '预设形象库数量应至少包含 6 种经典形象');
  const dragon = presets.find((p) => p.id === 'dragon');
  assert.ok(dragon, '必须包含小龙预设形象');
  assert.strictEqual(dragon.moods.idle, '/avatars/dragon-idle.webp');
  assert.strictEqual(dragon.clips?.idle, '/avatars/dragon-idle.mp4');

  // 3.2 启动创建会话 (Begin)
  const session = await studio.begin({
    description: '一只软萌的治愈系小柴犬，系着红蓝格子围巾',
    style: 'muse',
    botId: 'muse',
  });
  console.log(`[Session:Begin] 会话创建成功: id=${session.id}, stage=${session.stage}`);
  assert.strictEqual(session.stage, 'estimate', '初创会话阶段应为 estimate');
  assert.strictEqual(session.candidates.length, 4, '候选插槽数应为 4');

  // 3.3 开始绘制候选 (Start -> Drawing -> Choose)
  console.log('[Session:Start] 开始绘制候选四宫格...');
  await studio.start(session.id);
  // 等待异步生成完成
  let waitCount = 0;
  while (session.stage === 'drawing' && waitCount < 30) {
    await new Promise((r) => setTimeout(r, 100));
    waitCount++;
  }
  console.log(`[Session:Drawn] 生成完成: stage=${session.stage}, 候选列表:`, session.candidates);
  assert.strictEqual(session.stage, 'choose', '候选生成完成后状态应为 choose');
  assert.ok(
    session.candidates.every((c) => c !== null && c.endsWith('.webp')),
    '4 个候选图应全部生成完毕且均为 webp 格式'
  );

  // 3.4 选定候选并生成情绪姿态 (Choose -> Posing -> Done)
  console.log('[Session:Choose] 选定候选 0，生成全套情绪姿态 (idle, working, waiting, happy, error)...');
  await studio.choose(session.id, 0, 'muse');
  waitCount = 0;
  while (session.stage === 'posing' && waitCount < 30) {
    await new Promise((r) => setTimeout(r, 100));
    waitCount++;
  }
  console.log(`[Session:Done] 姿态生成完毕: stage=${session.stage}, faceId=${session.face}`);
  assert.strictEqual(session.stage, 'done', '全套姿态生成完成后状态应为 done');
  assert.ok(session.face, '会话必须产出唯一的 face ID');
  assert.ok(session.moods?.idle, '必须包含 idle 姿态');
  assert.ok(session.moods?.working, '必须包含 working 姿态');
  assert.ok(session.moods?.waiting, '必须包含 waiting 姿态');
  assert.ok(session.moods?.happy, '必须包含 happy 姿态');
  assert.ok(session.moods?.error, '必须包含 error 姿态');

  // 3.5 校验磁盘文件落地与 BotProfile 动态更新
  const faceDir = path.join(testDataDir, 'custom', session.face!);
  assert.ok(fs.existsSync(faceDir), '磁盘必须建立对应 face 目录');
  assert.ok(fs.existsSync(path.join(faceDir, 'idle.webp')), '必须落盘 idle.webp');
  assert.ok(fs.existsSync(path.join(faceDir, 'working.webp')), '必须落盘 working.webp');
  assert.ok(fs.existsSync(path.join(faceDir, 'waiting.webp')), '必须落盘 waiting.webp');
  assert.ok(fs.existsSync(path.join(faceDir, 'happy.webp')), '必须落盘 happy.webp');
  assert.ok(fs.existsSync(path.join(faceDir, 'error.webp')), '必须落盘 error.webp');
  assert.ok(fs.existsSync(path.join(faceDir, 'face.json')), '必须落盘 face.json 元数据文件');

  const metaContent = JSON.parse(fs.readFileSync(path.join(faceDir, 'face.json'), 'utf-8'));
  console.log('[Meta:Check] face.json 元数据校验通过:', metaContent);
  assert.strictEqual(metaContent.id, session.face);
  assert.strictEqual(metaContent.style, 'muse');

  const updatedBot = botRegistry.get('muse');
  console.log(`[BotRegistry:Check] 智能体「${updatedBot?.name}」形象已更新为: ${updatedBot?.avatar}`);
  assert.strictEqual(updatedBot?.avatar, session.face, 'BotRegistry 必须更新为最新生成的 faceId');

  // 3.6 姿态重绘功能测试 (Redraw Moods)
  console.log('\n--- 4. 在线重绘姿态测试 ---');
  const redrawSession = await studio.redrawMoods('muse');
  waitCount = 0;
  while (redrawSession.stage === 'posing' && waitCount < 30) {
    await new Promise((r) => setTimeout(r, 100));
    waitCount++;
  }
  assert.strictEqual(redrawSession.stage, 'done', '重绘姿态完成后状态应为 done');
  console.log('[Redraw:Done] 姿态重绘成功完成');

  // 4. 清理测试资源并恢复默认 Bot 头像
  console.log('\n--- 5. 清理测试产生的临时形象文件 ---');
  fs.rmSync(faceDir, { recursive: true, force: true });
  const sessDir = path.join(testDataDir, 'sessions', session.id);
  if (fs.existsSync(sessDir)) fs.rmSync(sessDir, { recursive: true, force: true });
  if (updatedBot) {
    updatedBot.avatar = 'haibara';
    botRegistry.save();
  }
  console.log('测试环境已恢复至初始状态。\n');
  console.log('🎉 虚拟形象系统后端与生命周期测试全部通过！');
}

runAvatarVerification().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
