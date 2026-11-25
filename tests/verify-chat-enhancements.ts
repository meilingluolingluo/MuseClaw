import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore } from '../apps/gateway/bots/session-store.ts';
import { splitMarkdownIntoBlocks, preprocessMath } from '../apps/web/src/utils/markdownBlocks.ts';
import { renderMarkdown, ansiToHtml } from '../apps/web/src/utils/markdown.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, 'test_chat_enhancements_dir');

async function runTests() {
  console.log('=== 开始对话页增强功能自动化验证 ===');

  // 1. 验证 SessionStore.truncate 与 SessionStore.fork
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  const store = new SessionStore(testDir);
  const botId = 'muse';
  const userId = 'tester_chat';

  const mainSess = store.getMainSession(botId, userId);
  mainSess.messages = [
    { id: 'u1', role: 'user', content: '第一问' },
    { id: 'a1', role: 'assistant', content: '第一答' },
    { id: 'u2', role: 'user', content: '第二问' },
    { id: 'a2', role: 'assistant', content: '第二答' },
  ];
  store.save(mainSess, userId);

  // 分叉旁聊至索引 1（包含 u1, a1）
  const forked = store.fork(mainSess.id, 1, '分支探讨', userId);
  assert.ok(forked, 'fork 应成功返回新旁聊');
  assert.strictEqual(forked!.kind, 'side', '分叉出的会话必须为旁聊');
  assert.strictEqual(forked!.messages?.length, 2, '分叉消息数应为 2');
  assert.strictEqual(forked!.messages?.[1]?.content, '第一答');

  // 原主聊不应受分叉影响
  assert.strictEqual(store.get(mainSess.id, userId)?.messages?.length, 4);

  // 截断原主聊至前 2 条
  const truncated = store.truncate(mainSess.id, 2, userId);
  assert.strictEqual(truncated, true, 'truncate 应返回 true');
  assert.strictEqual(store.get(mainSess.id, userId)?.messages?.length, 2, '截断后消息数应为 2');
  assert.strictEqual(store.truncate(mainSess.id, -1, userId), false, '负数 keepCount 应拒绝');

  await store.flush(userId);
  const reloadedStore = new SessionStore(testDir);
  assert.strictEqual(reloadedStore.get(mainSess.id, userId)?.messages?.length, 2, '截断结果应持久落盘');
  assert.strictEqual(reloadedStore.get(forked!.id, userId)?.messages?.length, 2, '分叉旁聊应持久落盘');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  console.log('[PASS] SessionStore.truncate / fork 与持久化校验通过');

  // 2. 验证 splitMarkdownIntoBlocks
  const sampleMd = [
    '第一段引言。',
    '',
    '| 指标 | 数值 | 说明 |',
    '| :--- | ---: | :--- |',
    '| 延迟 | 120ms | 这是一段非常长的说明文字，不应该被强制单行撑爆表格 |',
    '',
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
    '',
    '```clarify',
    '{"question":"请选择部署环境","options":[{"label":"生产环境"},{"label":"预发环境"}]}',
    '```',
    '',
    '```ts',
    'const x = 1;',
  ].join('\n');

  const blocks = splitMarkdownIntoBlocks(sampleMd, true);
  assert.strictEqual(blocks[0]?.type, 'markdown');
  assert.strictEqual(blocks[1]?.type, 'table');
  assert.strictEqual(blocks[2]?.type, 'mermaid');
  assert.strictEqual(blocks[3]?.type, 'domain-card');
  if (blocks[3]?.type === 'domain-card') {
    assert.strictEqual(blocks[3].kind, 'clarify');
  }
  assert.strictEqual(blocks[4]?.type, 'code');
  if (blocks[4]?.type === 'code') {
    assert.strictEqual(blocks[4].open, true, '流式未闭合代码块应标记 open: true');
  }
  console.log('[PASS] splitMarkdownIntoBlocks 分块与流式状态识别通过');

  // 3. 验证 preprocessMath 与货币防误判
  const mathSample = '价格是 $100 和 US$50，区间 $10-$20，行内代码 `$y$`，公式 $E=mc^2$ 与块公式：\n$$\n\\sum_{i=1}^n i\n$$';
  const { text: stripped, tokens } = preprocessMath(mathSample);
  assert.strictEqual(tokens.length, 2, '仅应提取 2 个真实公式，忽略货币与行内代码');
  const inlineToken = tokens.find((t) => !t.display);
  const displayToken = tokens.find((t) => t.display);
  assert.strictEqual(inlineToken?.tex, 'E=mc^2');
  assert.strictEqual(displayToken?.tex, '\\sum_{i=1}^n i');
  assert.ok(stripped.includes('$100') && stripped.includes('US$50') && stripped.includes('`$y$`'), '货币与行内代码应保持原样');
  console.log('[PASS] preprocessMath 公式提取与货币保护校验通过');

  // 4. 验证 GitHub Alerts、XSS 转义、表格 nowrap 规则与 ANSI 着色
  const alertMd = '> [!WARNING]\n> 请先备份数据库再执行迁移\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))';
  const alertHtml = renderMarkdown(alertMd);
  assert.ok(alertHtml.includes('markdown-alert-warning'), '应渲染 WARNING Alert 容器');
  assert.ok(!alertHtml.includes('<script>'), '原始 script 标签必须被转义');
  assert.ok(!alertHtml.includes('javascript:alert'), '危险协议链接必须被拦截');

  const tableHtml = renderMarkdown('| 短列 | 长说明列 |\n| --- | --- |\n| OK | 这是一段超过十六个字符的详细说明文本内容 |');
  assert.ok(tableHtml.includes('<td class="cell-nowrap">OK</td>'), '短单元格应保留 cell-nowrap');
  assert.ok(tableHtml.includes('<td>这是一段超过十六个字符的详细说明文本内容</td>'), '长单元格不应强制 nowrap');

  const ansiHtml = ansiToHtml('\x1b[32mPASS\x1b[0m <b>safe</b>');
  assert.ok(ansiHtml.includes('ansi-fg-green'), 'ANSI 绿字应映射为语义类');
  assert.ok(!ansiHtml.includes('<b>safe</b>') && ansiHtml.includes('&lt;b&gt;safe&lt;/b&gt;'), 'ANSI 输出必须先做 HTML 转义');
  console.log('[PASS] Markdown Alerts、安全转义、表格折行与 ANSI 转义校验通过');

  console.log('\n🎉 所有对话页增强自动化测试全部通过！');
}

runTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
