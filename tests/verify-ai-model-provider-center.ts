import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  normalizeChatCompletionsUrl,
  createOpenAICompatibleCaller,
  testProviderConnection,
  probeOllamaModels,
  type ModelProviderConfig
} from '../packages/sandbox-core/src/llm.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('===============================================================');
console.log('   MUSECLAW AI 大模型服务接入中心 (BYOK & Multi-Provider) 全项测试');
console.log('===============================================================\n');

// [Test 1] 校验 OpenAI-Compatible 端点规范化
console.log('[Test 1] 校验 Chat Completions 接入点 URL 标准化函数');
assert.strictEqual(
  normalizeChatCompletionsUrl('https://api.deepseek.com'),
  'https://api.deepseek.com/chat/completions'
);
assert.strictEqual(
  normalizeChatCompletionsUrl('https://api.openai.com/v1'),
  'https://api.openai.com/v1/chat/completions'
);
assert.strictEqual(
  normalizeChatCompletionsUrl('http://localhost:11434'),
  'http://localhost:11434/v1/chat/completions'
);
assert.strictEqual(
  normalizeChatCompletionsUrl('https://api.example.com/v1/chat/completions'),
  'https://api.example.com/v1/chat/completions'
);
console.log('  -> [PASS] 所有变体端点标准化正确');

// [Test 2] 校验网关模型配置与状态接口 (GET /api/models/config)
console.log('[Test 2] 校验网关 REST API: GET /api/models/config');
const getRes = execSync('curl -s http://localhost:8799/api/models/config').toString();
const configData = JSON.parse(getRes);
assert(configData.activeProviderId, '缺少 activeProviderId');
assert(Array.isArray(configData.providers), '缺少 providers 数组');
assert(configData.providers.length >= 6, '预设模型供应商数量不足');

const deepseekProvider = configData.providers.find((p: any) => p.id === 'deepseek');
assert(deepseekProvider, '未找到 deepseek 预设');
assert(deepseekProvider.hasKey === true, '未正确解析本地已有 DeepSeek 凭证');
assert(deepseekProvider.maskedKey.includes('••••'), '凭证未安全掩码回传');
console.log(`  -> [PASS] 成功返回预设列表，当前激活: [${configData.activeProviderId}]`);

// [Test 3] 校验连通性测试接口 (POST /api/models/test)
console.log('[Test 3] 校验网关连通性探针: POST /api/models/test');
const testRes = execSync(
  `curl -s -X POST http://localhost:8799/api/models/test -H "Content-Type: application/json" -d '{"id":"deepseek","baseUrl":"https://api.deepseek.com/chat/completions","model":"deepseek-chat"}'`
).toString();
const testData = JSON.parse(testRes);
assert(typeof testData.ok === 'boolean', '连通测试缺少 ok 布尔值');
assert(typeof testData.latencyMs === 'number', '连通测试缺少 latencyMs 延迟记录');
console.log(`  -> [PASS] 连通测试响应正常: ok=${testData.ok}, 延迟=${testData.latencyMs}ms, 模型=${testData.model || 'N/A'}`);

// [Test 4] 校验动态更新配置接口 (POST /api/models/config)
console.log('[Test 4] 校验更新模型配置: POST /api/models/config');
const updatePayload = JSON.stringify({
  activeProviderId: 'deepseek',
  provider: {
    id: 'custom',
    name: '企业内部专有网关',
    baseUrl: 'https://internal-ai.corp/v1/chat/completions',
    model: 'corp-gpt-v2'
  }
});
const updateRes = execSync(
  `curl -s -X POST http://localhost:8799/api/models/config -H "Content-Type: application/json" -d '${updatePayload}'`
).toString();
const updateData = JSON.parse(updateRes);
assert(updateData.success === true, '更新配置未返回 success: true');

const verifyRes = execSync('curl -s http://localhost:8799/api/models/config').toString();
const verifyData = JSON.parse(verifyRes);
const customP = verifyData.providers.find((p: any) => p.id === 'custom');
assert(customP && customP.name === '企业内部专有网关', '自定义提供商未成功持久化更新');
console.log('  -> [PASS] 模型服务配置动态更新与落盘正常');

// [Test 5] 校验前端静态文件语法合法性与多端一致性
console.log('[Test 5] 校验前端 app.js、styles.css、index.html 语法与组件挂载');
const webJsPath = path.resolve(__dirname, '../apps/web/app.js');
const webHtmlPath = path.resolve(__dirname, '../apps/web/index.html');
const webCssPath = path.resolve(__dirname, '../apps/web/styles.css');
const gatewayJsPath = path.resolve(__dirname, '../apps/gateway/data/web/app.js');

assert.doesNotThrow(() => {
  execSync(`node --check "${webJsPath}"`, { stdio: 'pipe' });
}, 'apps/web/app.js 存在语法错误');

assert.strictEqual(
  fs.readFileSync(webJsPath, 'utf-8'),
  fs.readFileSync(gatewayJsPath, 'utf-8'),
  'web 与 gateway/data/web app.js 不一致'
);

const html = fs.readFileSync(webHtmlPath, 'utf-8');
assert(html.includes('id="btn-model-settings"'), '导航栏缺少 #btn-model-settings 按钮');
assert(html.includes('id="btn-top-model-badge"'), '顶栏缺少 #btn-top-model-badge 胶囊');

const css = fs.readFileSync(webCssPath, 'utf-8');
assert(css.includes('.model-status-capsule'), 'styles.css 缺少 .model-status-capsule');
assert(css.includes('.model-provider-card'), 'styles.css 缺少 .model-provider-card');
console.log('  -> [PASS] 前端代码语法合法，UI 组件齐备且多端保持一致');

console.log('\n===============================================================');
console.log('   🎉 AI 大模型服务接入中心 (Option A) 全项验收 100% 通过！');
console.log('===============================================================\n');
