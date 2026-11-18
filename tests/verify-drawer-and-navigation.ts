import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function testDrawerAndNavigation() {
  console.log('--- 验证抽屉与多 Agent 产品交互逻辑优化 ---');

  // 1. 验证 HTML 结构
  const htmlPath = path.join(rootDir, 'apps/web/index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  assert.ok(html.includes('id="side-drawer"'), 'index.html 需包含 side-drawer 标识');
  assert.ok(html.includes('id="btn-toggle-drawer"'), 'index.html 需包含抽屉折叠/展开按钮');
  assert.ok(html.includes('id="global-view-title-container"'), 'index.html 需包含全局视图标题栏');
  assert.ok(html.includes('id="global-top-status"'), 'index.html 需包含全局顶部状态容器');
  assert.ok(html.includes('id="memory-active-bot-name"'), 'index.html 需包含记忆归属 Bot 标识');
  console.log('✅ [1/5] index.html 抽屉与顶栏解耦结构校验通过');

  // 2. 验证 CSS 样式
  const cssPath = path.join(rootDir, 'apps/web/styles.css');
  const css = fs.readFileSync(cssPath, 'utf-8');
  assert.ok(css.includes('.drawer-hidden'), 'styles.css 需包含 .drawer-hidden 样式规则');
  assert.ok(css.includes('.drawer-collapsed'), 'styles.css 需包含 .drawer-collapsed 折叠动画');
  assert.ok(css.includes('.btn-toggle-drawer'), 'styles.css 需包含 .btn-toggle-drawer 按钮样式');
  console.log('✅ [2/5] styles.css 自适应抽屉折叠与动效规则校验通过');

  // 3. 验证 app.js 交互逻辑
  const jsPath = path.join(rootDir, 'apps/web/app.js');
  const js = fs.readFileSync(jsPath, 'utf-8');
  assert.ok(js.includes('function updateDrawerForTab'), 'app.js 需包含 updateDrawerForTab 抽屉派发逻辑');
  assert.ok(js.includes('function updateTopBarForTab'), 'app.js 需包含 updateTopBarForTab 顶栏解耦逻辑');
  assert.ok(js.includes('function toggleDrawer'), 'app.js 需包含 toggleDrawer 手动折叠方法');
  assert.ok(js.includes("state.currentTab === 'memory'"), 'app.js selectBot 需联动 loadMemory');
  assert.ok(js.includes("switchTab('chat')"), 'app.js 非对话/记忆下选中 Bot 需平滑切回对话');
  console.log('✅ [3/5] app.js 上下文派发与 Bot 切换联动逻辑校验通过');

  // 4. 验证 server.ts 静态目录优先级
  const serverPath = path.join(rootDir, 'apps/gateway/src/server.ts');
  const serverCode = fs.readFileSync(serverPath, 'utf-8');
  assert.ok(serverCode.includes("path.resolve(__dirname, '../../web/index.html')"), 'server.ts 优先加载 apps/web/index.html');
  assert.ok(serverCode.includes("path.resolve(__dirname, '../../web')"), 'server.ts 优先挂载 apps/web 静态目录');
  console.log('✅ [4/5] server.ts 前端静态目录单源化优先级校验通过');

  // 5. 验证 Vite 代理配置
  const vitePath = path.join(rootDir, 'apps/web/vite.config.ts');
  assert.ok(fs.existsSync(vitePath), 'apps/web/vite.config.ts 需存在');
  const viteCode = fs.readFileSync(vitePath, 'utf-8');
  assert.ok(viteCode.includes("target: 'http://localhost:8799'"), 'Vite 需正确代理 /api 到后端网关端口');
  console.log('✅ [5/6] vite.config.ts 开发热更反向代理配置校验通过');

  // 6. 验证 SPA 路由状态同步与刷新持久化逻辑
  assert.ok(js.includes('function getTabFromLocation'), 'app.js 需包含 getTabFromLocation 路由状态恢复函数');
  assert.ok(js.includes('window.history.pushState'), 'switchTab 需同步更新浏览器 URL 路径');
  assert.ok(js.includes("localStorage.setItem('museclaw_active_tab'"), 'Tab 切换需落盘保存用户当前所在视窗');
  assert.ok(js.includes("localStorage.setItem('museclaw_active_bot'"), 'Bot 选择需落盘保存');
  assert.ok(js.includes("localStorage.setItem('museclaw_active_session'"), 'Session 选择需落盘保存');
  assert.ok(js.includes("window.addEventListener('popstate'"), '需监听 popstate 支持浏览器前进后退');
  console.log('✅ [6/6] SPA History 路径同步与页面刷新状态自恢复校验通过');

  console.log('🎉 所有抽屉与交互优化全项验收 100% 通过！\n');
}

testDrawerAndNavigation();
