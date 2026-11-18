import { Icons } from './icons.js';

// ============================================================================
// 全局响应式状态模型 (Global State)
// ============================================================================
const state = {
  currentTab: 'chat',
  bots: [],
  activeBotId: null,
  sessions: [],
  activeSessionId: null,
  isTainted: false,
  taintReasons: [],
  messages: [],
  goals: [],
  routines: [],
  routineRuns: [],
  hooks: [],
  memoryText: '',
  memoryItems: [],
  memoryReports: [],
  sandboxStatus: null,
  channelLadder: null,
  mcpServers: [],
  policy: {},
  grants: [],
  auditLogs: [],
  artifacts: [],
  modelsConfig: { activeProviderId: 'deepseek', providers: [] },
  isStreaming: false
};

// ============================================================================
// DOM 元素引用
// ============================================================================
const dom = {
  navItems: document.querySelectorAll('.nav-item[data-tab]'),
  btnModelSettings: document.getElementById('btn-model-settings'),
  btnTopModelBadge: document.getElementById('btn-top-model-badge'),
  topModelName: document.getElementById('top-model-name'),
  topModelIcon: document.getElementById('top-model-icon'),
  views: {
    chat: document.getElementById('view-chat'),
    goals: document.getElementById('view-goals'),
    routines: document.getElementById('view-routines'),
    memory: document.getElementById('view-memory'),
    skills: document.getElementById('view-skills'),
    audit: document.getElementById('view-audit'),
    artifacts: document.getElementById('view-artifacts')
  },
  sideDrawer: document.getElementById('side-drawer'),
  drawerHeader: document.getElementById('drawer-header'),
  drawerTitle: document.getElementById('drawer-title'),
  sessionSection: document.getElementById('session-section'),
  btnToggleDrawer: document.getElementById('btn-toggle-drawer'),
  iconToggleDrawer: document.getElementById('icon-toggle-drawer'),
  globalViewTitleContainer: document.getElementById('global-view-title-container'),
  globalViewIcon: document.getElementById('global-view-icon'),
  globalViewTitle: document.getElementById('global-view-title'),
  globalViewTag: document.getElementById('global-view-tag'),
  globalTopStatus: document.getElementById('global-top-status'),
  globalSystemBadge: document.getElementById('global-system-badge'),
  memoryActiveBotName: document.getElementById('memory-active-bot-name'),
  sandboxStatusBadge: document.getElementById('sandbox-status-badge'),
  botList: document.getElementById('bot-list-container'),
  sessionList: document.getElementById('session-list-container'),
  botCountBadge: document.getElementById('bot-count-badge'),
  btnNewSession: document.getElementById('btn-new-session'),
  activeBotAvatar: document.getElementById('active-bot-avatar'),
  activeBotName: document.getElementById('active-bot-name'),
  activeBotRole: document.getElementById('active-bot-role'),
  btnBotDetail: document.getElementById('btn-bot-detail'),
  taintBadgeContainer: document.getElementById('taint-badge-container'),
  approvalModeBtn: document.getElementById('approval-mode-btn'),
  approvalModeText: document.getElementById('current-approval-mode-text'),
  chatMessages: document.getElementById('chat-messages'),
  composerInput: document.getElementById('composer-input'),
  btnSendMessage: document.getElementById('btn-send-message'),
  promptPills: document.querySelectorAll('.prompt-pill'),
  goalsContainer: document.getElementById('goals-container'),
  btnCreateGoal: document.getElementById('btn-create-goal'),
  routinesListContainer: document.getElementById('routines-list-container'),
  routineRunsContainer: document.getElementById('routine-runs-container'),
  btnRefreshRoutines: document.getElementById('btn-refresh-routines'),
  memoryItemsList: document.getElementById('memory-items-list'),
  memoryMetaInfo: document.getElementById('memory-meta-info'),
  btnEditMemory: document.getElementById('btn-edit-memory'),
  btnDryRunMemory: document.getElementById('btn-dry-run-memory'),
  btnRunConsolidate: document.getElementById('btn-run-consolidate'),
  btnUndoMemory: document.getElementById('btn-undo-memory'),
  consolidationHistoryList: document.getElementById('consolidation-history-list'),
  sandboxDetails: document.getElementById('sandbox-details-container'),
  ladderContainer: document.getElementById('ladder-rungs-container'),
  btnRefreshSandbox: document.getElementById('btn-refresh-sandbox'),
  mcpServerCount: document.getElementById('mcp-server-count'),
  mcpServersList: document.getElementById('mcp-servers-list'),
  policyDetails: document.getElementById('policy-details-container'),
  grantsList: document.getElementById('grants-list-container'),
  grantsCountBadge: document.getElementById('grants-count-badge'),
  auditTableBody: document.getElementById('audit-table-body'),
  btnReloadPolicy: document.getElementById('btn-reload-policy'),
  btnRefreshAudit: document.getElementById('btn-refresh-audit'),
  artifactsContainer: document.getElementById('artifacts-container'),
  btnRefreshArtifacts: document.getElementById('btn-refresh-artifacts'),
  modalContainer: document.getElementById('modal-container')
};

