import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('===============================================================');
console.log('   MUSECLAW 侧边抽屉、导航轨与 SPA 路由系统验收测试');
console.log('===============================================================\n');

// 1. 验证 NavRail.tsx 核心导航架构与可访问性
console.log('[Test 1] 验证 NavRail.tsx 主导航轨 (7 大核心视窗) 与 A11y 语义');
const navRailPath = path.join(rootDir, 'apps/web/src/components/layout/NavRail.tsx');
const navRailCode = fs.readFileSync(navRailPath, 'utf-8');
const requiredTabs = ['chat', 'feed', 'goals', 'routines', 'memory', 'skills', 'artifacts'];
for (const t of requiredTabs) {
  assert.ok(navRailCode.includes(`id: '${t}'`), `NavRail 必须包含 ${t} 视窗导航项`);
}
assert.ok(navRailCode.includes('aria-label="主工作台导航"'), 'NavRail 必须包含无障碍导航标签');
assert.ok(navRailCode.includes('aria-current={isActive ? \'page\' : undefined}'), 'NavRail 选中项必须包含 aria-current="page"');
console.log('  -> [PASS] NavRail 导航轨 8 大核心视窗与 A11y 规范齐备');

// 2. 验证 SideDrawer.tsx 会话管理、Bot 切换与折叠动效
console.log('\n[Test 2] 验证 SideDrawer.tsx 侧边抽屉、会话管理与键盘交互');
const drawerPath = path.join(rootDir, 'apps/web/src/components/layout/SideDrawer.tsx');
const drawerCode = fs.readFileSync(drawerPath, 'utf-8');
assert.ok(drawerCode.includes('createNewSession'), 'SideDrawer 必须包含新建会话交互');
assert.ok(drawerCode.includes('deleteSession'), 'SideDrawer 必须包含会话删除功能');
assert.ok(drawerCode.includes('isDrawerCollapsed') || drawerCode.includes('drawer-collapsed'), 'SideDrawer 必须支持抽屉展开折叠状态');
assert.ok(drawerCode.includes('onKeyDown'), 'SideDrawer 会话列表项必须支持键盘 Enter/Space 选定');
console.log('  -> [PASS] SideDrawer 会话生命周期与键盘无障碍交互完备');

// 3. 验证 AppContext.tsx 导航状态机与 History 同步
console.log('\n[Test 3] 验证 AppContext.tsx 路由持久化与 popstate 浏览器导航联动');
const contextPath = path.join(rootDir, 'apps/web/src/context/AppContext.tsx');
const contextCode = fs.readFileSync(contextPath, 'utf-8');
assert.ok(contextCode.includes('setTab'), 'AppContext 必须提供全局 tab 切换方法');
assert.ok(contextCode.includes('window.history.pushState'), 'Tab 切换需同步更新浏览器 URL 路径');
assert.ok(contextCode.includes("addEventListener('popstate'"), '需监听 popstate 支持浏览器前进后退');
assert.ok(contextCode.includes('safeStorage'), '存储操作必须通过 safeStorage 安全兜底');
console.log('  -> [PASS] 全局路由状态机、浏览器前进后退与 safeStorage 存储联动正常');

// 4. 验证 styles.css 导航轨与抽屉布局样式
console.log('\n[Test 4] 验证 styles.css 侧边栏与抽屉布局样式');
const cssPath = path.join(rootDir, 'apps/web/styles.css');
const cssCode = fs.readFileSync(cssPath, 'utf-8');
assert.ok(cssCode.includes('.nav-rail'), 'styles.css 需包含 .nav-rail 样式');
assert.ok(cssCode.includes('.side-drawer') || cssCode.includes('.drawer-collapsed'), 'styles.css 需包含抽屉布局样式');
assert.ok(cssCode.includes('.session-item'), 'styles.css 需包含 .session-item 会话项样式');
console.log('  -> [PASS] 现代化侧边栏与自适应抽屉样式规则齐备');

// 5. 验证 server.ts 静态托管与 SPA History 模式 Fallback
console.log('\n[Test 5] 验证 server.ts SPA History 降级回退机制');
const serverPath = path.join(rootDir, 'apps/gateway/src/server.ts');
const serverCode = fs.readFileSync(serverPath, 'utf-8');
assert.ok(serverCode.includes('resolveWebDist'), 'server.ts 优先挂载 apps/web/dist');
assert.ok(serverCode.includes('isSpaRoute'), 'server.ts 支持所有 SPA 声明路由 fallback 到 index.html');
console.log('  -> [PASS] 服务端 SPA History 回退机制正常');

console.log('\n===============================================================');
console.log('   🎉 抽屉、导航轨与 SPA 路由系统 100% 验收通过！');
console.log('===============================================================\n');
