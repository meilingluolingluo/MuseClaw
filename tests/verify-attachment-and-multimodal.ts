import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import {
  Attachment,
  formatAttachmentNote,
  modelTakesImages,
  isImage,
  imageToDataUrl,
  buildMultimodalContent,
  keepNewestImages,
  withoutImages,
  createDefaultTools,
  runAgentLoop,
  type LLMCaller,
  type LLMMessage
} from '../packages/sandbox-core/src/index.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';

async function testAttachmentSystem() {
  console.log('🧪 开始自检 MuseClaw 附件系统、多模态视觉通道与云端工具链...');

  // 1. 验证 Attachment 类型判断与人类可读格式化
  const sampleImagePath = path.resolve(process.cwd(), 'apps/gateway/data/uploads/img_1795347288098_2xfo.png');
  const imgAttachment = Attachment.fromFile(sampleImagePath, 'img_1795347288098_2xfo.png');
  assert.strictEqual(imgAttachment.kind, 'image', '图片文件应识别为 image');
  assert.strictEqual(isImage('sample.png'), true, 'png 后缀应识别为图片');
  assert.strictEqual(isImage('doc.pdf'), false, 'pdf 后缀不应识别为图片');
  assert.strictEqual(Attachment.kindOf('report.pdf'), 'pdf', 'pdf 后缀应识别为 pdf');
  assert.strictEqual(Attachment.kindOf('data.csv'), 'data', 'csv 后缀应识别为 data');
  assert.strictEqual(Attachment.kindOf('script.py'), 'text', 'py 后缀应识别为 text');
  console.log(`  ✅ 附件元信息解析正常: ${imgAttachment.describe()}`);

  // 2. 验证模型多模态视觉能力判定 (modelTakesImages)
  assert.strictEqual(modelTakesImages('deepseek-flash'), true, 'deepseek-flash 应支持视觉');
  assert.strictEqual(modelTakesImages('DeepSeek-V4-Flash-Vision-Exp'), true, 'DeepSeek-V4-Flash-Vision-Exp 应支持视觉');
  assert.strictEqual(modelTakesImages('deepseek-chat'), false, 'deepseek-chat 应为纯文本模式');
  assert.strictEqual(modelTakesImages('deepseek-reasoner'), false, 'deepseek-reasoner 应为纯文本模式');
  assert.strictEqual(modelTakesImages('qwen2.5-vl-72b'), true, 'qwen-vl 应支持视觉');
  assert.strictEqual(modelTakesImages('gpt-4o'), true, 'gpt-4o 应支持视觉');
  console.log('  ✅ 模型多模态判定 (Vision/Text) 分级准确');

  // 3. 验证真实图像转 Base64 Data URL
  if (fs.existsSync(sampleImagePath)) {
    const dataUrl = imageToDataUrl(sampleImagePath);
    assert.ok(dataUrl && dataUrl.startsWith('data:image/png;base64,'), '应成功转换为标准 Data URL');
    console.log(`  ✅ 图像像素编码成功，Data URL 长度: ${dataUrl?.length} 字符`);
  }

  // 4. 验证多模态消息组装 (buildMultimodalContent)
  const visionContent = buildMultimodalContent('请分析这张插画', [sampleImagePath], true);
  assert.ok(Array.isArray(visionContent), '视觉模式应返回多模态 ContentPart 数组');
  assert.strictEqual((visionContent as any[])[0].type, 'text');
  assert.strictEqual((visionContent as any[])[1].type, 'image_url');
  console.log('  ✅ 原生多模态 ContentPart 组装成功');

  const textContent = buildMultimodalContent('请分析这张截图', [sampleImagePath], false);
  assert.strictEqual(typeof textContent, 'string', '纯文本模式应平滑降级为 String');
  assert.ok((textContent as string).includes('ocr_document'), '降级提示应包含 ocr_document 引导');
  console.log('  ✅ 纯文本降级模式提示构建成功');

  // 5. 验证附件清单说明 (formatAttachmentNote)
  const noteVision = formatAttachmentNote([imgAttachment], true);
  assert.ok(noteVision.includes('视觉通道直接呈现'), '多模态应提示视觉直通');
  const noteText = formatAttachmentNote([imgAttachment], false);
  assert.ok(noteText.includes('ocr_document'), '纯文本模式应提示使用 ocr_document 工具');
  console.log('  ✅ 附件提示词排版自适应验证通过');

  // 6. 验证历史消息多模态滚动保留策略 (keepNewestImages)
  const dummyMessages: LLMMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: '第 1 轮有图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }
      ]
    },
    { role: 'assistant', content: '收到第 1 轮' },
    {
      role: 'user',
      content: [
        { type: 'text', text: '第 2 轮有图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } }
      ]
    },
    { role: 'assistant', content: '收到第 2 轮' },
    {
      role: 'user',
      content: [
        { type: 'text', text: '第 3 轮有图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,CCC' } }
      ]
    }
  ];

  const pruned = keepNewestImages(dummyMessages, 1);
  assert.strictEqual(typeof pruned[0].content, 'string', '最早期历史附图应被降维为纯文本');
  assert.ok(Array.isArray(pruned[4].content), '最新附图应保持多模态数组');
  console.log('  ✅ 历史图像滑动窗口保护有效，老图片成功平滑降维');

  // 7. 验证默认工具集集成 (ocr_document, web_search, web_fetch, read_file)
  const tools = createDefaultTools();
  const toolNames = new Set(tools.map((t) => t.name));
  assert.ok(toolNames.has('ocr_document'), '应包含 ocr_document 工具');
  assert.ok(toolNames.has('web_search'), '应包含 web_search 工具');
  assert.ok(toolNames.has('web_fetch'), '应包含 web_fetch 工具');
  assert.ok(toolNames.has('read_file'), '应包含 read_file 工具');

  const readFileTool = tools.find((t) => t.name === 'read_file');
  const imageReadResult = await readFileTool?.execute({ path: sampleImagePath });
  assert.strictEqual((imageReadResult as any)?.isImage, true, 'read_file 读取图片应给出结构化引导而非乱码报错');
  console.log('  ✅ 工具集扩展完整，read_file 防图片乱码机制生效');

  // 8. 闭环运行 runAgentLoop 验证端到端多模态流转
  let callerCalledWithMultimodal = false;
  const mockVisionCaller: LLMCaller = async (msgs) => {
    const lastMsg = msgs[msgs.length - 1];
    if (Array.isArray(lastMsg.content)) {
      callerCalledWithMultimodal = true;
    }
    return {
      content: '我看到了海边黄昏下的灰原哀草帽回眸插画，十分精致。'
    };
  };

  const sentinel = new SentinelPolicyManager();
  const loop = runAgentLoop(
    '你是多模态智能体',
    visionContent,
    tools,
    sentinel,
    mockVisionCaller,
    {
      sessionId: 'sess_test_vision',
      userId: 'test_user',
      botId: 'bot_ai'
    }
  );

  let finalContent = '';
  for await (const event of loop) {
    if (event.type === 'stream:text-delta') {
      finalContent += event.text;
    }
  }

  assert.strictEqual(callerCalledWithMultimodal, true, '大模型 Caller 应收到多模态 ContentPart 数组');
  console.log(`  ✅ Agent 多模态运行闭环完成，模型响应: "${finalContent || '成功解析图像'}"`);

  console.log('🎉 MuseClaw 附件与多模态视觉通道全部自检通过！');
}

testAttachmentSystem().catch((err) => {
  console.error('❌ 自检失败:', err);
  process.exit(1);
});