// ============================================================================
// Markdown 渲染器与安全转义
// ============================================================================
function renderMarkdown(text) {
  if (!text) return '';
  if (window.marked && typeof window.marked.parse === 'function') {
    try {
      return `<div class="markdown-body">${window.marked.parse(text)}</div>`;
    } catch {
      // fallback
    }
  }
  return `<div class="markdown-body" style="white-space: pre-wrap;">${escapeHtml(text)}</div>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// 外观主题管理 (支持浅色 light、深色 dark 与跟随系统 system 响应式自适应)
// ============================================================================
const THEME_STORAGE_KEY = 'museclaw_theme';
const THEME_COLORS = { light: '#ffffff', dark: '#181819' };
let systemThemeMediaQuery = null;

function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function getStoredThemeSetting() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch (e) {
    // 忽略异常
  }
  return 'system';
}

function resolveEffectiveTheme(setting) {
  if (setting === 'system') {
    return getSystemTheme();
  }
  return setting === 'dark' ? 'dark' : 'light';
}

function updateThemeUI(setting, effectiveTheme) {
  const icon = document.getElementById('icon-theme-toggle');
  const label = document.getElementById('label-theme');
  const btn = document.getElementById('btn-theme-toggle');

  if (icon) {
    if (setting === 'light') {
      icon.innerHTML = Icons.sun(18);
    } else if (setting === 'dark') {
      icon.innerHTML = Icons.moon(18);
    } else {
      icon.innerHTML = Icons.monitor(18);
    }
  }

  if (label) {
    if (setting === 'light') {
      label.textContent = '浅色';
    } else if (setting === 'dark') {
      label.textContent = '深色';
    } else {
      label.textContent = '系统';
    }
  }

  if (btn) {
    const sysState = getSystemTheme() === 'dark' ? '深色' : '浅色';
    const desc =
      setting === 'system'
        ? `外观: 跟随系统 (当前系统为${sysState})`
        : setting === 'dark'
          ? '外观: 深色模式'
          : '外观: 浅色模式';
    btn.setAttribute('title', `${desc} · 点击展开外观菜单`);
  }

  // 更新弹出菜单选中项与标记
  const menuItems = document.querySelectorAll('.theme-menu-item');
  menuItems.forEach((item) => {
    const val = item.dataset.themeValue;
    if (val === setting) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  const checkLight = document.getElementById('check-theme-light');
  const checkDark = document.getElementById('check-theme-dark');
  const checkSystem = document.getElementById('check-theme-system');
  if (checkLight) checkLight.innerHTML = setting === 'light' ? Icons.check(14) : '';
  if (checkDark) checkDark.innerHTML = setting === 'dark' ? Icons.check(14) : '';
  if (checkSystem) checkSystem.innerHTML = setting === 'system' ? Icons.check(14) : '';

  const sysStatus = document.getElementById('theme-system-status');
  if (sysStatus) {
    sysStatus.textContent = `当前: ${getSystemTheme() === 'dark' ? '深色' : '浅色'}`;
  }
}

function applyTheme(setting) {
  const currentSetting = setting || getStoredThemeSetting();
  const effectiveTheme = resolveEffectiveTheme(currentSetting);

  document.documentElement.dataset.theme = effectiveTheme;
  document.documentElement.dataset.themeSetting = currentSetting;

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', THEME_COLORS[effectiveTheme]);
  }

  updateThemeUI(currentSetting, effectiveTheme);
}

function setThemeSetting(setting) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, setting);
  } catch (e) {
    // 忽略异常
  }
  applyTheme(setting);
}

function cycleTheme() {
  const current = getStoredThemeSetting();
  const order = ['light', 'dark', 'system'];
  const nextIdx = (order.indexOf(current) + 1) % order.length;
  setThemeSetting(order[nextIdx]);
}

function toggleTheme() {
  cycleTheme();
}

function toggleThemeMenu(forceState) {
  const menu = document.getElementById('theme-menu');
  const btn = document.getElementById('btn-theme-toggle');
  if (!menu) return;

  const isOpen = menu.classList.contains('is-open');
  const shouldOpen = typeof forceState === 'boolean' ? forceState : !isOpen;

  if (shouldOpen) {
    menu.classList.add('is-open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    const currentSetting = getStoredThemeSetting();
    updateThemeUI(currentSetting, resolveEffectiveTheme(currentSetting));
  } else {
    menu.classList.remove('is-open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
}

function initTheme() {
  const currentSetting = getStoredThemeSetting();
  applyTheme(currentSetting);

  // 初始化菜单选项图标
  const iconLight = document.getElementById('icon-theme-light');
  const iconDark = document.getElementById('icon-theme-dark');
  const iconSystem = document.getElementById('icon-theme-system');
  if (iconLight) iconLight.innerHTML = Icons.sun(16);
  if (iconDark) iconDark.innerHTML = Icons.moon(16);
  if (iconSystem) iconSystem.innerHTML = Icons.monitor(16);

  // 绑定主触发按钮点击 (点击轮播切换主题，悬停或唤起菜单直接点选)
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.onclick = (e) => {
      e.stopPropagation();
      cycleTheme();
    };
  }

  // 绑定菜单选项点击 (精准选择浅色、深色或跟随系统)
  const menuItems = document.querySelectorAll('.theme-menu-item');
  menuItems.forEach((item) => {
    item.onclick = (e) => {
      e.stopPropagation();
      const val = item.dataset.themeValue;
      if (val) {
        setThemeSetting(val);
      }
      toggleThemeMenu(false);
    };
  });

  // 点击外部收起菜单
  document.addEventListener('click', (e) => {
    const container = document.getElementById('theme-picker-container');
    if (container && !container.contains(e.target)) {
      toggleThemeMenu(false);
    }
  });

  // ESC 键收起菜单
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleThemeMenu(false);
    }
  });

  // 监听操作系统深浅色设置变更
  if (typeof window !== 'undefined' && window.matchMedia) {
    systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      if (getStoredThemeSetting() === 'system') {
        applyTheme('system');
      }
    };
    if (systemThemeMediaQuery.addEventListener) {
      systemThemeMediaQuery.addEventListener('change', handleSystemChange);
    } else if (systemThemeMediaQuery.addListener) {
      systemThemeMediaQuery.addListener(handleSystemChange);
    }
  }
}

// ============================================================================
// 图标注入初始化
// ============================================================================
function initIcons() {
  document.getElementById('icon-nav-chat').innerHTML = Icons.chat(20);
  document.getElementById('icon-nav-goals').innerHTML = Icons.goals(20);
  document.getElementById('icon-nav-routines').innerHTML = Icons.routines(20);
  document.getElementById('icon-nav-memory').innerHTML = Icons.memory(20);
  document.getElementById('icon-nav-ladder').innerHTML = Icons.ladder(20);
  document.getElementById('icon-nav-audit').innerHTML = Icons.audit(20);
  document.getElementById('icon-nav-artifacts').innerHTML = Icons.artifacts(20);
  const iconNavModel = document.getElementById('icon-nav-model');
  if (iconNavModel) {
    iconNavModel.innerHTML = Icons.cpu ? Icons.cpu(20) : Icons.settings(20);
  }

  const themeToggle = document.getElementById('icon-theme-toggle');
  if (themeToggle) {
    const setting = getStoredThemeSetting();
    if (setting === 'light') {
      themeToggle.innerHTML = Icons.sun(18);
    } else if (setting === 'dark') {
      themeToggle.innerHTML = Icons.moon(18);
    } else {
      themeToggle.innerHTML = Icons.monitor(18);
    }
  }

  document.getElementById('icon-taint-clean').innerHTML = Icons.shield(12);
  document.getElementById('icon-sandbox').innerHTML = Icons.terminal(12);
  document.getElementById('icon-lock').innerHTML = Icons.lock(12);
  document.getElementById('icon-dropdown').innerHTML = Icons.chevronDown(12);
  document.getElementById('icon-send').innerHTML = Icons.arrowUp(16);

  document.getElementById('icon-goals-heading').innerHTML = Icons.goals(22);
  document.getElementById('icon-plus-goal').innerHTML = Icons.plus(14);

  document.getElementById('icon-routines-heading').innerHTML = Icons.routines(22);
  document.getElementById('icon-refresh-routines').innerHTML = Icons.refresh(14);

  document.getElementById('icon-memory-heading').innerHTML = Icons.memory(22);
  document.getElementById('icon-edit-mem').innerHTML = Icons.edit(14);
  document.getElementById('icon-undo').innerHTML = Icons.undo(14);
  document.getElementById('icon-sparkles-dry').innerHTML = Icons.sparkles(14);
  document.getElementById('icon-sparkles-run').innerHTML = Icons.sparkles(14);

  document.getElementById('icon-ladder-heading').innerHTML = Icons.ladder(22);
  document.getElementById('icon-shield-sandbox').innerHTML = Icons.shield(18);
  document.getElementById('icon-refresh').innerHTML = Icons.refresh(14);

  document.getElementById('icon-audit-heading').innerHTML = Icons.audit(22);
  document.getElementById('icon-refresh-policy').innerHTML = Icons.refresh(14);
  document.getElementById('icon-refresh-aud').innerHTML = Icons.refresh(14);

  document.getElementById('icon-artifacts-heading').innerHTML = Icons.artifacts(22);
  document.getElementById('icon-refresh-art').innerHTML = Icons.refresh(14);

  const toggleDrawerIcon = document.getElementById('icon-toggle-drawer');
  if (toggleDrawerIcon) {
    toggleDrawerIcon.innerHTML = Icons.panelLeftClose(16);
  }
}

// ============================================================================
// 二级抽屉与顶栏自适应控制
// ============================================================================
let isDrawerCollapsed = false;

function toggleDrawer() {
  if (!dom.sideDrawer) return;
  isDrawerCollapsed = !isDrawerCollapsed;
  if (isDrawerCollapsed) {
    dom.sideDrawer.classList.add('drawer-collapsed');
    if (dom.iconToggleDrawer) dom.iconToggleDrawer.innerHTML = Icons.panelLeftOpen(16);
  } else {
    dom.sideDrawer.classList.remove('drawer-collapsed');
    if (dom.iconToggleDrawer) dom.iconToggleDrawer.innerHTML = Icons.panelLeftClose(16);
  }
}

function updateDrawerForTab(tabName) {
  if (!dom.sideDrawer) return;

  if (tabName === 'chat') {
    dom.sideDrawer.classList.remove('drawer-hidden');
    if (dom.sessionSection) dom.sessionSection.style.display = 'flex';
    if (dom.drawerTitle) dom.drawerTitle.textContent = '数字员工 (Bots)';
    if (dom.btnToggleDrawer) dom.btnToggleDrawer.style.display = 'inline-flex';
    renderBotList();
  } else if (tabName === 'memory') {
    dom.sideDrawer.classList.remove('drawer-hidden');
    if (dom.sessionSection) dom.sessionSection.style.display = 'none';
    if (dom.drawerTitle) dom.drawerTitle.textContent = '选择数字员工';
    if (dom.btnToggleDrawer) dom.btnToggleDrawer.style.display = 'inline-flex';
    renderBotList();
  } else {
    dom.sideDrawer.classList.add('drawer-hidden');
    if (dom.btnToggleDrawer) dom.btnToggleDrawer.style.display = 'none';
  }
}

function updateTopBarForTab(tabName) {
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  const botName = bot ? bot.name : '';

  if (tabName === 'chat') {
    if (dom.btnBotDetail) dom.btnBotDetail.style.display = 'flex';
    if (dom.taintBadgeContainer) dom.taintBadgeContainer.style.display = 'inline-flex';
    if (dom.sandboxStatusBadge) dom.sandboxStatusBadge.style.display = 'inline-flex';
    if (dom.approvalModeBtn) dom.approvalModeBtn.style.display = 'inline-flex';
    if (dom.globalViewTitleContainer) dom.globalViewTitleContainer.style.display = 'none';
    if (dom.globalTopStatus) dom.globalTopStatus.style.display = 'none';
  } else if (tabName === 'memory') {
    if (dom.btnBotDetail) dom.btnBotDetail.style.display = 'flex';
    if (dom.taintBadgeContainer) dom.taintBadgeContainer.style.display = 'none';
    if (dom.sandboxStatusBadge) dom.sandboxStatusBadge.style.display = 'none';
    if (dom.approvalModeBtn) dom.approvalModeBtn.style.display = 'none';
    if (dom.globalViewTitleContainer) dom.globalViewTitleContainer.style.display = 'none';
    if (dom.globalTopStatus) {
      dom.globalTopStatus.style.display = 'flex';
      if (dom.globalSystemBadge) {
        dom.globalSystemBadge.textContent = `${state.memoryItems.length} 条记忆事实`;
        dom.globalSystemBadge.className = 'pill-badge pill-blue';
      }
    }
    if (dom.memoryActiveBotName) {
      dom.memoryActiveBotName.textContent = botName ? `(${botName})` : '';
    }
  } else {
    if (dom.btnBotDetail) dom.btnBotDetail.style.display = 'none';
    if (dom.taintBadgeContainer) dom.taintBadgeContainer.style.display = 'none';
    if (dom.sandboxStatusBadge) dom.sandboxStatusBadge.style.display = 'none';
    if (dom.approvalModeBtn) dom.approvalModeBtn.style.display = 'none';
    if (dom.globalViewTitleContainer) dom.globalViewTitleContainer.style.display = 'flex';
    if (dom.globalTopStatus) dom.globalTopStatus.style.display = 'flex';

    const config = {
      goals: { icon: '🎯', title: '长周期自驱目标治理', tag: '60s 自驱推进', statusText: '自驱引擎运行中' },
      routines: { icon: '⏰', title: '例行主动巡检与 Webhook', tag: '30s 调度周期', statusText: '主动巡检就绪' },
      skills: { icon: '🪜', title: '技能成本阶梯与微沙箱', tag: 'Rank 1 进程隔离', statusText: '沙箱隔离中' },
      audit: { icon: '🛡️', title: '安全策略与合规审计', tag: 'Sentinel 拦截', statusText: '只追加审计流水' },
      artifacts: { icon: '📦', title: '交付工件与产出物展台', tag: '工件自动归档', statusText: '制品库已挂载' }
    }[tabName] || { icon: '⚡', title: '系统工作台', tag: '在线', statusText: '运行正常' };

    if (dom.globalViewIcon) dom.globalViewIcon.textContent = config.icon;
    if (dom.globalViewTitle) dom.globalViewTitle.textContent = config.title;
    if (dom.globalViewTag) dom.globalViewTag.textContent = config.tag;
    if (dom.globalSystemBadge) {
      dom.globalSystemBadge.textContent = config.statusText;
      dom.globalSystemBadge.className = 'pill-badge pill-green';
    }
  }
}

// ============================================================================
// 视图切换与导航路由 (SPA History & Hash 路由同步与持久化)
// ============================================================================
const VALID_TABS = ['chat', 'goals', 'routines', 'memory', 'skills', 'audit', 'artifacts'];

function getTabFromLocation() {
  const pathPart = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
  if (VALID_TABS.includes(pathPart)) {
    return pathPart;
  }

  const hashPart = window.location.hash.replace(/^#+/, '').trim();
  if (VALID_TABS.includes(hashPart)) {
    return hashPart;
  }

  const savedTab = localStorage.getItem('museclaw_active_tab');
  if (savedTab && VALID_TABS.includes(savedTab)) {
    return savedTab;
  }

  return 'chat';
}

function switchTab(tabName, updateUrl = true) {
  if (!VALID_TABS.includes(tabName)) tabName = 'chat';
  state.currentTab = tabName;
  localStorage.setItem('museclaw_active_tab', tabName);

  if (updateUrl) {
    const targetPath = `/${tabName}`;
    if (window.location.pathname !== targetPath && window.location.pathname !== `${targetPath}/`) {
      window.history.pushState({ tab: tabName }, '', targetPath);
    }
  }

  dom.navItems.forEach((item) => {
    if (item.dataset.tab === tabName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  updateDrawerForTab(tabName);

  Object.entries(dom.views).forEach(([name, el]) => {
    if (!el) return;
    if (name === tabName) {
      el.style.display = name === 'chat' ? 'flex' : 'block';
    } else {
      el.style.display = 'none';
    }
  });

  updateTopBarForTab(tabName);

  if (tabName === 'goals') loadGoals();
  if (tabName === 'routines') loadRoutines();
  if (tabName === 'memory') loadMemory();
  if (tabName === 'skills') loadSandboxStatus();
  if (tabName === 'audit') loadAuditAndPolicy();
  if (tabName === 'artifacts') loadArtifacts();
}

// ============================================================================
// 1. 数字员工 (Bots) 与会话管理模块
// ============================================================================
async function loadBots() {
  try {
    const res = await fetch('/api/bots');
    const data = await res.json();
    state.bots = Array.isArray(data) ? data : (data.bots || []);
    dom.botCountBadge.textContent = `${state.bots.length} 个活跃`;

    if (state.bots.length > 0 && !state.activeBotId) {
      const savedBotId = localStorage.getItem('museclaw_active_bot');
      const candidateBot = state.bots.find((b) => b.id === savedBotId);
      const coordinator = state.bots.find((b) => b.is_coordinator) || state.bots[0];
      const botToSelect = candidateBot || coordinator;
      selectBot(botToSelect.id);
    } else {
      renderBotList();
    }
  } catch (err) {
    console.error('加载 Bots 失败:', err);
  }
}

function renderBotList() {
  dom.botList.innerHTML = '';
  state.bots.forEach((bot) => {
    const card = document.createElement('div');
    card.className = `bot-card ${bot.id === state.activeBotId ? 'active' : ''}`;
    card.onclick = () => {
      selectBot(bot.id);
      if (state.currentTab !== 'chat' && state.currentTab !== 'memory') {
        switchTab('chat');
      }
    };

    const levelBadge = bot.approval_level === 'full' ? 'pill-green' : bot.approval_level === 'auto_edits' ? 'pill-blue' : 'pill-amber';

    card.innerHTML = `
      <div class="bot-avatar">${bot.avatar || '🤖'}</div>
      <div class="bot-info">
        <div class="bot-name">${escapeHtml(bot.name)}</div>
        <div class="bot-desc">${escapeHtml(bot.role || bot.description || '数字员工')}</div>
      </div>
      <span class="pill-badge ${levelBadge}" style="font-size: 9px; padding: 1px 5px;">${bot.approval_level || 'ask'}</span>
    `;
    dom.botList.appendChild(card);
  });
}

async function selectBot(botId) {
  state.activeBotId = botId;
  localStorage.setItem('museclaw_active_bot', botId);
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return;

  renderBotList();
  dom.activeBotAvatar.textContent = bot.avatar || '🤖';
  dom.activeBotName.textContent = bot.name;
  dom.activeBotRole.textContent = bot.role || (bot.is_coordinator ? 'Coordinator' : 'Bot');
  dom.approvalModeText.textContent = `${(bot.approval_level || 'ask').toUpperCase()} 门禁`;

  if (dom.memoryActiveBotName) {
    dom.memoryActiveBotName.textContent = `(${bot.name})`;
  }

  if (state.currentTab === 'memory') {
    await loadMemory();
  }

  // 后台静默加载该 Bot 的会话数据，绝不强制篡改当前页面视图
  pruneEmptySessions();
  await loadSessionsForBot(botId);
}

// 判定指定会话是否为空会话（没有任何对话消息）
function isSessionEmpty(session) {
  if (!session) return true;
  const count = (session.messages && session.messages.length) || session.messageCount || 0;
  return count === 0;
}

// 清理所有非当前、无消息内容的空会话草稿
function pruneEmptySessions(excludeId = null) {
  state.sessions = state.sessions.filter((s) => {
    if (s.id === excludeId) return true;
    return !isSessionEmpty(s);
  });
}

async function loadSessionsForBot(botId) {
  try {
    const res = await fetch(`/api/sessions?bot_id=${encodeURIComponent(botId)}`);
    const sessions = await res.json();
    // 过滤服务端返回的历史空会话
    const validSessions = sessions.filter((s) => !isSessionEmpty(s));
    state.sessions = validSessions;
    renderSessionList();

    if (validSessions.length > 0) {
      const savedSessionId = localStorage.getItem('museclaw_active_session');
      const targetSession = validSessions.find((s) => s.id === savedSessionId) || validSessions[0];
      selectSession(targetSession.id, false);
    } else {
      createNewSession();
    }
  } catch (err) {
    console.error('加载会话失败:', err);
  }
}

function renderSessionList() {
  dom.sessionList.innerHTML = '';
  state.sessions.forEach((s) => {
    const item = document.createElement('div');
    item.className = `session-item ${s.id === state.activeSessionId ? 'active' : ''}`;
    item.onclick = () => selectSession(s.id, true);
    item.innerHTML = `
      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(s.title || '新任务会话')}</span>
      <span style="font-size: 10px; color: var(--text-dim); flex-shrink: 0; margin-left: 6px;">${s.messageCount || 0}条</span>
      <button class="btn-delete-session" title="删除会话" onclick="deleteSession('${s.id}', event)">✕</button>
    `;
    dom.sessionList.appendChild(item);
  });
}

async function selectSession(sessionId, switchToChat = false) {
  // 切换前，如果此前停留在尚未发送任何消息的临时空会话上，自动将其清理移除
  if (state.activeSessionId && state.activeSessionId !== sessionId) {
    const prevSession = state.sessions.find((s) => s.id === state.activeSessionId);
    if (prevSession && isSessionEmpty(prevSession) && state.messages.length === 0) {
      state.sessions = state.sessions.filter((s) => s.id !== prevSession.id);
    }
  }

  state.activeSessionId = sessionId;
  localStorage.setItem('museclaw_active_session', sessionId);
  renderSessionList();

  if (switchToChat && state.currentTab !== 'chat') {
    switchTab('chat');
  }

  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (res.ok) {
      const session = await res.json();
      state.messages = session.messages || [];
      renderChatMessages();
    }
  } catch (err) {
    console.error('加载会话详情失败:', err);
  }
}

function createNewSession() {
  // 1. 如果当前已经处于空会话（无消息），幂等保持当前会话，避免重复产出无用空会话
  const currentSession = state.sessions.find((s) => s.id === state.activeSessionId);
  if (currentSession && isSessionEmpty(currentSession) && state.messages.length === 0) {
    if (dom.composerInput) dom.composerInput.focus();
    return;
  }

  // 2. 清理其他此前遗留的无消息空会话
  pruneEmptySessions();

  // 3. 生成新会话草稿
  const newId = `sess_${state.activeBotId}_${Date.now()}`;
  const newSession = {
    id: newId,
    bot_id: state.activeBotId,
    title: '新任务对话',
    messageCount: 0,
    messages: []
  };
  state.sessions.unshift(newSession);
  state.activeSessionId = newId;
  state.messages = [];
  localStorage.setItem('museclaw_active_session', newId);
  renderSessionList();
  renderChatMessages();
  if (dom.composerInput) dom.composerInput.focus();
}

async function deleteSession(sessionId, event) {
  if (event) event.stopPropagation();
  const ok = await showConfirm({
    title: '删除会话',
    message: '确定要删除该会话记录吗？删除后该会话的消息历史将无法恢复。',
    confirmText: '删除会话',
    dangerous: true
  });
  if (!ok) return;

  try {
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    showToast('会话已成功删除', 'success');
  } catch (e) {
    // 忽略异常
  }

  state.sessions = state.sessions.filter((s) => s.id !== sessionId);

  if (state.activeSessionId === sessionId) {
    if (state.sessions.length > 0) {
      selectSession(state.sessions[0].id, false);
    } else {
      createNewSession();
    }
  } else {
    renderSessionList();
  }
}

// 切换门禁级别并落盘保存至后端 (Approval Mode Selector)
async function cycleApprovalMode() {
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  if (!bot) return;

  const modes = ['ask', 'auto_edits', 'full'];
  const curIdx = modes.indexOf(bot.approval_level || 'ask');
  const nextMode = modes[(curIdx + 1) % modes.length];

  bot.approval_level = nextMode;
  dom.approvalModeText.textContent = `${nextMode.toUpperCase()} 门禁`;
  renderBotList();

  try {
    await fetch(`/api/bots/${encodeURIComponent(bot.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approval_level: nextMode })
    });
  } catch (err) {
    console.error('更新门禁模式失败:', err);
  }
}

