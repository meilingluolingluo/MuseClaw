import assert from 'node:assert';
import { validateWidgetInput } from '../packages/sandbox-core/src/widget-validator.ts';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';
import { runAgentLoop, type LLMCaller } from '../packages/sandbox-core/src/loop.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import type { MuseEvent } from '../packages/protocol/src/index.ts';

async function testInteractiveUI() {
  console.log('🧪 开始自检 MuseClaw 智能交互界面 (Interactive UI / Widget)...');

  // 1. validateWidgetInput 基础与边界校验
  const validHtml = validateWidgetInput({
    title: '家宴采购计算器\n',
    html: '<div id="app">人数：<input type="range" min="2" max="20" value="6" /></div><script>const n = 6; console.log(n * 2);</script>',
    height: 2000,
    fallback_text: '默认按 6 人计算采购明细'
  });
  assert.strictEqual(validHtml.ok, true, '合法 HTML 组件应通过校验');
  if (validHtml.ok) {
    assert.strictEqual(validHtml.value.title, '家宴采购计算器');
    assert.strictEqual(validHtml.value.kind, 'html');
    assert.strictEqual(validHtml.value.height, 1200);
    assert.strictEqual(validHtml.value.fallbackText, '默认按 6 人计算采购明细');
  }

  const validSvg = validateWidgetInput({
    title: '自行车结构图',
    html: '  <svg viewBox="0 0 200 100"><circle cx="40" cy="60" r="25" /></svg>'
  });
  assert.strictEqual(validSvg.ok, true, '合法 SVG 组件应通过校验');
  if (validSvg.ok) {
    assert.strictEqual(validSvg.value.kind, 'svg');
  }

  const badTitle = validateWidgetInput({ title: '   ', html: '<div>ok</div>' });
  assert.strictEqual(badTitle.ok, false, '空标题应被拒绝');

  const oversized = validateWidgetInput({
    title: '超大组件',
    html: 'x'.repeat(513 * 1024)
  });
  assert.strictEqual(oversized.ok, false, '超出 512KB 应被拒绝');

  const badSyntax = validateWidgetInput({
    title: '错误脚本',
    html: '<div>test</div><script>const broken = (;</script>'
  });
  assert.strictEqual(badSyntax.ok, false, '经典内联 script 语法错误应被拦截');
  if (!badSyntax.ok) {
    assert.ok(badSyntax.error.includes('语法错误'), `错误信息应提示语法错误: ${badSyntax.error}`);
  }

  const nonClassicScripts = validateWidgetInput({
    title: '非 classic script 跳过',
    html: '<script type="application/json">{"a": 1}</script><script type="module">export const x = 1;</script><script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>'
  });
  assert.strictEqual(nonClassicScripts.ok, true, '非 classic 或外链 script 不应误报语法错误');
  console.log('  ✅ validateWidgetInput 校验与脚本语法预检全部通过');

  // 2. show_widget 工具执行与原位更新
  const tools = createDefaultTools();
  const showWidgetTool = tools.find((t) => t.name === 'show_widget');
  assert.ok(showWidgetTool, 'createDefaultTools 应包含 show_widget 工具');

  const createdRes = (await showWidgetTool!.execute({
    title: '计算器',
    html: '<div>v1</div><script>const x = 1;</script>',
    fallback_text: 'v1 摘要'
  })) as Record<string, any>;
  assert.strictEqual(createdRes.success, true);
  assert.strictEqual(createdRes.exitCode, 0);
  assert.ok(createdRes.widget_id);
  assert.ok(createdRes.__widget);

  const updatedRes = (await showWidgetTool!.execute({
    widget_id: createdRes.widget_id,
    title: '计算器 v2',
    html: '<div>v2</div>'
  })) as Record<string, any>;
  assert.strictEqual(updatedRes.success, true);
  assert.strictEqual(updatedRes.exitCode, 0);
  assert.strictEqual(updatedRes.widget_id, createdRes.widget_id);
  assert.strictEqual(updatedRes.__widget.id, createdRes.widget_id);
  console.log('  ✅ show_widget 工具创建与原位更新校验通过');

  // 3. runAgentLoop 事件派发集成验证
  const sentinel = new SentinelPolicyManager();
  let step = 0;
  const mockLLM: LLMCaller = async (messages) => {
    step++;
    if (step === 1) {
      const sys = String(messages[0]?.content || '');
      assert.ok(sys.includes('show_widget'), '启用 show_widget 时 system prompt 应包含引导');
      return {
        content: '',
        toolCalls: [
          {
            id: 'call_w1',
            name: 'show_widget',
            args: {
              title: '自行车构造拆解',
              html: '<svg viewBox="0 0 100 60"><rect width="100" height="60" /></svg>',
              fallback_text: '车架、传动系统、轮组、制动系统'
            }
          }
        ]
      };
    }
    if (step === 2) {
      return {
        content: '',
        toolCalls: [
          {
            id: 'call_w2',
            name: 'show_widget',
            args: {
              title: '家宴采购计算器',
              html: '<div><input id="p" type="number" value="6" /></div><script>console.log(1);</script>',
              fallback_text: '默认 6 人份清单'
            }
          }
        ]
      };
    }
    return {
      content: '已为您生成可交互组件。'
    };
  };

  const events: MuseEvent[] = [];
  for await (const ev of runAgentLoop('你是助手', '帮我展示结构图和计算器', tools, sentinel, mockLLM, {
    sessionId: 'sess_widget_test',
    userId: 'user_test',
    botId: 'muse'
  })) {
    events.push(ev);
  }

  const widgetEvents = events.filter((e) => e.type === 'ui:widget');
  assert.strictEqual(widgetEvents.length, 2, '事件流应产出 2 个 ui:widget 事件');
  assert.strictEqual(widgetEvents[0].type === 'ui:widget' ? widgetEvents[0].widget.kind : '', 'svg');
  assert.strictEqual(widgetEvents[1].type === 'ui:widget' ? widgetEvents[1].widget.kind : '', 'html');
  assert.ok(
    !events.some((e) => e.type === 'stream:text-delta' && e.text.includes('Loop Guard')),
    '正常调用 show_widget 不应触发 Loop Guard 熔断'
  );
  console.log('  ✅ runAgentLoop 派发 ui:widget 事件流验证通过');
  console.log('🎉 MuseClaw 智能交互界面回归测试全部通过！');
}

testInteractiveUI().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
