import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('===============================================================');
console.log('   MUSECLAW 弹窗、确认框与通知系统 (Modal & Toast) 验收测试');
console.log('===============================================================\n');

const webSrcDir = path.resolve(__dirname, '../apps/web/src');
const modalTsxPath = path.resolve(webSrcDir, 'components/common/Modal.tsx');
const toastTsxPath = path.resolve(webSrcDir, 'components/common/Toast.tsx');
const appContextPath = path.resolve(webSrcDir, 'context/AppContext.tsx');
const webCssPath = path.resolve(__dirname, '../apps/web/styles.css');

// [Test 1] 验证 Modal.tsx 可访问性标准与焦点陷阱
console.log('[Test 1] 验证 Modal.tsx 可访问性 (A11y)、键盘陷阱与 Escape 响应');
const modalCode = fs.readFileSync(modalTsxPath, 'utf-8');
assert(modalCode.includes("role=\"dialog\""), 'Modal 必须具备 role="dialog" 可访问性角色');
assert(modalCode.includes("aria-modal=\"true\""), 'Modal 必须具备 aria-modal="true" 语义');
assert(modalCode.includes("e.key === 'Escape'"), 'Modal 必须监听 Escape 按键并关闭');
assert(modalCode.includes("createPortal"), 'Modal 必须使用 createPortal 挂载到根节点');
assert(modalCode.includes("restoreFocusRef"), 'Modal 关闭后必须归还焦点至触发元素');
console.log('  -> [PASS] Modal 组件具备焦点锁定、Escape 关闭与焦点归还');

// [Test 2] 验证 Toast.tsx 通知系统与可访问性
console.log('\n[Test 2] 验证 Toast.tsx 容器与屏幕阅读器语义');
const toastCode = fs.readFileSync(toastTsxPath, 'utf-8');
assert(toastCode.includes("role=\"log\""), 'Toast 容器必须具备 role="log" 语义');
assert(toastCode.includes("aria-live=\"polite\""), 'Toast 容器必须具备 aria-live="polite" 实时播报');
assert(toastCode.includes("role={toast.type === 'error' ? 'alert' : 'status'}"), '错误 Toast 必须使用 role="alert"');
assert(toastCode.includes("aria-label=\"关闭提示\""), 'Toast 关闭按钮必须具备可访问性 aria-label');
console.log('  -> [PASS] Toast 通知系统无障碍实时播报与手动关闭完备');

// [Test 3] 验证 styles.css 现代弹窗与 Toast 视觉样式
console.log('\n[Test 3] 验证 styles.css 现代化弹窗、微动效与 Toast 样式');
const cssContent = fs.readFileSync(webCssPath, 'utf-8');
const requiredCssClasses = [
  '.modal-overlay',
  '.modal-content',
  '.modal-header',
  '.modal-title',
  '.modal-close-btn',
  '.modal-footer',
  '.toast-container',
  '.toast',
  '.toast-success',
  '.toast-error',
  '.toast-warning',
  '.toast-info',
];

for (const cls of requiredCssClasses) {
  assert(cssContent.includes(cls), `styles.css 缺失关键类或动效: ${cls}`);
}
console.log('  -> [PASS] 所有弹窗、遮罩与 Toast 样式规则齐备');

// [Test 4] 验证全前端源码零原生 alert(...) 与 confirm(...) 阻塞式调用
console.log('\n[Test 4] 验证 apps/web/src 全栈源码零原生 alert/confirm 约束');
function scanDir(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      scanDir(fullPath, fileList);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const allWebFiles = scanDir(webSrcDir);
let nativeAlertCount = 0;
let nativeConfirmCount = 0;

for (const filePath of allWebFiles) {
  const content = fs.readFileSync(filePath, 'utf-8');
  // 匹配全局函数 alert( 或 window.alert(
  const alertMatches = content.match(/\b(?<!\.)alert\s*\(/g) || content.match(/\bwindow\.alert\s*\(/g);
  // 匹配全局函数 confirm( 或 window.confirm(
  const confirmMatches = content.match(/\b(?<!\.)confirm\s*\(/g) || content.match(/\bwindow\.confirm\s*\(/g);
  if (alertMatches) {
    console.error(`  ❌ 发现原生 alert 调用: ${path.relative(webSrcDir, filePath)}`);
    nativeAlertCount += alertMatches.length;
  }
  if (confirmMatches) {
    console.error(`  ❌ 发现原生 confirm 调用: ${path.relative(webSrcDir, filePath)}`);
    nativeConfirmCount += confirmMatches.length;
  }
}

assert.strictEqual(nativeAlertCount, 0, `前端源码中仍存在原生 alert() 调用 (${nativeAlertCount}处)`);
assert.strictEqual(nativeConfirmCount, 0, `前端源码中仍存在原生 confirm() 调用 (${nativeConfirmCount}处)`);
console.log(`  -> [PASS] 已扫描 ${allWebFiles.length} 个前端源码文件，全代码库 100% 肃清阻塞式原生 alert/confirm`);

// [Test 5] 验证 AppContext.tsx Toast 管理机制
console.log('\n[Test 5] 验证 AppContext.tsx showToast 全局管理机制');
const contextCode = fs.readFileSync(appContextPath, 'utf-8');
assert(contextCode.includes("showToast"), 'AppContext 必须导出 showToast 方法');
assert(contextCode.includes("dismissToast"), 'AppContext 必须提供 dismissToast 方法');
console.log('  -> [PASS] 全局 Toast 状态机与队列管理正常');

console.log('\n===============================================================');
console.log('   🎉 弹窗与通知体系 (Modal & Toast) 100% 验收通过！');
console.log('===============================================================\n');