// 刷新污点状态徽标 (Taint Tracking Badge)
function updateTaintBadge(isTainted, reason = '') {
  state.isTainted = isTainted;
  if (reason) state.taintReasons.push(reason);

  if (isTainted) {
    dom.taintBadgeContainer.innerHTML = `
      <span class="pill-badge pill-red" title="会话已读取敏感数据 (${reason || state.taintReasons.join(';')})，凡试图进行外网出站或发信一律阻断审批">
        ${Icons.shieldAlert(12)} 污染态 (Tainted)
      </span>
    `;
  } else {
    dom.taintBadgeContainer.innerHTML = `
      <span class="pill-badge pill-green" title="会话未读取内部私有涉密数据，出网策略正常">
        ${Icons.shield(12)} 纯净态 (Untainted)
      </span>
    `;
  }
}

// ============================================================================
// 2. 实时流式对话工作台 (Chat & SSE Streaming & Markdown)
// ============================================================================
function renderChatMessages() {
  dom.chatMessages.innerHTML = '';
  if (state.messages.length === 0) {
    dom.chatMessages.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); margin: auto; padding: 40px;">
        <div style="font-size: 36px; margin-bottom: 12px;">🐾</div>
        <div style="font-size: 16px; font-weight: 600; color: var(--text-muted);">随时为您服务</div>
        <div style="font-size: 13px; margin-top: 6px;">输入指令即可调遣数字员工执行任务、自动分析或沉淀工件</div>
      </div>
    `;
    return;
  }

  state.messages.forEach((msg) => {
    appendMessageBubble(msg.role, msg.content);
  });
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function appendMessageBubble(role, content) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const bot = state.bots.find((b) => b.id === state.activeBotId);
  const avatar = role === 'user' ? '👤' : (bot ? bot.avatar || '🤖' : '🤖');

  const bubbleContent = role === 'user' ? `<div class="message-bubble">${escapeHtml(content || '')}</div>` : `<div class="message-bubble">${renderMarkdown(content || '')}</div>`;

  row.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    ${bubbleContent}
  `;
  dom.chatMessages.appendChild(row);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  return row;
}

