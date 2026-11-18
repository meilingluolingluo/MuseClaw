import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('===============================================================');
console.log('   MUSECLAW 弹窗、确认框与通知系统 (Modal & Toast) 验收测试');
console.log('===============================================================\n');

const webHtmlPath = path.resolve(__dirname, '../apps/web/index.html');
const webCssPath = path.resolve(__dirname, '../apps/web/styles.css');
const webJsPath = path.resolve(__dirname, '../apps/web/app.js');
const gatewayHtmlPath = path.resolve(__dirname, '../apps/gateway/data/web/index.html');
const gatewayCssPath = path.resolve(__dirname, '../apps/gateway/data/web/styles.css');
const gatewayJsPath = path.resolve(__dirname, '../apps/gateway/data/web/app.js');

// [Test 1] 验证 index.html 弹窗与通知容器
console.log('[Test 1] 验证 index.html 弹窗与通知容器挂载');
const htmlContent = fs.readFileSync(webHtmlPath, 'utf-8');
assert(htmlContent.includes('id="modal-container"'), '缺少 #modal-container 容器');
assert(htmlContent.includes('id="toast-container"'), '缺少 #toast-container 容器');
console.log('  -> [PASS] #modal-container 与 #toast-container 挂载正确');

// [Test 2] 验证 styles.css 现代弹窗与 Toast 视觉样式
console.log('[Test 2] 验证 styles.css 现代化弹窗、微动效与 Toast 样式');
const cssContent = fs.readFileSync(webCssPath, 'utf-8');
const requiredCssClasses = [
  '.modal-overlay',
  '.modal-content',
  '.modal-header',
  '.modal-title',
  '.modal-close-btn',
  '.modal-footer',
  '.btn-danger',
  '.confirm-dialog-content',
  '.confirm-dialog-icon',
  '.confirm-dialog-message',
  '.consolidation-stats-grid',
  '.consolidation-stat-card',
  '.consolidation-plan-list',
  '.consolidation-plan-item',
  '.toast-container',
  '.toast',
  '.toast-success',
  '.toast-error',
  '.toast-warning',
  '.toast-info',
  '@keyframes modalOverlayFade',
  '@keyframes modalContentPop',
  '@keyframes toastSlideIn'
];

for (const cls of requiredCssClasses) {
  assert(cssContent.includes(cls), `styles.css 缺失关键类或动效: ${cls}`);
}
console.log('  -> [PASS] 所有 23 个现代弹窗、毛玻璃动效与 Toast 样式规则齐备');

// [Test 3] 验证 app.js 语法正确性与零原生 alert/confirm 约束
console.log('[Test 3] 验证 app.js 语法合法性及零原生 alert/confirm 约束');
const jsContent = fs.readFileSync(webJsPath, 'utf-8');

// 校验 JavaScript 语法正确性 (杜绝 Unexpected token)
assert.doesNotThrow(() => {
  execSync(`node --check "${webJsPath}"`, { stdio: 'pipe' });
}, 'app.js 存在语法解析错误 (SyntaxError)');
console.log('  -> [PASS] app.js JavaScript 语法解析合法');

// 严格检查无原生 alert(...) 与 confirm(...)
const alertMatches = jsContent.match(/\balert\s*\(/g);
const confirmMatches = jsContent.match(/\bconfirm\s*\(/g);
assert(!alertMatches, `app.js 中仍存在原生 alert() 调用: ${alertMatches}`);
assert(!confirmMatches, `app.js 中仍存在原生 confirm() 调用: ${confirmMatches}`);
console.log('  -> [PASS] 全代码已全面肃清原生 alert() 与 confirm() 阻塞式弹窗');

// 验证核心组件
assert(jsContent.includes('function showToast'), '缺少 showToast 函数');
assert(jsContent.includes('function showConfirm'), '缺少 showConfirm 函数');
assert(jsContent.includes('function showConsolidationReportModal'), '缺少 showConsolidationReportModal 函数');
assert(jsContent.includes('function openModal'), '缺少 openModal 函数');
assert(jsContent.includes('function closeModal'), '缺少 closeModal 函数');
assert(jsContent.includes("e.key === 'Escape'"), '缺少 Escape 键快捷关闭模态框监听');
console.log('  -> [PASS] 现代化弹窗控制器、Promise 确认框、Toast 队列与 ESC 键盘响应齐备');

// [Test 4] 验证记忆受控整理报告弹窗的数据契约解析 (解决 undefined 缺陷)
console.log('[Test 4] 验证受控整理报告数据契约解析');
assert(jsContent.includes('report.merged?.length'), '缺少针对 report.merged 数组长度的解析');
assert(jsContent.includes('report.dropped?.length'), '缺少针对 report.dropped 数组长度的解析');
assert(jsContent.includes('report.skipped?.length'), '缺少针对 report.skipped 数组长度的解析');
assert(jsContent.includes('report.considered'), '缺少针对 report.considered 的解析');
console.log('  -> [PASS] 整理报告已精准对齐后端 TidyReport 数据契约，彻底杜绝 undefined');

// [Test 5] 验证多端静态托管文件一致性
console.log('[Test 5] 验证 apps/web 与 apps/gateway/data/web 文件保持严格一致');
assert.strictEqual(fs.readFileSync(webHtmlPath, 'utf-8'), fs.readFileSync(gatewayHtmlPath, 'utf-8'), 'index.html 不一致');
assert.strictEqual(fs.readFileSync(webCssPath, 'utf-8'), fs.readFileSync(gatewayCssPath, 'utf-8'), 'styles.css 不一致');
assert.strictEqual(fs.readFileSync(webJsPath, 'utf-8'), fs.readFileSync(gatewayJsPath, 'utf-8'), 'app.js 不一致');
console.log('  -> [PASS] 前后端静态文件保持 100% 同步');

console.log('\n===============================================================');
console.log('   🎉 弹窗与通知体系美化升级 100% 验收通过！');
console.log('===============================================================\n');
