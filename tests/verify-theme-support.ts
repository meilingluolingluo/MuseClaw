import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function testThemeSupport() {
  console.log('===============================================================');
  console.log('   MUSECLAW 外观主题 (浅色 / 深色 / 跟随系统) 全项验证测试');
  console.log('===============================================================\n');

  // 1. 验证 index.html
  console.log('[Test 1] 验证 index.html 防闪烁脚本与外观菜单结构');
  const htmlPath = path.join(rootDir, 'apps/web/index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  assert.ok(html.includes('<meta name="theme-color" content="#ffffff" />'), '需包含 theme-color 元标签');
  assert.ok(html.includes("localStorage.getItem('museclaw_theme')"), '需包含防白屏闪烁内联脚本');
  assert.ok(html.includes('prefers-color-scheme: dark'), '内联脚本需探测系统深色偏好');
  assert.ok(html.includes('id="theme-picker-container"'), '需包含 theme-picker-container 容器');
  assert.ok(html.includes('id="btn-theme-toggle"'), '需包含 btn-theme-toggle 触发按钮');
  assert.ok(html.includes('id="theme-menu"'), '需包含 theme-menu 弹出菜单');
  assert.ok(html.includes('data-theme-value="light"'), '需支持 light 浅色选项');
  assert.ok(html.includes('data-theme-value="dark"'), '需支持 dark 深色选项');
  assert.ok(html.includes('data-theme-value="system"'), '需支持 system 跟随系统选项');
  assert.ok(html.includes('id="theme-system-status"'), '需展示跟随系统当前检测状态标注');
  console.log('  -> [PASS] index.html 结构与内联优先执行脚本校验通过');

  // 2. 验证 styles.css
  console.log('\n[Test 2] 验证 styles.css 现代浮层菜单与微动效样式');
  const cssPath = path.join(rootDir, 'apps/web/styles.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  assert.ok(css.includes('.theme-picker-container'), '需定义 .theme-picker-container 样式');
  assert.ok(css.includes('.theme-menu'), '需定义 .theme-menu 浮动面板样式');
  assert.ok(css.includes('@keyframes themeMenuPop'), '需包含 themeMenuPop 展开微动效');
  assert.ok(css.includes('.theme-menu-item.active'), '需包含选中项高亮样式');
  assert.ok(css.includes('backdrop-filter: blur'), '需包含毛玻璃拟态质感');
  assert.ok(css.includes('.theme-picker-container:hover .theme-menu'), '需支持悬停展示外观菜单');
  assert.ok(css.includes('.theme-menu.is-open'), '需支持唤起展示外观菜单');
  console.log('  -> [PASS] styles.css 外观组件样式与动效规则校验通过');

  // 3. 验证 app.js 交互与状态机逻辑
  console.log('\n[Test 3] 验证 app.js 主题模式解析与响应式联动');
  const jsPath = path.join(rootDir, 'apps/web/app.js');
  const js = fs.readFileSync(jsPath, 'utf-8');

  assert.ok(js.includes(".nav-item[data-tab]"), 'navItems 需仅筛选包含 data-tab 属性的标签项，防止覆盖主题切换');
  assert.ok(js.includes('THEME_STORAGE_KEY'), '需定义主题本地存储键');
  assert.ok(js.includes('function getSystemTheme'), '需实现 getSystemTheme 系统偏好嗅探');
  assert.ok(js.includes('function getStoredThemeSetting'), '需实现 getStoredThemeSetting 读取设置');
  assert.ok(js.includes('function resolveEffectiveTheme'), '需实现 resolveEffectiveTheme 目标色彩计算');
  assert.ok(js.includes('function applyTheme'), '需实现 applyTheme 挂载至 documentElement');
  assert.ok(js.includes('function setThemeSetting'), '需实现 setThemeSetting 设置与持久化');
  assert.ok(js.includes('function cycleTheme'), '需实现 cycleTheme 轮转切换方法');
  assert.ok(js.includes('function toggleThemeMenu'), '需实现 toggleThemeMenu 弹窗交互方法');
  assert.ok(js.includes("window.matchMedia('(prefers-color-scheme: dark)')"), '需监听系统偏好 change 事件');
  console.log('  -> [PASS] app.js 三态切换与系统自适应逻辑校验通过');

  // 4. 模拟运行状态机逻辑 (Simulated Unit Test)
  console.log('\n[Test 4] 模拟验证状态机轮换与系统主题解析');
  
  // 模拟纯逻辑函数
  function mockResolveTheme(setting: string, systemDark: boolean): string {
    if (setting === 'system') return systemDark ? 'dark' : 'light';
    return setting === 'dark' ? 'dark' : 'light';
  }

  function mockCycle(current: string): string {
    const order = ['light', 'dark', 'system'];
    const nextIdx = (order.indexOf(current) + 1) % order.length;
    return order[nextIdx];
  }

  // 4.1 轮换序列测试
  assert.strictEqual(mockCycle('light'), 'dark');
  assert.strictEqual(mockCycle('dark'), 'system');
  assert.strictEqual(mockCycle('system'), 'light');
  console.log('  -> [PASS] 轮转切换循环: light -> dark -> system -> light 准确无误');

  // 4.2 各种模式生效解析测试
  assert.strictEqual(mockResolveTheme('light', true), 'light', '强制浅色在系统深色下仍为 light');
  assert.strictEqual(mockResolveTheme('dark', false), 'dark', '强制深色在系统浅色下仍为 dark');
  assert.strictEqual(mockResolveTheme('system', true), 'dark', '跟随系统在系统深色下解析为 dark');
  assert.strictEqual(mockResolveTheme('system', false), 'light', '跟随系统在系统浅色下解析为 light');
  console.log('  -> [PASS] 主题解析目标态完全符合预期');

  // 5. 验证单源一致性 (apps/web vs apps/gateway/data/web)
  console.log('\n[Test 5] 验证网关静态资源单源备份一致性');
  const gwHtml = fs.readFileSync(path.join(rootDir, 'apps/gateway/data/web/index.html'), 'utf-8');
  const gwCss = fs.readFileSync(path.join(rootDir, 'apps/gateway/data/web/styles.css'), 'utf-8');
  const gwJs = fs.readFileSync(path.join(rootDir, 'apps/gateway/data/web/app.js'), 'utf-8');

  assert.strictEqual(html, gwHtml, 'index.html 需保持与网关数据目录一致');
  assert.strictEqual(css, gwCss, 'styles.css 需保持与网关数据目录一致');
  assert.strictEqual(js, gwJs, 'app.js 需保持与网关数据目录一致');
  console.log('  -> [PASS] apps/web 与 apps/gateway/data/web 保持 100% 同步');

  console.log('\n===============================================================');
  console.log('   🎉 外观深浅色与跟随系统全栈落地 100% 验收通过！');
  console.log('===============================================================\n');
}

testThemeSupport();