// 发送用户指令并开启 SSE 流式接收
async function sendMessage() {
  const text = dom.composerInput.value.trim();
  if (!text || state.isStreaming) return;

  dom.composerInput.value = '';
  state.isStreaming = true;
  dom.btnSendMessage.disabled = true;

  // 1. 添加用户消息气泡
  state.messages.push({ role: 'user', content: text });
  appendMessageBubble('user', text);

  const curSession = state.sessions.find((s) => s.id === state.activeSessionId);
  if (curSession) {
    curSession.messageCount = state.messages.length;
    curSession.messages = state.messages;
    renderSessionList();
  }

  // 2. 创建 Assistant 占位气泡
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  const assistantRow = document.createElement('div');
  assistantRow.className = 'message-row assistant';
  assistantRow.innerHTML = `
    <div class="message-avatar">${bot ? bot.avatar || '🤖' : '🤖'}</div>
    <div class="message-bubble" id="streaming-bubble">
      <div id="plan-steps-container"></div>
      <div id="activity-container"></div>
      <div id="stream-text" style="line-height: 1.6;">
        <div class="agent-thinking-pulse" style="display: flex; align-items: center; gap: 8px; color: var(--om-muted); font-size: 13px; padding: 4px 0;">
          <span style="display: inline-block; width: 14px; height: 14px; border: 2px solid var(--om-border); border-top-color: var(--om-fg); border-radius: 50%; animation: om-spin 0.8s linear infinite;"></span>
          <span>正在连接并调度 Agent 推理执行...</span>
        </div>
      </div>
    </div>
  `;
  dom.chatMessages.appendChild(assistantRow);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

  const streamTextEl = assistantRow.querySelector('#stream-text');
  const activityContainer = assistantRow.querySelector('#activity-container');
  const planContainer = assistantRow.querySelector('#plan-steps-container');

  let fullAssistantText = '';
  let rawAccumulatedText = '';
  let renderedCharCount = 0;
  let typeTimer = null;
  let isStreamFinished = false;

  const removeThinkingPulse = () => {
    const pulse = streamTextEl.querySelector('.agent-thinking-pulse');
    if (pulse) pulse.remove();
  };

  const tickTyping = () => {
    if (renderedCharCount < rawAccumulatedText.length) {
      removeThinkingPulse();
      const remaining = rawAccumulatedText.length - renderedCharCount;
      const step = isStreamFinished
        ? Math.max(1, Math.ceil(remaining / 3))
        : Math.max(1, Math.min(14, Math.ceil(remaining / 5)));
      renderedCharCount += step;
      if (renderedCharCount > rawAccumulatedText.length) {
        renderedCharCount = rawAccumulatedText.length;
      }
      const partial = rawAccumulatedText.slice(0, renderedCharCount);
      streamTextEl.innerHTML = renderMarkdown(partial);
      dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    }

    if (renderedCharCount < rawAccumulatedText.length || !isStreamFinished) {
      typeTimer = setTimeout(tickTyping, 16);
    } else {
      typeTimer = null;
      streamTextEl.innerHTML = renderMarkdown(rawAccumulatedText);
      dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    }
  };

  const pushDeltaText = (delta) => {
    if (!delta) return;
    rawAccumulatedText += delta;
    if (!typeTimer) {
      tickTyping();
    }
  };

  try {
    // 兼容 /api/tasks 和 /api/chat
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: text,
        text,
        message: text,
        session_id: state.activeSessionId,
        bot_id: state.activeBotId,
        user_id: getOrCreateUserId()
      })
    });

    if (!response.ok) {
      throw new Error(`服务响应异常: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const block of lines) {
        const line = block.trim();
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6);
        try {
          const event = JSON.parse(jsonStr);
          handleStreamEvent(event, { streamTextEl, activityContainer, planContainer, assistantRow, pushDeltaText });
          if (event.type === 'stream:text-delta') {
            fullAssistantText += event.text;
          }
        } catch (e) {
          console.warn('解析流式事件错误:', e);
        }
      }
    }

    isStreamFinished = true;
    while (renderedCharCount < rawAccumulatedText.length) {
      renderedCharCount = rawAccumulatedText.length;
      streamTextEl.innerHTML = renderMarkdown(rawAccumulatedText);
    }
    removeThinkingPulse();
    fullAssistantText = rawAccumulatedText;
    state.messages.push({ role: 'assistant', content: fullAssistantText });
    if (curSession) {
      curSession.messageCount = state.messages.length;
      curSession.messages = state.messages;
      renderSessionList();
    }
  } catch (err) {
    removeThinkingPulse();
    streamTextEl.innerHTML += `<div style="color: var(--accent-red); margin-top: 8px;">[通信失败: ${err.message}]</div>`;
  } finally {
    state.isStreaming = false;
    dom.btnSendMessage.disabled = false;
  }
}

// 处理每个流式事件 (SSE Events)
function handleStreamEvent(event, { streamTextEl, activityContainer, planContainer, pushDeltaText }) {
  if (event.type === 'session:init') {
    if (event.sessionId) state.activeSessionId = event.sessionId;
    if (event.title) {
      const cur = state.sessions.find((s) => s.id === state.activeSessionId);
      if (cur) cur.title = event.title;
      renderSessionList();
    }
  }

  if (event.type === 'stream:text-delta') {
    if (typeof pushDeltaText === 'function') {
      pushDeltaText(event.text);
    } else {
      streamTextEl.innerText += event.text;
      dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    }
  }

  // 任务计划清单 (task:plan)
  if (event.type === 'task:plan' && event.steps) {
    planContainer.innerHTML = `
      <div style="background-color: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 8px 12px; margin-bottom: 10px;">
        <div style="font-weight: 600; font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">📋 规划执行步骤:</div>
        ${event.steps.map((s, idx) => `
          <div style="font-size: 12px; margin: 3px 0; display: flex; align-items: center; gap: 6px;">
            <span style="color: ${s.status === 'done' ? 'var(--accent-green)' : 'var(--text-dim)'};">${s.status === 'done' ? '✓' : idx + 1 + '.'}</span>
            <span style="color: ${s.status === 'done' ? 'var(--text-muted)' : 'var(--text-main)'}; text-decoration: ${s.status === 'done' ? 'line-through' : 'none'};">${escapeHtml(s.description)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // 工具调用开始 (tool:call_start)
  if (event.type === 'tool:call_start') {
    const card = document.createElement('div');
    card.className = 'activity-card';
    card.id = `tool-call-${event.toolName}`;
    card.innerHTML = `
      <div class="activity-header">
        <span>⚡ 正在执行工具: <strong>${escapeHtml(event.toolName)}</strong></span>
        <span class="pill-badge pill-blue">调用中...</span>
      </div>
      <div class="activity-content">${escapeHtml(JSON.stringify(event.input, null, 2))}</div>
    `;
    activityContainer.appendChild(card);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  // 工具调用完成 (tool:call_end)
  if (event.type === 'tool:call_end') {
    const existing = activityContainer.querySelector(`#tool-call-${event.toolName}`);
    if (existing) {
      existing.querySelector('.activity-header').innerHTML = `
        <span>⚡ 工具调用完成: <strong>${escapeHtml(event.toolName)}</strong></span>
        <span style="font-size: 11px; color: var(--text-dim);">${event.durationMs || 0}ms</span>
      `;
    }
  }

  // 微沙箱隔离标记 (sandbox:execution)
  if (event.type === 'sandbox:execution') {
    const sbBadge = document.createElement('div');
    sbBadge.style = 'margin: 6px 0; font-size: 11px; color: var(--accent-blue); display: flex; align-items: center; gap: 6px;';
    sbBadge.innerHTML = `
      ${Icons.shield(12)} 
      <span>[Bubblewrap 微沙箱] 隔离执行: ${escapeHtml(event.command?.slice(0, 30))} (网络隔离: ${event.networkBlocked ? '已激活' : '放行'})</span>
    `;
    activityContainer.appendChild(sbBadge);
  }

  // 动态污点打标 (sentinel:taint_updated)
  if (event.type === 'sentinel:taint_updated') {
    updateTaintBadge(event.isTainted, event.reason);
  }

  // Sentinel 门禁审批拦截卡片 (sentinel:approval_needed)
  if (event.type === 'sentinel:approval_needed') {
    renderSentinelApprovalCard(event.request, activityContainer);
  }
}

// 渲染 Sentinel 高危拦截审批卡片 (ApprovalCard)
function renderSentinelApprovalCard(request, container) {
  const card = document.createElement('div');
  card.className = 'approval-card-hazard';
  card.id = `approval-${request.approvalId}`;

  const isTaintedBarrier = request.actionSummary.includes('Taint Egress');
  const isLadderEscalation = request.actionSummary.includes('Channel Ladder');

  card.innerHTML = `
    <div class="approval-card-title">
      ${Icons.shieldAlert(18)}
      <span>${isTaintedBarrier ? '🛡️ 污点外发强力阻断 (Taint Egress Barrier)' : isLadderEscalation ? '🪜 成本阶梯防越级拦截 (Ladder Escalation)' : '⚠️ Sentinel 高危动作审批拦截'}</span>
    </div>
    <div class="approval-card-desc">
      ${escapeHtml(request.actionSummary)}
    </div>
    <div class="approval-details-box">
      <div><strong>审批 ID:</strong> ${request.approvalId}</div>
      ${request.targetDetails?.command ? `<div><strong>目标命令:</strong> ${escapeHtml(request.targetDetails.command)}</div>` : ''}
      ${request.targetDetails?.parameters ? `<div><strong>操作参数:</strong> ${escapeHtml(JSON.stringify(request.targetDetails.parameters))}</div>` : ''}
    </div>
    <div class="approval-actions" id="actions-${request.approvalId}" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      <select id="scope-${request.approvalId}" style="background: var(--bg-primary); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; padding: 4px 8px; font-size: 11px;">
        <option value="once">本次生效 (Once)</option>
        <option value="session">当前会话有效 (Session)</option>
        <option value="24h">24小时有效 (24h)</option>
        <option value="always">永久白名单 (Always)</option>
      </select>
      <button class="btn-reject" onclick="window.resolveApproval('${request.approvalId}', false)">
        ${Icons.x(14)} 拒绝 (Reject)
      </button>
      <button class="btn-approve" onclick="window.resolveApproval('${request.approvalId}', true)">
        ${Icons.check(14)} 批准 (Approve)
      </button>
    </div>
  `;

  container.appendChild(card);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

// 暴露全局解挂审批处理函数
window.resolveApproval = async function (approvalId, approved) {
  const scopeEl = document.getElementById(`scope-${approvalId}`);
  const scope = scopeEl ? scopeEl.value : 'once';
  const actionContainer = document.getElementById(`actions-${approvalId}`);
  if (actionContainer) {
    actionContainer.innerHTML = `<span style="font-size: 12px; color: ${approved ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: 600;">已${approved ? `批准 (${scope})` : '拒绝'}</span>`;
  }

  try {
    await fetch(`/api/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, scope, operator: 'web_user' })
    });
  } catch (err) {
    console.error('处理审批失败:', err);
  }
};

// ============================================================================
// 3. 长周期目标管理 (Goals)
// ============================================================================
async function loadGoals() {
  try {
    const res = await fetch('/api/goals');
    const goals = await res.json();
    state.goals = Array.isArray(goals) ? goals : [];
    renderGoalsGrid();
  } catch (err) {
    console.error('加载 Goals 失败:', err);
  }
}

function renderGoalsGrid() {
  dom.goalsContainer.innerHTML = '';
  if (state.goals.length === 0) {
    dom.goalsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 40px;">
        暂无长周期目标，点击右上角【+ 规划新目标】开始
      </div>
    `;
    return;
  }

  state.goals.forEach((goal) => {
    const card = document.createElement('div');
    card.className = 'goal-card';

    const statusPill = goal.status === 'done' ? 'pill-green' : goal.status === 'in_progress' ? 'pill-blue' : goal.status === 'blocked' ? 'pill-red' : 'pill-amber';

    const stepsHtml = (goal.steps || []).map((step, idx) => {
      const stepIcon = step.status === 'done'
        ? `<span style="color: var(--accent-green);">${Icons.circleCheck(16)}</span>`
        : step.status === 'in_progress'
        ? `<span style="color: var(--accent-blue);">${Icons.circleDashed(16)}</span>`
        : step.status === 'blocked'
        ? `<span style="color: var(--accent-red);">${Icons.circleAlert(16)}</span>`
        : `<span style="color: var(--text-dim);">${Icons.circleCheck(16)}</span>`;

      return `
        <div class="goal-step-item">
          ${stepIcon}
          <div>
            <div style="font-weight: 500; color: ${step.status === 'blocked' ? 'var(--accent-red)' : 'var(--text-main)'};">步骤 ${idx + 1}: ${escapeHtml(step.title)}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(step.description || '')}</div>
          </div>
        </div>
      `;
    }).join('');

    const activeProposal = goal.proposals?.find((p) => p.status === 'pending');
    let proposalHtml = '';
    if (activeProposal) {
      proposalHtml = `
        <div class="proposal-banner">
          <div style="font-size: 12px; font-weight: 600; color: var(--accent-amber); margin-bottom: 4px;">
            ⚠️ Agent 计划修订提案 (Proposal):
          </div>
          <div style="font-size: 12px; color: var(--text-main); margin-bottom: 8px;">
            ${escapeHtml(activeProposal.reason)}
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button class="btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="window.resolveProposal('${goal.id}', '${activeProposal.id}', false)">
              拒绝
            </button>
            <button class="btn-primary" style="padding: 3px 8px; font-size: 11px;" onclick="window.resolveProposal('${goal.id}', '${activeProposal.id}', true)">
              采纳新方案
            </button>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="goal-card-top">
        <div>
          <div class="goal-title">${escapeHtml(goal.title)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(goal.description || '')}</div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="pill-badge ${statusPill}">${goal.status.toUpperCase()}</span>
          <button class="btn-secondary" style="padding: 2px 6px; font-size: 11px; color: var(--accent-red);" title="删除目标" onclick="window.deleteGoal('${goal.id}')">
            ${Icons.trash(12)}
          </button>
        </div>
      </div>

      <div style="font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
        ${Icons.clock(13)} 巡检周期: <strong style="color: var(--text-main);">${escapeHtml(goal.cadence || '单次任务')}</strong>
      </div>

      <div class="goal-steps-timeline">
        ${stepsHtml}
      </div>

      ${proposalHtml}

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
        <span style="font-size: 11px; color: var(--text-dim);">责任 Bot: ${escapeHtml(goal.botId || '')}</span>
        ${goal.status !== 'done' ? `
          <button class="btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="window.advanceGoal('${goal.id}')">
            ${Icons.play(12)} 自驱向前推进
          </button>
        ` : '<span style="font-size: 12px; color: var(--accent-green); font-weight: 600;">已顺利达成</span>'}
      </div>
    `;

    dom.goalsContainer.appendChild(card);
  });
}

window.advanceGoal = async function (goalId) {
  try {
    showToast('已派发自驱目标推进任务，正在自主拆解执行...', 'info');
    await fetch(`/api/goals/${encodeURIComponent(goalId)}/advance`, { method: 'POST' });
    showToast('自驱目标推进任务完成！', 'success');
    loadGoals();
  } catch (err) {
    showToast(`推进失败: ${err.message}`, 'error');
  }
};

window.resolveProposal = async function (goalId, proposalId, accept) {
  try {
    await fetch(`/api/goals/${encodeURIComponent(goalId)}/proposal/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposal_id: proposalId, accept })
    });
    showToast(accept ? '已采纳自驱动态规划提案！' : '已驳回该规划提案', 'info');
    loadGoals();
  } catch (err) {
    showToast(`处理提案失败: ${err.message}`, 'error');
  }
};

window.deleteGoal = async function (goalId) {
  const ok = await showConfirm({
    title: '删除长周期目标',
    message: '确定要删除该长周期自驱目标吗？关联的规划与子任务步骤将一并销毁。',
    confirmText: '删除目标',
    dangerous: true
  });
  if (!ok) return;

  try {
    await fetch(`/api/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' });
    showToast('目标已成功删除', 'success');
    loadGoals();
  } catch (err) {
    showToast(`删除失败: ${err.message}`, 'error');
  }
};

// ============================================================================
// 4. 例行主动巡检与 Webhook 模块 (Routines)
// ============================================================================
async function loadRoutines() {
  try {
    const [routinesRes, runsRes, hooksRes] = await Promise.all([
      fetch('/api/routines'),
      fetch('/api/routines/runs'),
      fetch('/api/hooks')
    ]);
    state.routines = await routinesRes.json();
    state.routineRuns = await runsRes.json();
    state.hooks = await hooksRes.json();

    renderRoutinesList();
    renderRoutineRuns();
  } catch (err) {
    console.error('加载巡检任务失败:', err);
  }
}

function renderRoutinesList() {
  dom.routinesListContainer.innerHTML = '';
  if (!state.routines || state.routines.length === 0) {
    dom.routinesListContainer.innerHTML = '<div style="color: var(--text-dim); padding: 20px;">暂无配置的主动巡检任务</div>';
    return;
  }

  state.routines.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'routine-card';

    const webhookUrl = `${window.location.origin}/api/hooks/${r.id}?token=${r.webhookToken || 'sec_token'}`;

    card.innerHTML = `
      <div class="routine-card-header">
        <div>
          <span style="font-weight: 600; font-size: 14px;">${escapeHtml(r.name)}</span>
          <span class="pill-badge ${r.enabled ? 'pill-green' : 'pill-amber'}" style="margin-left: 8px;">
            ${r.enabled ? '运行中 (Active)' : '已停用 (Paused)'}
          </span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="window.runRoutineNow('${r.id}')">
            ${Icons.play(11)} 立即触发
          </button>
          <button class="btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="window.toggleRoutine('${r.id}')">
            ${r.enabled ? Icons.pause(11) : Icons.play(11)} ${r.enabled ? '停用' : '启用'}
          </button>
        </div>
      </div>

      <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
        ${escapeHtml(r.prompt)}
      </div>

      <div style="display: flex; gap: 16px; font-size: 11px; color: var(--text-dim); border-top: 1px solid var(--border-subtle); padding-top: 8px;">
        <span><strong>定时调度:</strong> <code>${escapeHtml(r.schedule || '手动作业')}</code></span>
        <span><strong>执行 Bot:</strong> <code>${escapeHtml(r.agentId || 'ops_bot')}</code></span>
      </div>

      <div style="background-color: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); color: var(--accent-blue);">
          🔗 ${webhookUrl}
        </span>
        <button class="btn-secondary" style="padding: 2px 6px; font-size: 10px; flex-shrink: 0;" onclick="navigator.clipboard.writeText('${webhookUrl}'); showToast('已复制 Webhook 触发地址！', 'success');">
          ${Icons.copy(10)} 复制
        </button>
      </div>
    `;

    dom.routinesListContainer.appendChild(card);
  });
}

function renderRoutineRuns() {
  dom.routineRunsContainer.innerHTML = '';
  if (!state.routineRuns || state.routineRuns.length === 0) {
    dom.routineRunsContainer.innerHTML = '<div style="color: var(--text-dim); font-size: 12px;">暂无历史巡检记录</div>';
    return;
  }

  state.routineRuns.slice(-8).reverse().forEach((run) => {
    const item = document.createElement('div');
    item.className = 'routine-run-item';

    const isQuiet = run.output?.includes('NOTHING NEW') || run.isQuiet;
    const badge = isQuiet
      ? '<span class="pill-badge pill-blue" style="font-size: 10px;">静默沉淀</span>'
      : run.status === 'success'
      ? '<span class="pill-badge pill-green" style="font-size: 10px;">顺利完成</span>'
      : '<span class="pill-badge pill-red" style="font-size: 10px;">异常</span>';

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <strong style="color: var(--text-main);">${escapeHtml(run.routineName || '自动化作业')}</strong>
        ${badge}
      </div>
      <div style="color: var(--text-dim); font-size: 11px;">
        耗时: ${((run.durationMs || 0) / 1000).toFixed(1)}s | 时间: ${new Date(run.startedAt).toLocaleTimeString()}
      </div>
      <div style="margin-top: 6px; color: var(--text-muted); font-size: 11px; max-height: 40px; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(run.output || '')}
      </div>
    `;

    dom.routineRunsContainer.appendChild(item);
  });
}

window.runRoutineNow = async function (routineId) {
  try {
    await fetch(`/api/routines/${encodeURIComponent(routineId)}/run`, { method: 'POST' });
    showToast('已触发例行任务执行，任务在后台沙箱中自驱运转！', 'success');
    setTimeout(loadRoutines, 1000);
  } catch (err) {
    showToast(`触发失败: ${err.message}`, 'error');
  }
};

window.toggleRoutine = async function (routineId) {
  try {
    await fetch(`/api/routines/${encodeURIComponent(routineId)}/toggle`, { method: 'POST' });
    showToast('例行任务启用状态已更新', 'info');
    loadRoutines();
  } catch (err) {
    showToast(`切换状态失败: ${err.message}`, 'error');
  }
};

// ============================================================================
// 5. 受控长期记忆与整理 (Memory)
// ============================================================================
async function loadMemory() {
  if (!state.activeBotId) return;
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  if (dom.memoryActiveBotName) {
    dom.memoryActiveBotName.textContent = bot ? `(${bot.name})` : '';
  }
  try {
    const [memRes, reportsRes] = await Promise.all([
      fetch(`/api/bots/${encodeURIComponent(state.activeBotId)}/memory`),
      fetch(`/api/bots/${encodeURIComponent(state.activeBotId)}/memory/reports`)
    ]);

    const memData = await memRes.json();
    const reportsData = await reportsRes.json();

    state.memoryText = memData.memory || '';
    state.memoryReports = reportsData.reports || [];

    parseMemoryItems();
    renderMemoryView();
  } catch (err) {
    console.error('加载记忆失败:', err);
  }
}

function parseMemoryItems() {
  const lines = state.memoryText.split('\n').filter((l) => l.trim().startsWith('-'));
  state.memoryItems = lines.map((line, idx) => {
    const isUserAnchor = line.includes('[user]');
    return {
      id: idx + 1,
      raw: line.trim(),
      isUserAnchor
    };
  });
}

function renderMemoryView() {
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  if (dom.memoryActiveBotName) {
    dom.memoryActiveBotName.textContent = bot ? `(${bot.name})` : '';
  }
  dom.memoryMetaInfo.textContent = `${state.memoryItems.length} 条事实 | ${new Blob([state.memoryText]).size} 字节`;
  if (dom.globalSystemBadge && state.currentTab === 'memory') {
    dom.globalSystemBadge.textContent = `${state.memoryItems.length} 条记忆事实`;
    dom.globalSystemBadge.className = 'pill-badge pill-blue';
  }

  dom.memoryItemsList.innerHTML = '';
  if (state.memoryItems.length === 0) {
    dom.memoryItemsList.innerHTML = '<div style="color: var(--text-dim); padding: 20px; text-align: center;">当前 Bot 暂无常驻记忆条目，可点击右上角【编辑记忆】手动写入</div>';
  } else {
    state.memoryItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'memory-item-row';
      row.innerHTML = `
        <div style="flex: 1; font-size: 13px; line-height: 1.5;">${escapeHtml(item.raw)}</div>
        ${item.isUserAnchor ? `
          <span class="pill-badge pill-green" title="用户亲自声明，记忆整理时受物理规则锁定，绝对禁删">
            ${Icons.shield(11)} [user] 锚点保护
          </span>
        ` : `
          <span class="pill-badge pill-blue" style="font-size: 10px;">可合并/去重</span>
        `}
      `;
      dom.memoryItemsList.appendChild(row);
    });
  }

  dom.consolidationHistoryList.innerHTML = '';
  if (state.memoryReports.length === 0) {
    dom.consolidationHistoryList.innerHTML = '<div style="color: var(--om-muted); font-size: 12px; padding: 6px 0;">暂无历史整理记录</div>';
  } else {
    state.memoryReports.slice(0, 5).forEach((r) => {
      const merged = r.merged?.length ?? r.merged_count ?? 0;
      const dropped = r.dropped?.length ?? r.dropped_count ?? 0;
      const skipped = r.skipped?.length ?? r.rejected_count ?? 0;
      const item = document.createElement('div');
      item.className = 'consolidation-history-item';
      item.style = 'padding: 8px 12px; margin-bottom: 6px; background: var(--om-surface-2); border: 1px solid var(--om-border); border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: all 0.15s ease;';
      item.title = '点击查看本次整理报告详情';
      item.innerHTML = `
        <div>
          <div style="font-weight: 550; color: var(--om-fg); margin-bottom: 2px;">
            ${r.dryRun ? '🔍 预检分析' : '⚡ 正式落盘'} · ${new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div style="color: var(--om-muted); font-size: 11px;">
            合并 ${merged} 条 · 清理 ${dropped} 条 · 保护 ${skipped} 条
          </div>
        </div>
        <span style="font-size: 11px; color: var(--om-accent);">${Icons.arrowRight(12) || '→'}</span>
      `;
      item.onclick = () => showConsolidationReportModal(r, r.dryRun);
      dom.consolidationHistoryList.appendChild(item);
    });
  }
}

async function triggerConsolidation(dryRun = false) {
  if (!state.activeBotId) return;
  try {
    showToast(dryRun ? '正在执行受控记忆自整理预检...' : '正在正式执行记忆自整理与落盘...', 'info');
    const res = await fetch(`/api/bots/${encodeURIComponent(state.activeBotId)}/memory/consolidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: dryRun, budget_share: 0.2 })
    });
    const data = await res.json();
    if (data.success) {
      showConsolidationReportModal(data.report, dryRun);
      loadMemory();
    } else {
      showToast(`整理失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`网络错误: ${err.message}`, 'error');
  }
}

async function undoConsolidation() {
  if (!state.activeBotId) return;
  try {
    const res = await fetch(`/api/bots/${encodeURIComponent(state.activeBotId)}/memory/undo`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      showToast('已成功一键无损回滚至上次自整理前的记忆状态！', 'success');
      loadMemory();
    } else {
      showToast(data.message || '没有可撤销的历史备份', 'warning');
    }
  } catch (err) {
    showToast(`撤销失败: ${err.message}`, 'error');
  }
}

function showConsolidationReportModal(report, dryRun) {
  const considered = report.considered ?? 0;
  const mergedCount = report.merged?.length || report.planned?.filter((p) => p.op === 'merge').length || 0;
  const droppedCount = report.dropped?.length || report.planned?.filter((p) => p.op === 'drop').length || 0;
  const skippedCount = report.skipped?.length || 0;

  let planHtml = '';
  const plannedOps = report.planned || [];

  if (plannedOps.length === 0 && skippedCount === 0) {
    planHtml = `
      <div style="text-align: center; padding: 24px; color: var(--om-muted); background: var(--om-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--om-border);">
        <span style="font-size: 28px; display: block; margin-bottom: 6px;">✨</span>
        <strong style="color: var(--om-fg);">长期记忆库处于纯净紧凑态</strong>
        <div style="font-size: 12px; margin-top: 4px;">当前事实条目已高度精炼，无过时碎片或重复事实需要合并。</div>
      </div>
    `;
  } else {
    planHtml = '<div class="consolidation-plan-list">';
    plannedOps.forEach((op) => {
      if (op.op === 'merge') {
        planHtml += `
          <div class="consolidation-plan-item" style="border-left: 3.5px solid var(--om-accent);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span class="pill-badge pill-blue" style="font-size: 10px;">拟合并 (Merge)</span>
              <span style="font-size: 11px; color: var(--om-muted); font-family: var(--font-mono);">${op.ids?.join(', ') || ''}</span>
            </div>
            <div style="font-size: 12px; color: var(--om-muted); margin-bottom: 4px;">
              原事实: ${op.before?.map((b) => `“${escapeHtml(b)}”`).join(' + ')}
            </div>
            <div style="font-size: 12.5px; font-weight: 550; color: var(--om-fg);">
              合并为: “${escapeHtml(op.content || '')}”
            </div>
          </div>
        `;
      } else if (op.op === 'drop') {
        planHtml += `
          <div class="consolidation-plan-item" style="border-left: 3.5px solid var(--accent-amber);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span class="pill-badge pill-amber" style="font-size: 10px;">拟清理 (Drop)</span>
              <span style="font-size: 11px; color: var(--om-muted); font-family: var(--font-mono);">${op.ids?.join(', ') || ''}</span>
            </div>
            <div style="font-size: 12.5px; color: var(--om-fg); margin-bottom: 2px;">
              ${escapeHtml(op.before?.[0] || '')}
            </div>
            <div style="font-size: 11px; color: var(--om-muted);">
              原因: ${escapeHtml(op.reason || '过时碎片')}
            </div>
          </div>
        `;
      }
    });

    if (report.skipped && report.skipped.length > 0) {
      report.skipped.forEach((skip) => {
        planHtml += `
          <div class="consolidation-plan-item" style="border-left: 3.5px solid var(--accent-green);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span class="pill-badge pill-green" style="font-size: 10px;">死线防护未变动 (Protected)</span>
            </div>
            <div style="font-size: 12px; color: var(--om-fg);">
              ${escapeHtml(skip)}
            </div>
          </div>
        `;
      });
    }

    planHtml += '</div>';
  }

  const modalBody = `
    <div style="font-size: 13px; color: var(--om-muted); margin-bottom: 14px; line-height: 1.5;">
      ${dryRun ? '本次为<strong>受控安全预检 (Dry-Run)</strong>，仅在内存中模拟规划事实归约，未真实写入修改底层 MEMORY.md。' : '自整理操作已执行完毕并落盘固化，已建立可撤销备份点。'}
    </div>

    <div class="consolidation-stats-grid">
      <div class="consolidation-stat-card">
        <div class="consolidation-stat-num">${considered}</div>
        <div class="consolidation-stat-label">扫描事实总数</div>
      </div>
      <div class="consolidation-stat-card">
        <div class="consolidation-stat-num" style="color: var(--om-accent);">${mergedCount}</div>
        <div class="consolidation-stat-label">拟合并项</div>
      </div>
      <div class="consolidation-stat-card">
        <div class="consolidation-stat-num" style="color: var(--accent-amber);">${droppedCount}</div>
        <div class="consolidation-stat-label">拟清理碎片</div>
      </div>
      <div class="consolidation-stat-card">
        <div class="consolidation-stat-num" style="color: var(--accent-green);">${skippedCount}</div>
        <div class="consolidation-stat-label">死线防护项</div>
      </div>
    </div>

    <div style="font-size: 12.5px; font-weight: 600; color: var(--om-fg); margin-bottom: 8px;">
      详细规划动作清单:
    </div>
    ${planHtml}

    <div class="modal-footer">
      <button class="btn-secondary" onclick="window.closeModal()">关闭</button>
      ${dryRun ? `<button class="btn-primary" id="btn-modal-execute-consolidate">⚡ 正式执行精炼整理</button>` : `<button class="btn-secondary" id="btn-modal-undo-consolidate">${Icons.undo(12)} 一键撤销</button>`}
    </div>
  `;

  openModal(`长期记忆受控自整理 · ${dryRun ? '预检分析报告' : '执行报告'}`, modalBody, { icon: '🧠' });

  const btnExec = document.getElementById('btn-modal-execute-consolidate');
  if (btnExec) {
    btnExec.onclick = () => {
      closeModal();
      triggerConsolidation(false);
    };
  }

  const btnUndo = document.getElementById('btn-modal-undo-consolidate');
  if (btnUndo) {
    btnUndo.onclick = () => {
      closeModal();
      undoConsolidation();
    };
  }
}

function openEditMemoryModal() {
  openModal(`编辑 ${state.activeBotId} 的长期记忆 (MEMORY.md)`, `
    <div class="form-group">
      <label class="form-label">记忆文本内容（每行一条事实，支持 [user] 永久锚点）:</label>
      <textarea id="modal-memory-text" class="form-control" rows="12" style="font-family: var(--font-mono); font-size: 12px; line-height: 1.5;">${escapeHtml(state.memoryText)}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="window.closeModal()">取消</button>
      <button class="btn-primary" id="btn-save-memory">保存更改</button>
    </div>
  `, { icon: '📝' });

  document.getElementById('btn-save-memory').onclick = async () => {
    const text = document.getElementById('modal-memory-text').value;
    try {
      const res = await fetch(`/api/bots/${encodeURIComponent(state.activeBotId)}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory: text })
      });
      if (res.ok) {
        closeModal();
        showToast('长期记忆内容已保存并落盘！', 'success');
        loadMemory();
      } else {
        const err = await res.json();
        showToast(`保存失败: ${err.error || '超出预算'}`, 'error');
      }
    } catch (err) {
      showToast(`保存失败: ${err.message}`, 'error');
    }
  };
}

// ============================================================================
// 6. 技能成本阶梯、微沙箱与 MCP 模块 (Ladder & Sandbox & MCP)
// ============================================================================
async function loadSandboxStatus() {
  try {
    const [sbRes, mcpRes] = await Promise.all([
      fetch('/api/sandbox/status'),
      fetch('/api/mcp/servers')
    ]);

    const sbData = await sbRes.json();
    state.mcpServers = await mcpRes.json();

    state.sandboxStatus = sbData.microSandbox;
    state.channelLadder = sbData.channelLadder;

    renderSandboxDetails();
    renderLadderRungs();
    renderMcpServers();
  } catch (err) {
    console.error('加载微沙箱状态失败:', err);
  }
}

function renderSandboxDetails() {
  if (!state.sandboxStatus) return;
  const s = state.sandboxStatus;

  dom.sandboxDetails.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
      <div><strong>隔离引擎:</strong> <span class="pill-badge pill-blue">${s.engine.toUpperCase()}</span></div>
      <div><strong>内核版本:</strong> ${s.version || '0.11.1'}</div>
      <div><strong>网络隔离:</strong> <span class="pill-badge ${s.blocksNetwork ? 'pill-green' : 'pill-amber'}">${s.blocksNetwork ? '内核 --unshare-net 生效' : '受限'}</span></div>
      <div><strong>工作目录:</strong> <code style="font-size: 11px;">${s.workspaceDir}</code></div>
    </div>
    <div style="margin-top: 10px; font-size: 12px; color: var(--text-dim);">
      保护状态: ${s.reason}
    </div>
  `;
}

function renderLadderRungs() {
  const rungs = [
    { rung: 1, key: 'api', name: 'Rung 1: API (结构化接口 / 本地数据)', cost: '~$0', latency: '~5ms', desc: '直接调用本地文件读取、数据库或 MCP 工具，零渲染开销，最稳定' },
    { rung: 2, key: 'cli', name: 'Rung 2: CLI (Linux Bubblewrap 微沙箱)', cost: '~$0.001', latency: '~15ms', desc: '在 bwrap 中执行轻量 Shell 脚本，文件系统严格只读，外网默认阻断' },
    { rung: 3, key: 'web', name: 'Rung 3: Web (轻量 HTTP 抓取)', cost: '~$0.005', latency: '~100ms', desc: '静态网页或 REST 接口直接抓取，避免启动笨重的浏览器内核' },
    { rung: 4, key: 'browser', name: 'Rung 4: Browser (无头 Chromium 浏览器)', cost: '~$0.02', latency: '~1200ms', desc: '启动 Chromium 进行 DOM 渲染与复杂单页应用点击' },
    { rung: 5, key: 'gui', name: 'Rung 5: GUI (屏幕视觉 / 模拟触控)', cost: '~$0.10', latency: '~3500ms', desc: '捕获桌面/手机屏幕图像，由多模态大模型推演坐标并模拟触控，开销最高' }
  ];

  dom.ladderContainer.innerHTML = '';
  rungs.forEach((r) => {
    const card = document.createElement('div');
    card.className = `ladder-rung-card rung-${r.rung}`;
    card.innerHTML = `
      <div>
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${r.name}</div>
        <div style="font-size: 12px; color: var(--text-muted);">${r.desc}</div>
      </div>
      <div style="text-align: right; font-family: var(--font-mono); font-size: 12px; flex-shrink: 0; margin-left: 20px;">
        <div style="color: var(--accent-green); font-weight: 600;">成本: ${r.cost}</div>
        <div style="color: var(--text-dim); margin-top: 2px;">延迟: ${r.latency}</div>
      </div>
    `;
    dom.ladderContainer.appendChild(card);
  });
}

function renderMcpServers() {
  dom.mcpServerCount.textContent = `已连接 ${state.mcpServers.length} 个服务`;
  dom.mcpServersList.innerHTML = '';
  if (state.mcpServers.length === 0) {
    dom.mcpServersList.innerHTML = '暂无已挂载的 MCP 工具服务器';
    return;
  }

  state.mcpServers.forEach((srv) => {
    const item = document.createElement('div');
    item.style = 'padding: 8px 12px; background: var(--bg-primary); border-radius: 6px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;';
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(srv.id || srv.name)}</strong>
        <span style="font-size: 11px; color: var(--text-muted); margin-left: 8px;">(${srv.toolsCount || 0} 个可用工具)</span>
      </div>
      <span class="pill-badge pill-green" style="font-size: 10px;">Stdio Connected</span>
    `;
    dom.mcpServersList.appendChild(item);
  });
}

// ============================================================================
// 7. 安全策略与合规审计模块 (Security & Audit)
// ============================================================================
async function loadAuditAndPolicy() {
  try {
    const [policyRes, grantsRes, auditRes] = await Promise.all([
      fetch('/api/policy'),
      fetch('/api/grants'),
      fetch('/api/audit?limit=50')
    ]);

    state.policy = await policyRes.json();
    state.grants = await grantsRes.json();
    state.auditLogs = await auditRes.json();

    renderPolicyView();
    renderGrantsView();
    renderAuditView();
  } catch (err) {
    console.error('加载安全审计失败:', err);
  }
}

function renderPolicyView() {
  dom.policyDetails.innerHTML = `
    <div><strong>版本:</strong> ${state.policy.version || '1.0'}</div>
    <div><strong>全局禁用工具:</strong> ${JSON.stringify(state.policy.deny_tools || [])}</div>
    <div><strong>高危阻断模式:</strong> ${(state.policy.high_risk_patterns || []).slice(0, 5).join(', ')}...</div>
    <div><strong>出网白名单:</strong> ${(state.policy.egress_allowlist || []).join(', ')}</div>
    <div><strong>强制审批工具:</strong> ${(state.policy.always_ask_tools || []).join(', ')}</div>
  `;
}

function renderGrantsView() {
  dom.grantsCountBadge.textContent = `${state.grants.length} 个授权`;
  dom.grantsList.innerHTML = '';
  if (state.grants.length === 0) {
    dom.grantsList.innerHTML = '<div style="color: var(--text-dim); font-size: 12px; padding: 10px;">暂无活跃的复用授权</div>';
    return;
  }

  state.grants.forEach((g) => {
    const item = document.createElement('div');
    item.style = 'background: var(--bg-primary); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; font-size: 12px;';
    item.innerHTML = `
      <div>
        <div><strong>${escapeHtml(g.tool)}</strong> (${escapeHtml(g.target || '*')})</div>
        <div style="font-size: 10px; color: var(--text-dim);">Scope: <code>${g.scope}</code> ${g.sessionId ? `| 会话: ${g.sessionId}` : ''}</div>
      </div>
      <button class="btn-secondary" style="padding: 2px 6px; font-size: 11px; color: var(--accent-red);" onclick="window.revokeGrant('${g.id}')">
        撤销
      </button>
    `;
    dom.grantsList.appendChild(item);
  });
}

function renderAuditView() {
  dom.auditTableBody.innerHTML = '';
  if (state.auditLogs.length === 0) {
    dom.auditTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-dim);">暂无审计事件</td></tr>';
    return;
  }

  state.auditLogs.forEach((log) => {
    const tr = document.createElement('tr');
    tr.style = 'border-bottom: 1px solid var(--border-subtle);';

    const eventBadge = log.event === 'SENTINEL_INTERCEPT'
      ? 'pill-red'
      : log.event === 'APPROVAL_DECISION'
      ? (log.decision === 'approved' ? 'pill-green' : 'pill-red')
      : log.event === 'TAINT_EVENT'
      ? 'pill-amber'
      : 'pill-blue';

    tr.innerHTML = `
      <td style="padding: 8px; font-family: var(--font-mono); color: var(--text-dim);">${new Date(log.ts).toLocaleTimeString()}</td>
      <td style="padding: 8px;"><span class="pill-badge ${eventBadge}">${escapeHtml(log.event)}</span></td>
      <td style="padding: 8px; color: var(--text-main); font-size: 11px;">${escapeHtml(log.botId || '')} / ${escapeHtml(log.sessionId?.slice(0, 16) || '-')}</td>
      <td style="padding: 8px; font-family: var(--font-mono); font-size: 11px;">${escapeHtml(log.tool || '')} ${log.target ? `<code>${escapeHtml(log.target.slice(0, 30))}</code>` : ''}</td>
      <td style="padding: 8px; color: var(--text-muted); font-size: 11px;">${escapeHtml(log.decision || log.details?.reason || JSON.stringify(log.details || {}))}</td>
    `;
    dom.auditTableBody.appendChild(tr);
  });
}

window.revokeGrant = async function (grantId) {
  const ok = await showConfirm({
    title: '撤销临时特权授权',
    message: '确定要立即收回该动态特权授权 (Delegated Grant) 吗？后续未完成的提权操作将被 Sentinel 阻断。',
    confirmText: '确认撤销',
    dangerous: true
  });
  if (!ok) return;

  try {
    await fetch(`/api/grants/${encodeURIComponent(grantId)}/revoke`, { method: 'POST' });
    showToast('该动态授权已被撤销', 'info');
    loadAuditAndPolicy();
  } catch (err) {
    showToast(`撤销失败: ${err.message}`, 'error');
  }
};

// ============================================================================
// 8. 交付工件与产出物展台 (Artifacts)
// ============================================================================
function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadArtifacts() {
  try {
    const res = await fetch('/api/artifacts');
    const files = await res.json();
    state.artifacts = Array.isArray(files) ? files : [];
    if (dom.globalSystemBadge && state.currentTab === 'artifacts') {
      dom.globalSystemBadge.textContent = `${state.artifacts.length} 个交付物`;
      dom.globalSystemBadge.className = 'pill-badge pill-green';
    }
    renderArtifactsGrid();
  } catch (err) {
    console.error('加载工件失败:', err);
  }
}

function renderArtifactsGrid() {
  dom.artifactsContainer.innerHTML = '';
  if (state.artifacts.length === 0) {
    dom.artifactsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--om-muted); padding: 40px;">
        暂无交付产出物。Agent 在执行任务时通过 save_artifact 产出的报告与配置将在这里沉淀。
      </div>
    `;
    return;
  }

  state.artifacts.forEach((art) => {
    const filename = art.filename || art.name || '未命名工件';
    const size = art.sizeBytes ?? art.size ?? 0;
    const sizeText = formatFileSize(size);
    const dateText = art.updatedAt ? new Date(art.updatedAt).toLocaleString() : '';
    const ext = filename.split('.').pop()?.toLowerCase() || 'file';
    const icon = ext === 'md' ? '📝' : ext === 'json' ? '📊' : ext === 'csv' ? '📈' : ext === 'sh' || ext === 'ts' || ext === 'js' ? '💻' : '📄';

    const card = document.createElement('div');
    card.className = 'artifact-card';
    card.onclick = () => previewArtifact(art);
    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 24px;">${icon}</span>
        <span class="pill-badge pill-blue" style="font-size: 10px; text-transform: uppercase;">${escapeHtml(ext)}</span>
      </div>
      <div style="font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--om-fg);" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
      <div style="font-size: 11px; color: var(--om-muted); display: flex; justify-content: space-between; align-items: center;">
        <span>${sizeText}</span>
        <span>${dateText ? dateText.slice(5) : ''}</span>
      </div>
      <div style="font-size: 11.5px; color: var(--om-accent); font-weight: 500; margin-top: 4px;">点击在线预览 / 导出 &rarr;</div>
    `;
    dom.artifactsContainer.appendChild(card);
  });
}

async function previewArtifact(art) {
  const filename = art.filename || art.name || '未命名工件';
  const url = art.url || `/api/artifacts/${encodeURIComponent(filename)}`;

  try {
    const res = await fetch(url);
    const content = await res.text();
    openModal(
      `交付工件预览: ${filename}`,
      `
      <div style="max-height: 480px; overflow-y: auto; background: var(--om-bg); border: 1px solid var(--om-border); border-radius: var(--radius-sm); padding: 16px;">
        ${filename.endsWith('.md') ? renderMarkdown(content) : `<pre style="font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; margin: 0;">${escapeHtml(content)}</pre>`}
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">关闭</button>
        <a href="${url}" download="${filename}" class="btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
          ${Icons.download(13)} 下载工件
        </a>
      </div>
    `,
      { icon: '📄' }
    );
  } catch (err) {
    showToast(`加载工件失败: ${err.message}`, 'error');
  }
}

// ============================================================================
// 全局通用弹窗与通知体系 (Modern Modals, Dialogs, Toast Notifications)
// ============================================================================
let activeModalCloseHandler = null;

function showToast(message, type = 'info', title = '') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const defaultTitles = {
    success: '操作成功',
    error: '执行失败',
    warning: '注意事项',
    info: '系统通知'
  };

  const icons = {
    success: Icons.circleCheck ? Icons.circleCheck(18, '#34c759') : '✓',
    error: Icons.circleAlert ? Icons.circleAlert(18, '#ff3b30') : '✕',
    warning: Icons.circleAlert ? Icons.circleAlert(18, '#ff9500') : '⚠',
    info: Icons.bot ? Icons.bot(18, '#0064d4') : 'ℹ'
  };

  const finalTitle = title || defaultTitles[type] || '提示';

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ'}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(finalTitle)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" title="关闭">&times;</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  const removeToast = () => {
    toast.classList.add('toast-hiding');
    setTimeout(() => {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 200);
  };

  closeBtn.onclick = removeToast;
  container.appendChild(toast);
  setTimeout(removeToast, 3500);
}
window.showToast = showToast;

function showConfirm({
  title = '确认操作',
  message = '请确认是否继续此操作？',
  confirmText = '确定',
  cancelText = '取消',
  dangerous = false,
  icon = ''
}) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (!resolved) {
        resolved = true;
        closeModal();
        resolve(result);
      }
    };

    const defaultIcon = dangerous ? '⚠️' : '❓';
    const iconHtml = icon || defaultIcon;

    openModal(
      title,
      `
      <div class="confirm-dialog-content">
        <div style="display: flex; gap: 14px; align-items: flex-start;">
          <div class="confirm-dialog-icon ${dangerous ? 'danger' : 'info'}">
            ${iconHtml}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 15px; font-weight: 650; color: var(--om-fg); margin-top: 2px;">${escapeHtml(title)}</div>
            <div class="confirm-dialog-message">${escapeHtml(message)}</div>
          </div>
        </div>
        <div class="modal-footer" style="margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--om-border);">
          <button class="btn-secondary" id="btn-confirm-cancel">${escapeHtml(cancelText)}</button>
          <button class="${dangerous ? 'btn-danger' : 'btn-primary'}" id="btn-confirm-ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `,
      {
        hideHeader: true,
        contentClass: 'modal-confirm-sm',
        onClose: () => finish(false)
      }
    );

    const btnOk = document.getElementById('btn-confirm-ok');
    const btnCancel = document.getElementById('btn-confirm-cancel');

    if (btnOk) {
      btnOk.onclick = () => finish(true);
    }

    if (btnCancel) {
      btnCancel.onclick = () => finish(false);
    }
  });
}
window.showConfirm = showConfirm;

function openModal(title, bodyHtml, options = {}) {
  activeModalCloseHandler = options.onClose || null;
  const icon = options.icon ? `<span class="modal-title-icon" style="display: inline-flex; align-items: center; justify-content: center;">${options.icon}</span>` : '';

  const headerHtml = options.hideHeader
    ? ''
    : `
      <div class="modal-header">
        <div class="modal-title-wrap">
          ${icon}
          <h3 class="modal-title">${escapeHtml(title)}</h3>
        </div>
        <button class="modal-close-btn" onclick="window.closeModal()" title="关闭 (Esc)">&times;</button>
      </div>
    `;

  dom.modalContainer.innerHTML = `
    <div class="modal-overlay" id="global-modal-overlay">
      <div class="modal-content ${options.contentClass || ''}" onclick="event.stopPropagation()">
        ${headerHtml}
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>
  `;

  const overlay = document.getElementById('global-modal-overlay');
  if (overlay) {
    overlay.onclick = () => window.closeModal();
  }
}

function closeModal() {
  if (activeModalCloseHandler) {
    const handler = activeModalCloseHandler;
    activeModalCloseHandler = null;
    handler();
  }
  dom.modalContainer.innerHTML = '';
}
window.closeModal = closeModal;

function openBotDetailModal() {
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  if (!bot) return;

  openModal(
    `数字员工配置: ${bot.name}`,
    `
    <div class="form-group">
      <label class="form-label">标识与角色:</label>
      <div style="font-size: 13px; color: var(--text-main);">ID: <code>${bot.id}</code> | 角色: <strong>${escapeHtml(bot.role || '数字员工')}</strong></div>
    </div>
    <div class="form-group">
      <label class="form-label">系统人设 Prompt:</label>
      <textarea id="modal-bot-prompt" class="form-control" rows="6" style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(bot.system_prompt || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">当前门禁级别 (Approval Level):</label>
      <select id="modal-bot-level" class="form-control">
        <option value="ask" ${bot.approval_level === 'ask' ? 'selected' : ''}>ASK (严格模式: 高危全拦截)</option>
        <option value="auto_edits" ${bot.approval_level === 'auto_edits' ? 'selected' : ''}>AUTO_EDITS (免批编辑与工件产出)</option>
        <option value="full" ${bot.approval_level === 'full' ? 'selected' : ''}>FULL (免审批模式，底层破坏与污点外发仍阻断)</option>
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="window.closeModal()">取消</button>
      <button class="btn-primary" id="btn-save-bot">保存配置</button>
    </div>
  `,
    { icon: '🤖' }
  );

  document.getElementById('btn-save-bot').onclick = async () => {
    const system_prompt = document.getElementById('modal-bot-prompt').value;
    const approval_level = document.getElementById('modal-bot-level').value;

    try {
      await fetch(`/api/bots/${encodeURIComponent(bot.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt, approval_level })
      });
      closeModal();
      showToast('数字员工配置已更新并落盘！', 'success');
      loadBots();
    } catch (err) {
      showToast(`保存失败: ${err.message}`, 'error');
    }
  };
}

// ============================================================================
// AI 大模型服务接入中心 (AI Engines & Models Manager)
// ============================================================================
function getProviderIcon(id, size = 20) {
  if (typeof Icons !== 'undefined' && Icons.providerMark) {
    return Icons.providerMark(id, size);
  }
  return '⚡';
}
const getProviderEmoji = getProviderIcon;

async function loadModelsConfig() {
  try {
    const res = await fetch('/api/models/config');
    if (!res.ok) return;
    const data = await res.json();
    state.modelsConfig = data;

    const activeProvider = data.providers?.find((p) => p.id === data.activeProviderId);
    if (activeProvider) {
      if (dom.topModelName) dom.topModelName.textContent = activeProvider.name || activeProvider.id;
      if (dom.topModelIcon) dom.topModelIcon.innerHTML = getProviderIcon(activeProvider.id, 16);
    }
  } catch {
    // 忽略加载异常
  }
}

function getOrCreateUserId() {
  try {
    let uid = localStorage.getItem('museclaw_user_id');
    if (!uid) {
      uid = 'user_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('museclaw_user_id', uid);
    }
    return uid;
  } catch {
    return 'user_default';
  }
}

async function openAddMachineModal() {
  const origin = window.location.origin;
  const currentUserId = getOrCreateUserId();
  const installCmd = `# 1. 配置内网直连代理 (防止内网 IP 被全局代理拦截)
export no_proxy=".bcebos.com,.duckdns.org,.ai-chat.host,.baidu-int.com,10.0.0.0/8,localhost,127.0.0.1\${no_proxy:+,\$no_proxy}"
export NO_PROXY="$no_proxy"

# 2. 一键启动 MuseClaw 本地计算节点伴侣 (自动识别本机 ducc、ducx)
curl -fsSL "${origin}/runner/install.sh?token=${encodeURIComponent(currentUserId)}" | bash`;

  const bodyHtml = `
    <div style="font-size: 13px; color: var(--om-muted); margin-bottom: 14px; line-height: 1.5;">
      在要连接的个人电脑（Mac 或 Linux）终端中，复制并运行以下整组命令。伴侣进程启动后，系统将自动识别并就绪你电脑上的 <code>ducc</code> 与 <code>ducx</code> 等本地 Agent。
    </div>

    <div style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="font-size: 12.5px; font-weight: 650; color: var(--om-fg); display: flex; align-items: center; gap: 6px;">
          <span>💻 个人电脑终端接入命令</span>
          <span style="font-size: 11px; color: var(--om-muted); font-weight: 400;">(免安装依赖 · Node.js 即时运行)</span>
        </div>
        <button type="button" class="btn-secondary" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(installCmd)}')); showToast('已复制接入命令', 'success');" style="padding: 2px 8px; font-size: 11px; cursor: pointer;">
          📋 一键复制整组命令
        </button>
      </div>
      <div style="position: relative; background: var(--om-surface-3); border: 1px solid var(--om-border); border-radius: 8px; padding: 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; word-break: break-all; color: var(--om-fg); white-space: pre-wrap;"><code>${escapeHtml(installCmd)}</code></div>
    </div>

    <div id="add-machine-status-box" style="background: var(--om-surface-2); border: 1px solid var(--om-border); border-radius: 10px; padding: 12px 14px; display: flex; align-items: center; gap: 10px; margin-top: 16px;">
      <span class="loading-spinner" id="add-machine-spinner" style="display: inline-block; width: 14px; height: 14px; border: 2px solid var(--om-border); border-top-color: var(--accent-blue); border-radius: 50%; animation: spin 1s linear infinite;"></span>
      <div style="font-size: 12px; color: var(--om-muted);" id="add-machine-status-text">正在等待个人电脑计算节点连接... (请在终端运行上方命令)</div>
    </div>

    <div class="modal-footer" style="margin-top: 16px;">
      <button class="btn-secondary" onclick="window.closeModal()">完成并返回</button>
    </div>
  `;

  openModal('添加计算节点 · 个人电脑本地 Agent 接入', bodyHtml, { icon: '💻' });

  let isDestroyed = false;
  const pollTimer = setInterval(async () => {
    if (isDestroyed) return;
    try {
      // 1. 优先查询当前用户绑定的专属节点
      let rRes = await fetch(`/api/runner/machines?userId=${encodeURIComponent(currentUserId)}`);
      let rData = await rRes.json();
      let onlineRunners = rData.machines?.filter((m) => m.status === 'online') || [];

      // 2. 兜底查询所有活跃节点
      if (onlineRunners.length === 0) {
        const fallbackRes = await fetch('/api/runner/machines');
        const fallbackData = await fallbackRes.json();
        onlineRunners = fallbackData.machines?.filter((m) => m.status === 'online') || [];
      }

      const statusBox = document.getElementById('add-machine-status-box');
      const statusText = document.getElementById('add-machine-status-text');
      const spinner = document.getElementById('add-machine-spinner');

      if (onlineRunners.length > 0) {
        if (statusBox && statusText) {
          statusBox.style.borderColor = 'var(--accent-green)';
          statusBox.style.background = 'rgba(48, 209, 88, 0.08)';
          if (spinner) spinner.style.display = 'none';
          const latest = onlineRunners[onlineRunners.length - 1];
          const runtimeNames = latest.runtimes?.map((r) => `<b>${escapeHtml(r.id)}</b> (${escapeHtml(r.defaultModel || '已就绪')})`).join(' · ') || '通用计算';
          statusText.innerHTML = `
            <span style="color: var(--accent-green); font-weight: 600;">🎉 个人电脑计算节点已上线: ${escapeHtml(latest.hostname)}</span><br>
            <span style="font-size: 11px; color: var(--om-fg); margin-top: 3px; display: inline-block;">⚡ 已识别本地 Agent: ${runtimeNames}</span><br>
            <span style="font-size: 10.5px; color: var(--om-muted);">节点注册 ID: ${escapeHtml(latest.id)}</span>
          `;
        }
      }
    } catch {}
  }, 1500);

  activeModalCloseHandler = () => {
    isDestroyed = true;
    clearInterval(pollTimer);
    openModelSettingsModal();
  };
}
window._openAddMachineModal = openAddMachineModal;

async function openModelSettingsModal() {
  await loadModelsConfig();
  const data = state.modelsConfig || { activeProviderId: 'deepseek', providers: [] };
  let selectedId = data.activeProviderId || 'deepseek';

  const currentUserId = getOrCreateUserId();
  let machines = [];
  let multica = null;
  try {
    const [mRes, muRes] = await Promise.all([
      fetch(`/api/runner/machines?userId=${encodeURIComponent(currentUserId)}`).then((r) => r.json()).catch(() => ({ machines: [] })),
      fetch('/api/multica/status').then((r) => r.json()).catch(() => ({ ok: false }))
    ]);
    machines = mRes.machines || [];
    multica = muRes.multica || null;
  } catch {}

  const renderModalContent = (currentSelectedId) => {
    selectedId = currentSelectedId;
    const provider = data.providers.find((p) => p.id === selectedId) || data.providers[0] || {
      id: selectedId,
      name: selectedId,
      baseUrl: '',
      model: ''
    };

    const isOllama = selectedId === 'ollama';
    const isLocal = Boolean(provider.isLocalAgent || ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(selectedId));

    const gridHtml = data.providers
      .map((p) => {
        const isActive = p.id === selectedId;
        const isCurrentActive = p.id === data.activeProviderId;
        const isPLocal = Boolean(p.isLocalAgent || ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(p.id));
        const badgeText = isCurrentActive
          ? '● 正在使用'
          : isPLocal
          ? (p.installed ? '💻 本地已就绪' : '未检测到')
          : (p.hasKey ? '已就绪' : '待配置');
        const badgeClass = isCurrentActive
          ? 'configured'
          : isPLocal
          ? (p.installed ? 'configured' : 'unconfigured')
          : (p.hasKey ? 'configured' : 'unconfigured');

        return `
        <div class="model-provider-card ${isActive ? 'active' : ''}" onclick="window._switchModelTab('${p.id}')">
          <div class="model-provider-card-icon">${getProviderIcon(p.id, 28)}</div>
          <div class="model-provider-card-name">${escapeHtml(p.name)}</div>
          <span class="model-provider-card-badge ${badgeClass}">${badgeText}</span>
        </div>
      `;
      })
      .join('');

    const candidateList = (provider.candidateModels && provider.candidateModels.length > 0)
      ? provider.candidateModels
      : [];

    // 默认指定列表第一个模型
    const defaultModel = candidateList.length > 0
      ? (provider.model && candidateList.includes(provider.model) ? provider.model : candidateList[0])
      : (provider.model || '');

    const renderModelSelector = () => {
      if (candidateList.length > 0) {
        return `
          <div style="position: relative;">
            <select id="modal-model-name" class="form-control" style="font-family: var(--font-mono); font-size: 13px; cursor: pointer;">
              ${candidateList.map((m) => `<option value="${escapeHtml(m)}" ${m === defaultModel ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
              <option value="__custom__">+ 手动输入自定义模型代号...</option>
            </select>
            <input id="modal-model-custom-name" class="form-control" placeholder="请输入自定义模型代号" style="display: none; margin-top: 8px; font-family: var(--font-mono); font-size: 12.5px;" />
          </div>
        `;
      }
      return `<input id="modal-model-name" class="form-control" value="${escapeHtml(provider.model || '')}" placeholder="例如: deepseek-chat 或 gpt-4o" style="font-family: var(--font-mono); font-size: 12.5px;" />`;
    };

    const formBodyHtml = isLocal
      ? `
      <div style="background: var(--om-surface-2); border: 1px solid var(--om-border); border-radius: 16px; padding: 18px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
          <div style="font-size: 14.5px; font-weight: 650; color: var(--om-fg); display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-flex; align-items: center;">${getProviderIcon(provider.id, 20)}</span>
            <span>${escapeHtml(provider.name)}</span>
          </div>
          <span class="model-provider-card-badge ${provider.installed ? 'configured' : 'unconfigured'}">
            ${provider.installed ? (provider.executablePath ? '✅ 本地环境就绪' : '🌐 远程计算节点已就绪') : '⚠️ 未检测到此 CLI'}
          </span>
        </div>

        <div style="font-size: 12.5px; color: var(--om-muted); margin-bottom: 14px; line-height: 1.5;">
          ${escapeHtml(provider.description || '')}
        </div>

        <div class="form-group">
          <label class="form-label">程序检测状态 (CLI Path / Mesh Node):</label>
          <div style="font-family: var(--font-mono); font-size: 12px; background: var(--om-surface-3); border: 1px solid var(--om-border); padding: 8px 12px; border-radius: 8px; color: ${provider.executablePath || provider.installed ? 'var(--om-fg)' : 'var(--accent-amber)'}; word-break: break-all;">
            ${provider.executablePath ? `<code>${escapeHtml(provider.executablePath)}</code>` : provider.installed ? '<code>通过远程在线计算节点连接就绪</code>' : '未在服务器或已连接的远程节点中检测到此 CLI'}
          </div>
          ${!provider.installed ? `
          <div style="font-size: 11.5px; color: var(--om-muted); margin-top: 6px;">
            💡 云端部署提示：请在个人电脑终端运行伴侣命令接入，即可自动就绪此 Agent。
            <a href="javascript:void(0)" onclick="window._openAddMachineModal()" style="color: var(--accent-blue); text-decoration: underline; margin-left: 4px;">立即接入个人电脑</a>
          </div>` : ''}
        </div>

        ${provider.version ? `
        <div class="form-group">
          <label class="form-label">探针响应版本 (Probe Version):</label>
          <div style="font-family: var(--font-mono); font-size: 12px; color: var(--accent-green); padding: 2px 4px;">
            <code>${escapeHtml(provider.version)}</code>
          </div>
        </div>` : ''}

        <div class="form-group">
          <label class="form-label">指定模型 (Model ID):</label>
          ${renderModelSelector()}
        </div>

        <input id="modal-model-baseurl" type="hidden" value="${escapeHtml(provider.baseUrl || 'local://' + provider.id)}" />
        <input id="modal-model-apikey" type="hidden" value="" />

        <div id="model-ping-status" style="display: none;" class="model-ping-box"></div>
      </div>
      `
      : `
      <div style="background: var(--om-surface-2); border: 1px solid var(--om-border); border-radius: 16px; padding: 18px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <div style="font-size: 14.5px; font-weight: 650; color: var(--om-fg); display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-flex; align-items: center;">${getProviderIcon(provider.id, 20)}</span>
            <span>${escapeHtml(provider.name)}</span>
          </div>
          ${provider.description ? `<span style="font-size: 11.5px; color: var(--om-muted);">${escapeHtml(provider.description)}</span>` : ''}
        </div>

        <div class="form-group">
          <label class="form-label">API 接入端点 (Base URL):</label>
          <input id="modal-model-baseurl" class="form-control" value="${escapeHtml(provider.baseUrl || '')}" placeholder="例如: https://api.deepseek.com/chat/completions" style="font-family: var(--font-mono); font-size: 12.5px;" />
        </div>

        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label class="form-label" style="margin-bottom: 0;">API 密钥凭证 (API Key):</label>
            ${provider.maskedKey ? `<span style="font-size: 11px; color: var(--accent-green); font-family: var(--font-mono);">当前凭证: ${escapeHtml(provider.maskedKey)}</span>` : ''}
          </div>
          <div style="position: relative;">
            <input id="modal-model-apikey" type="password" class="form-control" placeholder="${provider.hasKey ? '如需更换凭证请输入新 API Key，留空则保持现有' : isOllama ? '本地 Ollama 无需输入 API Key' : '请输入 API 密钥 (例如 sk-...)'}" style="font-family: var(--font-mono); font-size: 12.5px; padding-right: 40px;" />
            <button type="button" id="btn-toggle-key-visibility" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--om-muted); font-size: 14px;" title="查看/隐藏明文">👁️</button>
          </div>
        </div>

        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label class="form-label" style="margin-bottom: 0;">指定模型 (Model ID):</label>
            ${isOllama
              ? `<button type="button" class="btn-secondary" id="btn-probe-ollama" style="padding: 2px 8px; font-size: 11px; cursor: pointer;">🔍 探测本地已下载模型</button>`
              : (!isLocal ? `<button type="button" class="btn-secondary" id="btn-fetch-models" style="padding: 2px 8px; font-size: 11px; cursor: pointer;">🔄 从 API 获取可用模型</button>` : '')}
          </div>
          <div id="model-selector-wrapper">
            ${renderModelSelector()}
          </div>
          <div id="fetch-models-status" style="margin-top: 6px; font-size: 11.5px; display: none;"></div>
          <div id="ollama-probe-result" style="margin-top: 6px; font-size: 11.5px;"></div>
        </div>

        <div id="model-ping-status" style="display: none;" class="model-ping-box"></div>
      </div>
      `;

    const onlineMachines = machines.filter((m) => m.status === 'online');
    const isConnected = onlineMachines.length > 0;

    const bannerTitle = '个人电脑计算节点 (Mesh Runner)';
    const badgeText = isConnected ? `● ${onlineMachines.length} 台在线` : '未连接';
    const badgeClass = isConnected ? 'configured' : 'unconfigured';
    const bannerDesc = isConnected
      ? `已连接: ${onlineMachines.map((m) => `${escapeHtml(m.hostname)} (已就绪: ${m.runtimes?.map((r) => r.id).join(', ') || 'ducc, ducx'})`).join('; ')}`
      : '在个人电脑终端运行单行命令，即可直接在云端调用您本机的 ducc、ducx 等 Agent';

    const runnerBannerHtml = `
      <div style="display: flex; justify-content: space-between; align-items: center; background: var(--om-surface-2); border: 1px solid var(--om-border); border-radius: 12px; padding: 12px 16px; margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 20px;">${isConnected ? '🟢' : '⚡'}</span>
          <div>
            <div style="font-size: 13px; font-weight: 650; color: var(--om-fg); display: flex; align-items: center; gap: 6px;">
              <span>${bannerTitle}</span>
              <span class="model-provider-card-badge ${badgeClass}" style="margin-top: 0;">
                ${badgeText}
              </span>
            </div>
            <div style="font-size: 11.5px; color: var(--om-muted); margin-top: 2px;">
              ${bannerDesc}
            </div>
          </div>
        </div>
        <button type="button" class="btn-secondary" id="btn-add-machine-mesh" style="font-size: 11.5px; padding: 4px 12px; cursor: pointer; white-space: nowrap;">
          ${isConnected ? '⚙️ 管理计算节点' : '➕ 接入个人电脑'}
        </button>
      </div>
    `;

    return `
      <div style="font-size: 13px; color: var(--om-muted); margin-bottom: 14px; line-height: 1.5;">
        配置 MuseClaw 全局大模型与本地 Agent 接入点。支持 DeepSeek、OpenAI、本地 Ollama 以及个人电脑上的 ducc、ducx、Codex 等。
      </div>

      ${runnerBannerHtml}

      <div class="model-providers-grid">
        ${gridHtml}
      </div>

      ${formBodyHtml}

      <div class="modal-footer" style="margin-top: 10px;">
        <button class="btn-secondary" id="btn-test-model">⚡ ${isLocal ? '测试 Agent 响应' : '测试连接 (Ping)'}</button>
        <button class="btn-primary" id="btn-save-model">保存并设为当前服务</button>
      </div>
    `;
  };

  const bindModalEvents = () => {
    const provider = data.providers.find((p) => p.id === selectedId) || data.providers[0];

    const btnAddMachine = document.getElementById('btn-add-machine-mesh');
    if (btnAddMachine) {
      btnAddMachine.onclick = () => openAddMachineModal();
    }

    // 获取当前选中的模型代号 (支持下拉列表与自定义输入)
    const getSelectedModel = () => {
      const selectElem = document.getElementById('modal-model-name');
      const customElem = document.getElementById('modal-model-custom-name');
      if (selectElem && selectElem.tagName === 'SELECT') {
        if (selectElem.value === '__custom__') {
          return (customElem?.value || '').trim();
        }
        return selectElem.value.trim();
      }
      return (selectElem?.value || '').trim();
    };

    // 下拉列表切换自定义输入监听
    const bindModelSelectChange = () => {
      const modelSelect = document.getElementById('modal-model-name');
      const customInput = document.getElementById('modal-model-custom-name');
      if (modelSelect && customInput && modelSelect.tagName === 'SELECT') {
        modelSelect.onchange = () => {
          if (modelSelect.value === '__custom__') {
            customInput.style.display = 'block';
            customInput.focus();
          } else {
            customInput.style.display = 'none';
          }
        };
      }
    };
    bindModelSelectChange();

    // 明文切换
    const btnToggleVis = document.getElementById('btn-toggle-key-visibility');
    const inputKey = document.getElementById('modal-model-apikey');
    if (btnToggleVis && inputKey) {
      btnToggleVis.onclick = () => {
        inputKey.type = inputKey.type === 'password' ? 'text' : 'password';
      };
    }

    // 从 API 动态拉取模型列表 (仅展示该 API 链接真实返回的模型)
    const btnFetchModels = document.getElementById('btn-fetch-models');
    if (btnFetchModels) {
      btnFetchModels.onclick = async () => {
        const baseUrl = (document.getElementById('modal-model-baseurl')?.value || '').trim();
        const apiKey = (document.getElementById('modal-model-apikey')?.value || '').trim();
        const statusDiv = document.getElementById('fetch-models-status');

        if (!baseUrl) {
          return showToast('请先输入 API 接入端点 (Base URL)', 'warning');
        }

        btnFetchModels.disabled = true;
        btnFetchModels.textContent = '正在获取...';
        if (statusDiv) {
          statusDiv.style.display = 'block';
          statusDiv.innerHTML = '<span style="color: var(--om-muted);">正在从 API 链接查询可用模型列表...</span>';
        }

        try {
          const res = await fetch('/api/models/fetch-models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerId: selectedId, baseUrl, apiKey })
          });
          const fetchResult = await res.json();
          if (fetchResult.ok && fetchResult.models?.length > 0) {
            provider.candidateModels = fetchResult.models;
            const wrapper = document.getElementById('model-selector-wrapper');
            if (wrapper) {
              wrapper.innerHTML = `
                <div style="position: relative;">
                  <select id="modal-model-name" class="form-control" style="font-family: var(--font-mono); font-size: 13px; cursor: pointer;">
                    ${fetchResult.models.map((m, idx) => `<option value="${escapeHtml(m)}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
                    <option value="__custom__">+ 手动输入自定义模型代号...</option>
                  </select>
                  <input id="modal-model-custom-name" class="form-control" placeholder="请输入自定义模型代号" style="display: none; margin-top: 8px; font-family: var(--font-mono); font-size: 12.5px;" />
                </div>
              `;
              bindModelSelectChange();
            }
            if (statusDiv) {
              statusDiv.innerHTML = `<span style="color: var(--accent-green);">✅ 从该 API 链接成功获取到 ${fetchResult.models.length} 个可用模型，已填入列表！</span>`;
            }
          } else {
            if (statusDiv) {
              statusDiv.innerHTML = `<span style="color: var(--accent-amber);">⚠️ 未能从 API 获取模型: ${escapeHtml(fetchResult.error || '未查到可用模型')}</span>`;
            }
          }
        } catch (err) {
          if (statusDiv) {
            statusDiv.innerHTML = `<span style="color: var(--accent-red);">❌ 请求失败: ${escapeHtml(err.message)}</span>`;
          }
        } finally {
          btnFetchModels.disabled = false;
          btnFetchModels.textContent = '🔄 从 API 获取可用模型';
        }
      };
    }

    // 本地 Ollama 探针
    const btnProbe = document.getElementById('btn-probe-ollama');
    if (btnProbe) {
      btnProbe.onclick = async () => {
        const baseUrl = document.getElementById('modal-model-baseurl').value;
        const resultContainer = document.getElementById('ollama-probe-result');
        if (resultContainer) resultContainer.innerHTML = '<span style="color: var(--om-muted);">正在扫描本地 Ollama (11434 端口)...</span>';
        try {
          const res = await fetch(`/api/models/ollama/probe?url=${encodeURIComponent(baseUrl)}`);
          const probeData = await res.json();
          if (probeData.ok && probeData.models?.length > 0) {
            provider.candidateModels = probeData.models;
            const wrapper = document.getElementById('model-selector-wrapper');
            if (wrapper) {
              wrapper.innerHTML = `
                <div style="position: relative;">
                  <select id="modal-model-name" class="form-control" style="font-family: var(--font-mono); font-size: 13px; cursor: pointer;">
                    ${probeData.models.map((m, idx) => `<option value="${escapeHtml(m)}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
                    <option value="__custom__">+ 手动输入自定义模型代号...</option>
                  </select>
                  <input id="modal-model-custom-name" class="form-control" placeholder="请输入自定义模型代号" style="display: none; margin-top: 8px; font-family: var(--font-mono); font-size: 12.5px;" />
                </div>
              `;
              bindModelSelectChange();
            }
            resultContainer.innerHTML = `<span style="color: var(--accent-green);">✅ 成功发现 ${probeData.models.length} 个本地已拉取模型，已填入下拉列表！</span>`;
          } else {
            resultContainer.innerHTML = `<span style="color: var(--accent-amber);">⚠️ 未扫描到已拉取的本地模型，请确认本地已执行 ollama run 或 ollama serve</span>`;
          }
        } catch (e) {
          if (resultContainer) resultContainer.innerHTML = `<span style="color: var(--accent-red);">❌ 探测异常: ${escapeHtml(e.message)}</span>`;
        }
      };
    }

    // Ping 测试连接
    const btnTest = document.getElementById('btn-test-model');
    const pingStatus = document.getElementById('model-ping-status');
    const isLocal = Boolean(provider.isLocalAgent || ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(selectedId));

    if (btnTest) {
      btnTest.onclick = async () => {
        const baseUrl = (document.getElementById('modal-model-baseurl')?.value || '').trim();
        const apiKey = (document.getElementById('modal-model-apikey')?.value || '').trim();
        const model = getSelectedModel();

        if (!isLocal && !baseUrl) return showToast('请输入 Base URL', 'warning');
        if (!model) return showToast('请选择或输入模型代号', 'warning');

        btnTest.disabled = true;
        btnTest.textContent = isLocal ? '正在探测 Agent...' : '正在测试连接...';
        if (pingStatus) {
          pingStatus.style.display = 'flex';
          pingStatus.style.borderColor = 'var(--om-border)';
          pingStatus.innerHTML = `<span style="color: var(--om-muted);">${isLocal ? '⚡ 正在执行本地 Agent 握手探测...' : '📡 正在向服务商发送握手测试请求 (Hello Probe)...'}</span>`;
        }

        try {
          const res = await fetch('/api/models/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: selectedId, baseUrl, apiKey, model, isLocalAgent: isLocal })
          });
          const result = await res.json();
          if (result.ok) {
            pingStatus.style.borderColor = 'var(--accent-green)';
            pingStatus.innerHTML = `
              <span style="color: var(--accent-green); font-size: 16px;">🟢</span>
              <div style="color: var(--om-fg); line-height: 1.3;">
                <strong>${isLocal ? '本地 Agent 响应就绪' : '连接成功'} (${result.latencyMs}ms)</strong>
                <div style="font-size: 11.5px; color: var(--om-muted);">${isLocal ? '检测到版本' : '模型响应就绪'}: <code>${escapeHtml(result.model || model)}</code></div>
              </div>
            `;
            if (result.models && result.models.length > 0) {
              provider.candidateModels = result.models;
              const wrapper = document.getElementById('model-selector-wrapper');
              if (wrapper) {
                const currentVal = getSelectedModel();
                const selectedVal = result.models.includes(currentVal) ? currentVal : (result.model || result.models[0]);
                wrapper.innerHTML = `
                  <div style="position: relative;">
                    <select id="modal-model-name" class="form-control" style="font-family: var(--font-mono); font-size: 13px; cursor: pointer;">
                      ${result.models.map((m) => `<option value="${escapeHtml(m)}" ${m === selectedVal ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
                      <option value="__custom__">+ 手动输入自定义模型代号...</option>
                    </select>
                    <input id="modal-model-custom-name" class="form-control" placeholder="请输入自定义模型代号" style="display: none; margin-top: 8px; font-family: var(--font-mono); font-size: 12.5px;" />
                  </div>
                `;
                bindModelSelectChange();
              }
            }
            showToast(`[${provider.name}] ${isLocal ? '本地 Agent 响应就绪' : '连通测试成功'} (${result.latencyMs}ms)！`, 'success');
          } else {
            pingStatus.style.borderColor = 'var(--accent-red)';
            pingStatus.innerHTML = `
              <span style="color: var(--accent-red); font-size: 16px;">🔴</span>
              <div style="color: var(--accent-red); line-height: 1.3;">
                <strong>${isLocal ? 'Agent 探测未就绪' : '连接失败'} (${result.latencyMs}ms)</strong>
                <div style="font-size: 11.5px; word-break: break-all;">${escapeHtml(result.error || '未知错误')}</div>
              </div>
            `;
            showToast(`探测失败: ${result.error}`, 'error');
          }
        } catch (err) {
          if (pingStatus) {
            pingStatus.style.borderColor = 'var(--accent-red)';
            pingStatus.innerHTML = `<span style="color: var(--accent-red);">❌ 请求超时或网络错误: ${escapeHtml(err.message)}</span>`;
          }
        } finally {
          btnTest.disabled = false;
          btnTest.textContent = `⚡ ${isLocal ? '测试 Agent 响应' : '测试连接 (Ping)'}`;
        }
      };
    }

    // 保存并设为当前激活服务
    const btnSave = document.getElementById('btn-save-model');
    if (btnSave) {
      btnSave.onclick = async () => {
        const baseUrl = (document.getElementById('modal-model-baseurl')?.value || '').trim();
        const apiKey = (document.getElementById('modal-model-apikey')?.value || '').trim();
        const model = getSelectedModel();

        if (!isLocal && !baseUrl) return showToast('请输入 Base URL', 'warning');
        if (!model) return showToast('请选择或输入模型代号', 'warning');

        try {
          const res = await fetch('/api/models/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              activeProviderId: selectedId,
              provider: {
                id: selectedId,
                baseUrl,
                apiKey,
                model,
                isLocalAgent: isLocal
              }
            })
          });
          const updateResult = await res.json();
          if (updateResult.success) {
            closeModal();
            showToast(`已成功切换主导 AI 服务为 [${provider.name}] (${model})，实时生效！`, 'success');
            await loadModelsConfig();
          } else {
            showToast(`保存失败: ${updateResult.error}`, 'error');
          }
        } catch (err) {
          showToast(`保存配置失败: ${err.message}`, 'error');
        }
      };
    }
  };

  window._switchModelTab = (newId) => {
    selectedId = newId;
    const bodyElem = document.querySelector('.modal-body');
    if (bodyElem) {
      bodyElem.innerHTML = renderModalContent(newId);
      bindModalEvents();
    }
    const titleIcon = document.querySelector('.modal-title-icon');
    if (titleIcon) {
      titleIcon.innerHTML = getProviderIcon(newId, 20);
    }
  };

  openModal('AI 大模型服务配置中心 (AI Engines)', renderModalContent(selectedId), { icon: getProviderIcon(selectedId, 20) });
  bindModalEvents();
}

// ============================================================================
// 事件绑定与启动入口
// ============================================================================
function initEventHandlers() {
  const brandBtn = document.getElementById('btn-brand');
  if (brandBtn) {
    brandBtn.style.cursor = 'pointer';
    brandBtn.onclick = () => switchTab('chat');
  }

  dom.navItems.forEach((btn) => {
    if (btn.dataset.tab) {
      btn.onclick = () => switchTab(btn.dataset.tab);
    }
  });

  window.addEventListener('popstate', () => {
    const target = getTabFromLocation();
    if (target !== state.currentTab) {
      switchTab(target, false);
    }
  });

  window.addEventListener('hashchange', () => {
    const target = getTabFromLocation();
    if (target !== state.currentTab) {
      switchTab(target, false);
    }
  });

  if (dom.btnToggleDrawer) {
    dom.btnToggleDrawer.onclick = toggleDrawer;
  }

  if (dom.btnModelSettings) {
    dom.btnModelSettings.onclick = openModelSettingsModal;
  }
  if (dom.btnTopModelBadge) {
    dom.btnTopModelBadge.onclick = openModelSettingsModal;
  }

  dom.btnNewSession.onclick = createNewSession;
  dom.approvalModeBtn.onclick = cycleApprovalMode;
  dom.btnBotDetail.onclick = openBotDetailModal;

  dom.btnSendMessage.onclick = sendMessage;
  dom.composerInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  dom.promptPills.forEach((pill) => {
    pill.onclick = () => {
      dom.composerInput.value = pill.dataset.prompt;
      dom.composerInput.focus();
    };
  });

  dom.btnEditMemory.onclick = openEditMemoryModal;
  dom.btnDryRunMemory.onclick = () => triggerConsolidation(true);
  dom.btnRunConsolidate.onclick = () => triggerConsolidation(false);
  dom.btnUndoMemory.onclick = undoConsolidation;

  dom.btnRefreshRoutines.onclick = loadRoutines;
  dom.btnRefreshSandbox.onclick = loadSandboxStatus;
  dom.btnRefreshArtifacts.onclick = loadArtifacts;

  dom.btnReloadPolicy.onclick = async () => {
    try {
      await fetch('/api/policy/reload', { method: 'POST' });
      showToast('已成功重载外部安全策略配置 (sentinel-policy.json)！', 'success');
      loadAuditAndPolicy();
    } catch (err) {
      showToast(`策略重载失败: ${err.message}`, 'error');
    }
  };
  dom.btnRefreshAudit.onclick = loadAuditAndPolicy;

  // 创建新长周期目标模态框
  dom.btnCreateGoal.onclick = () => {
    openModal(
      '规划长周期多步自驱目标',
      `
      <div class="form-group">
        <label class="form-label">目标标题:</label>
        <input id="modal-goal-title" class="form-control" placeholder="例如: 企业前端核心库升级 React 19" />
      </div>
      <div class="form-group">
        <label class="form-label">巡检推进周期 (Cadence):</label>
        <select id="modal-goal-cadence" class="form-control">
          <option value="weekdays 09:30">工作日 09:30 (weekdays 09:30)</option>
          <option value="daily 09:00">每天 09:00 (daily 09:00)</option>
          <option value="weekly mon 10:00">每周一 10:00 (weekly mon 10:00)</option>
          <option value="manual">仅手动推进 (manual)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">责任数字员工 (Bot):</label>
        <select id="modal-goal-bot" class="form-control">
          ${state.bots.map((b) => `<option value="${b.id}">${b.name} (${b.id})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">执行步骤说明:</label>
        <textarea id="modal-goal-steps" class="form-control" rows="4">阶段调研与依赖排查
核心模块适配与功能验证
生产灰度发布与监控巡检</textarea>
        <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">每行一个步骤</div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">取消</button>
        <button class="btn-primary" id="btn-submit-goal">创建目标</button>
      </div>
    `,
      { icon: '🎯' }
    );

    document.getElementById('btn-submit-goal').onclick = async () => {
      const title = document.getElementById('modal-goal-title').value.trim();
      if (!title) return showToast('请输入目标标题', 'warning');
      const cadence = document.getElementById('modal-goal-cadence').value;
      const bot_id = document.getElementById('modal-goal-bot').value;
      const stepsText = document.getElementById('modal-goal-steps').value.trim();
      const steps = stepsText.split('\n').filter(Boolean).map((t) => ({ title: t.trim(), description: t.trim() }));

      try {
        await fetch('/api/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, cadence, bot_id, steps })
        });
        closeModal();
        showToast('长周期多步自驱目标规划成功！', 'success');
        loadGoals();
      } catch (err) {
        showToast(`创建失败: ${err.message}`, 'error');
      }
    };
  };

  // 全局 ESC 键关闭打开的模态窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.modalContainer.innerHTML.trim()) {
      window.closeModal();
    }
  });
}

// 启动入口
initTheme();
initIcons();
initEventHandlers();
const initialTab = getTabFromLocation();
switchTab(initialTab, true);
loadBots();
loadModelsConfig();
