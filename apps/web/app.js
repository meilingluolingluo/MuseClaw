import { Icons } from './icons.js';

// 全局 Fetch 拦截器：统一附加 withCredentials (credentials: 'include')
const originalFetch = window.fetch;
window.fetch = async function(resource, init = {}) {
  const options = { ...init };
  if (!options.credentials) {
    options.credentials = 'include';
  }
  return originalFetch(resource, options);
};

// ============================================================================
// 全局响应式状态模型 (Global State)
// ============================================================================
const state = {
  currentTab: 'chat',
  currentUser: null,
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
  composerAttachments: [],
  modelsConfig: { activeProviderId: 'deepseek', providers: [] },
  isStreaming: false,
  feed: {
    posts: [],
    instructions: '',
    daily: true,
    time: '08:00',
    writing: false,
    activities: []
  }
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
  btnTopUserProfile: document.getElementById('btn-top-user-profile'),
  topUserAvatar: document.getElementById('top-user-avatar'),
  topUserName: document.getElementById('top-user-name'),
  views: {
    chat: document.getElementById('view-chat'),
    feed: document.getElementById('view-feed'),
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
  btnComposerAttach: document.getElementById('btn-composer-attach'),
  composerAttachPopover: document.getElementById('composer-attach-popover'),
  btnPopoverUploadFile: document.getElementById('btn-popover-upload-file'),
  btnPopoverSelectArtifact: document.getElementById('btn-popover-select-artifact'),
  composerFileInput: document.getElementById('composer-file-input'),
  composerAttachmentsBar: document.getElementById('composer-attachments-bar'),
  btnComposerCommands: document.getElementById('btn-composer-commands'),
  composerCommandsPopover: document.getElementById('composer-commands-popover'),
  composerCommandsList: document.getElementById('composer-commands-list'),
  btnComposerClear: document.getElementById('btn-composer-clear'),
  feedPostsContainer: document.getElementById('feed-posts-container'),
  feedActivityContainer: document.getElementById('feed-activity-container'),
  btnFeedSettings: document.getElementById('btn-feed-settings'),
  btnFeedWriteNow: document.getElementById('btn-feed-write-now'),
  btnRefreshFeedActivity: document.getElementById('btn-refresh-feed-activity'),
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
  const iconNavChat = document.getElementById('icon-nav-chat');
  if (iconNavChat) iconNavChat.innerHTML = Icons.chat(20);
  const iconNavFeed = document.getElementById('icon-nav-feed');
  if (iconNavFeed) iconNavFeed.innerHTML = Icons.feed(20);
  const iconNavGoals = document.getElementById('icon-nav-goals');
  if (iconNavGoals) iconNavGoals.innerHTML = Icons.goals(20);
  const iconNavRoutines = document.getElementById('icon-nav-routines');
  if (iconNavRoutines) iconNavRoutines.innerHTML = Icons.routines(20);
  const iconNavMemory = document.getElementById('icon-nav-memory');
  if (iconNavMemory) iconNavMemory.innerHTML = Icons.memory(20);
  const iconNavLadder = document.getElementById('icon-nav-ladder');
  if (iconNavLadder) iconNavLadder.innerHTML = Icons.ladder(20);
  const iconNavAudit = document.getElementById('icon-nav-audit');
  if (iconNavAudit) iconNavAudit.innerHTML = Icons.audit(20);
  const iconNavArtifacts = document.getElementById('icon-nav-artifacts');
  if (iconNavArtifacts) iconNavArtifacts.innerHTML = Icons.artifacts(20);

  const iconFeedHeading = document.getElementById('icon-feed-heading');
  if (iconFeedHeading) iconFeedHeading.innerHTML = Icons.feed(22);
  const iconFeedSettings = document.getElementById('icon-feed-settings');
  if (iconFeedSettings) iconFeedSettings.innerHTML = Icons.sliders(14);
  const iconFeedWrite = document.getElementById('icon-feed-write');
  if (iconFeedWrite) iconFeedWrite.innerHTML = Icons.sparkles(14);
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

  const elAttach = document.getElementById('icon-composer-attach');
  if (elAttach) elAttach.innerHTML = Icons.paperclip(14);
  const elCmds = document.getElementById('icon-composer-commands');
  if (elCmds) elCmds.innerHTML = Icons.command(14);
  const elClear = document.getElementById('icon-composer-clear');
  if (elClear) elClear.innerHTML = Icons.trash(14);
  const elPopUpload = document.getElementById('icon-popover-upload');
  if (elPopUpload) elPopUpload.innerHTML = Icons.upload(16);
  const elPopArt = document.getElementById('icon-popover-artifact');
  if (elPopArt) elPopArt.innerHTML = Icons.artifacts(16);

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
      feed: { icon: '📰', title: '智能体动态 (Feed)', tag: '工作动态与简报', statusText: '实时同步' },
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
const VALID_TABS = ['chat', 'feed', 'goals', 'routines', 'memory', 'skills', 'audit', 'artifacts'];

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

  if (tabName === 'feed') loadFeedData();
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

// ============================================================================
// nanoMuse 虚拟形象渲染引擎与多模态支持
// ============================================================================
function renderBotAvatar(bot, options = {}) {
  const size = options.size || 36;
  const mood = options.mood || 'idle';
  const motion = options.still ? '' : (options.motion || 'avatar-idle');
  const showEditBadge = Boolean(options.showEditBadge);
  const className = options.className || '';

  const avatarVal = (bot?.avatar || '🤖').trim();
  const avatarType = bot?.avatar_type || (
    avatarVal === 'dragon' ? 'dragon' :
    ['haibara', 'moss-courier', 'tide-tinker', 'dusk-moth', 'copper-acorn'].includes(avatarVal) ? 'preset' :
    avatarVal.startsWith('/') || avatarVal.startsWith('http') || avatarVal.startsWith('data:image/') ? 'image' :
    'emoji'
  );

  let innerContent = '';

  if (avatarType === 'dragon') {
    const clipMood = mood === 'working' || mood === 'waiting' || mood === 'happy' ? mood : 'idle';
    const videoUrl = `/avatars/dragon-${clipMood}.mp4`;
    const posterUrl = `/avatars/dragon-${mood === 'error' ? 'error' : clipMood}.webp`;

    if (options.useVideo && size >= 48) {
      innerContent = `<video src="${videoUrl}" poster="${posterUrl}" autoplay loop muted playsinline class="avatar-media"></video>`;
    } else {
      innerContent = `<img src="${posterUrl}" alt="Dragon" draggable="false" class="avatar-media" />`;
    }
  } else if (avatarType === 'preset') {
    const presetId = avatarVal || 'haibara';
    const imgUrl = `/avatars/presets/${presetId}/${mood === 'error' ? 'error' : mood}.webp`;
    innerContent = `<img src="${imgUrl}" alt="${presetId}" draggable="false" class="avatar-media" onerror="this.onerror=null; this.src='/avatars/presets/haibara/idle.webp';" />`;
  } else if (avatarType === 'image') {
    innerContent = `<img src="${avatarVal}" alt="${escapeHtml(bot?.name || '')}" draggable="false" class="avatar-media" />`;
  } else {
    const emoji = bot?.avatar_emoji || (avatarVal.length <= 4 ? avatarVal : '🤖');
    const color = bot?.avatar_color || '#0064d4';
    const bgGradient = `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 65%, #ffffff))`;
    innerContent = `<span class="avatar-emoji-text" style="background: ${bgGradient}; font-size: ${Math.round(size * 0.52)}px;">${emoji}</span>`;
  }

  const editBadgeHtml = showEditBadge
    ? `<div class="avatar-edit-badge" title="更换与定制虚拟形象" id="btn-trigger-avatar-studio">${Icons.edit(14)}</div>`
    : '';

  return `
    <div class="nanomuse-avatar-wrap ${className}" style="width: ${size}px; height: ${size}px;">
      <div class="nanomuse-avatar-circle ${motion}">
        ${innerContent}
      </div>
      ${editBadgeHtml}
    </div>
  `;
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
      <div class="bot-avatar" style="display: flex; align-items: center; justify-content: center;">${renderBotAvatar(bot, { size: 36, still: true })}</div>
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
  dom.activeBotAvatar.innerHTML = renderBotAvatar(bot, { size: 22, still: true });
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
        <div style="display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 18px; background: #ffffff; border: 1px solid var(--om-border); box-shadow: 0 4px 14px rgba(0, 100, 212, 0.1); margin-bottom: 16px;">
          ${Icons.claw ? Icons.claw(28, 'var(--om-accent)') : '<span style="font-size: 26px; color: var(--om-accent);">🐾</span>'}
        </div>
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
  const avatar = role === 'user' ? '<div style="font-size: 20px;">👤</div>' : renderBotAvatar(bot, { size: 36, motion: 'avatar-idle' });

  const bubbleContent = role === 'user' ? `<div class="message-bubble">${escapeHtml(content || '')}</div>` : `<div class="message-bubble">${renderMarkdown(content || '')}</div>`;

  row.innerHTML = `
    <div class="message-avatar" style="display: flex; align-items: center; justify-content: center;">${avatar}</div>
    ${bubbleContent}
  `;
  dom.chatMessages.appendChild(row);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  return row;
}

// ============================================================================
// 对话框工具栏、附件管理与快捷指令
// ============================================================================
function formatComposerFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function renderComposerAttachments() {
  if (!dom.composerAttachmentsBar) return;
  if (!state.composerAttachments || state.composerAttachments.length === 0) {
    dom.composerAttachmentsBar.style.display = 'none';
    dom.composerAttachmentsBar.innerHTML = '';
    return;
  }

  dom.composerAttachmentsBar.style.display = 'flex';
  dom.composerAttachmentsBar.innerHTML = state.composerAttachments.map((att, idx) => {
    const isArtifact = att.type === 'artifact';
    const iconSvg = isArtifact ? Icons.artifacts(14) : Icons.fileText(14);
    const label = escapeHtml(att.name);
    const sub = att.size ? ` (${escapeHtml(att.size)})` : '';
    return `
      <div class="composer-attachment-tag">
        <span class="attachment-tag-icon">${iconSvg}</span>
        <span class="attachment-tag-name" title="${label}">${label}${sub}</span>
        <button type="button" class="attachment-tag-remove" data-index="${idx}" title="移除">
          ${Icons.x(12)}
        </button>
      </div>
    `;
  }).join('');

  dom.composerAttachmentsBar.querySelectorAll('.attachment-tag-remove').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      if (!isNaN(idx)) {
        state.composerAttachments.splice(idx, 1);
        renderComposerAttachments();
      }
    };
  });
}

function clearComposerAttachments() {
  state.composerAttachments = [];
  renderComposerAttachments();
}

function closeAllComposerPopovers() {
  if (dom.composerAttachPopover) dom.composerAttachPopover.style.display = 'none';
  if (dom.composerCommandsPopover) dom.composerCommandsPopover.style.display = 'none';
  if (dom.btnComposerAttach) dom.btnComposerAttach.classList.remove('active');
  if (dom.btnComposerCommands) dom.btnComposerCommands.classList.remove('active');
}

function updateComposerClearButton() {
  if (!dom.btnComposerClear || !dom.composerInput) return;
  if (dom.composerInput.value.length > 0) {
    dom.btnComposerClear.style.display = 'inline-flex';
  } else {
    dom.btnComposerClear.style.display = 'none';
  }
}

async function openArtifactSelectModal() {
  closeAllComposerPopovers();
  if (!state.artifacts || state.artifacts.length === 0) {
    try {
      await loadArtifacts();
    } catch (e) {
      console.warn('加载交付工件失败:', e);
    }
  }

  const artifacts = state.artifacts || [];
  if (artifacts.length === 0) {
    openModal('引用交付工件', `
      <div style="text-align: center; padding: 24px 12px; color: var(--om-muted);">
        <div style="font-size: 32px; margin-bottom: 8px;">📦</div>
        <div style="font-size: 14px; font-weight: 500; color: var(--om-fg); margin-bottom: 4px;">暂无可引用的交付工件</div>
        <div style="font-size: 12px;">当数字员工生成 Markdown 文档、架构图或交付文件后，将自动沉淀在工件库中，供您在此一键引用。</div>
      </div>
    `, { icon: Icons.artifacts(18) });
    return;
  }

  const itemsHtml = artifacts.map((art) => {
    const filename = art.filename || art.name || '未命名工件';
    const ext = filename.split('.').pop()?.toUpperCase() || 'FILE';
    return `
      <div class="composer-artifact-select-item" data-filename="${escapeHtml(filename)}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--om-border); background-color: var(--om-surface); cursor: pointer; transition: all 0.15s ease; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background-color: var(--om-surface-2); color: var(--om-accent);">
            ${Icons.fileText(16)}
          </span>
          <div style="overflow: hidden;">
            <div style="font-size: 13px; font-weight: 600; color: var(--om-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(filename)}</div>
            <div style="font-size: 11px; color: var(--om-muted);">${ext} 格式工件</div>
          </div>
        </div>
        <button type="button" class="btn-secondary" style="padding: 3px 10px; font-size: 12px; flex-shrink: 0;">引用</button>
      </div>
    `;
  }).join('');

  openModal('选择交付工件引入会话', `
    <div style="margin-bottom: 12px; font-size: 12.5px; color: var(--om-muted);">
      选择系统工件库中的文件，将其作为当前会话的上下文知识提供给数字员工。
    </div>
    <div class="composer-artifact-select-list" style="max-height: 360px; overflow-y: auto;">
      ${itemsHtml}
    </div>
  `, { icon: Icons.artifacts(18) });

  const container = dom.modalContainer.querySelector('.composer-artifact-select-list');
  if (container) {
    container.querySelectorAll('.composer-artifact-select-item').forEach((item) => {
      item.onclick = () => {
        const name = item.dataset.filename;
        if (!state.composerAttachments.some((a) => a.type === 'artifact' && a.name === name)) {
          state.composerAttachments.push({ type: 'artifact', name });
          renderComposerAttachments();
          showToast(`已引用工件: ${name}`, 'success');
        } else {
          showToast(`工件 ${name} 已在引用列表中`, 'info');
        }
        closeModal();
      };
    });
  }
}

function showHelpMessage() {
  const helpText = `### 🤖 MuseClaw 数字员工工作台指令系统

您可以通过输入指令或使用快捷方式调遣数字员工：

* **/clear**：清空当前会话界面并新建工作话题
* **/feed**：查看智能体基于近期工作自动总结提炼的每日动态
* **/goals**：管理长期自驱运行任务与阶段里程碑
* **/memory**：查验受控长期记忆与智能体认知偏好
* **/audit**：查看安全拦截事件、审批日志与授权记录
* **/artifacts**：浏览智能体沉淀的代码、架构与交付成果
* **/model**：配置切换 AI 大模型接入服务 (DeepSeek / OpenAI / Ollama 等)

💡 **提示**：对话框左下角支持直接**上传本地文本/代码**或**引用交付工件**作为分析上下文。`;

  state.messages.push({ role: 'assistant', content: helpText });
  appendMessageBubble('assistant', helpText);
}

const COMPOSER_COMMANDS = [
  { name: '/help', desc: '查看常用指令与数字员工能力', action: () => showHelpMessage() },
  { name: '/clear', desc: '清屏并开启全新工作会话', action: () => createNewSession() },
  { name: '/feed', desc: '查看每日动态简报与工作总结', action: () => switchTab('feed') },
  { name: '/goals', desc: '规划与管理自驱长周期目标', action: () => switchTab('goals') },
  { name: '/memory', desc: '查验受控长期记忆库', action: () => switchTab('memory') },
  { name: '/audit', desc: '查看安全合规与操作审计', action: () => switchTab('audit') },
  { name: '/artifacts', desc: '浏览系统沉淀的交付工件', action: () => switchTab('artifacts') },
  { name: '/model', desc: '配置 AI 大模型接入服务', action: () => openModelSettingsModal() }
];

function initComposerControls() {
  if (dom.composerCommandsList) {
    dom.composerCommandsList.innerHTML = COMPOSER_COMMANDS.map((cmd) => {
      return `
        <div class="composer-command-item" data-cmd="${cmd.name}">
          <div class="composer-command-left">
            <span class="composer-command-name">${cmd.name}</span>
            <span class="composer-command-desc">${cmd.desc}</span>
          </div>
          <span class="composer-command-badge">执行</span>
        </div>
      `;
    }).join('');

    dom.composerCommandsList.querySelectorAll('.composer-command-item').forEach((item) => {
      item.onclick = (e) => {
        e.stopPropagation();
        const cmdName = item.dataset.cmd;
        closeAllComposerPopovers();
        const matched = COMPOSER_COMMANDS.find((c) => c.name === cmdName);
        if (matched && matched.action) {
          matched.action();
        }
      };
    });
  }

  if (dom.btnComposerAttach) {
    dom.btnComposerAttach.onclick = (e) => {
      e.stopPropagation();
      const isOpen = dom.composerAttachPopover.style.display !== 'none';
      closeAllComposerPopovers();
      if (!isOpen) {
        dom.composerAttachPopover.style.display = 'flex';
        dom.btnComposerAttach.classList.add('active');
      }
    };
  }

  if (dom.btnPopoverUploadFile && dom.composerFileInput) {
    dom.btnPopoverUploadFile.onclick = (e) => {
      e.stopPropagation();
      closeAllComposerPopovers();
      dom.composerFileInput.click();
    };
  }

  if (dom.composerFileInput) {
    dom.composerFileInput.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const content = evt.target?.result || '';
          state.composerAttachments.push({
            type: 'file',
            name: file.name,
            size: formatComposerFileSize(file.size),
            content: typeof content === 'string' ? content : ''
          });
          renderComposerAttachments();
        };
        reader.readAsText(file);
      });

      e.target.value = '';
    };
  }

  if (dom.btnPopoverSelectArtifact) {
    dom.btnPopoverSelectArtifact.onclick = (e) => {
      e.stopPropagation();
      openArtifactSelectModal();
    };
  }

  if (dom.btnComposerCommands) {
    dom.btnComposerCommands.onclick = (e) => {
      e.stopPropagation();
      const isOpen = dom.composerCommandsPopover.style.display !== 'none';
      closeAllComposerPopovers();
      if (!isOpen) {
        dom.composerCommandsPopover.style.display = 'flex';
        dom.btnComposerCommands.classList.add('active');
      }
    };
  }

  if (dom.btnComposerClear) {
    dom.btnComposerClear.onclick = () => {
      dom.composerInput.value = '';
      dom.composerInput.style.height = 'auto';
      updateComposerClearButton();
      closeAllComposerPopovers();
      dom.composerInput.focus();
    };
  }

  if (dom.composerInput) {
    dom.composerInput.oninput = () => {
      updateComposerClearButton();
      dom.composerInput.style.height = 'auto';
      dom.composerInput.style.height = Math.min(dom.composerInput.scrollHeight, 160) + 'px';

      const val = dom.composerInput.value.trim();
      if (val === '/') {
        dom.composerCommandsPopover.style.display = 'flex';
        if (dom.btnComposerCommands) dom.btnComposerCommands.classList.add('active');
      }
    };
  }

  document.addEventListener('click', (e) => {
    if (
      !e.target.closest('#composer-attach-popover') &&
      !e.target.closest('#btn-composer-attach') &&
      !e.target.closest('#composer-commands-popover') &&
      !e.target.closest('#btn-composer-commands')
    ) {
      closeAllComposerPopovers();
    }
  });
}

// 发送用户指令并开启 SSE 流式接收
async function sendMessage() {
  if (!state.currentUser) {
    showToast('请先登录或注册账号后再发送指令', 'info');
    openAuthModal('login');
    return;
  }

  const rawText = dom.composerInput.value.trim();
  const hasAttachments = state.composerAttachments && state.composerAttachments.length > 0;
  if ((!rawText && !hasAttachments) || state.isStreaming) return;

  let displayText = rawText;
  let effectivePrompt = rawText;

  if (hasAttachments) {
    const attachTags = state.composerAttachments.map((att) => {
      return att.type === 'artifact' ? `[工件: ${att.name}]` : `[文件: ${att.name}]`;
    }).join(' ');

    displayText = displayText ? `${attachTags}\n${displayText}` : attachTags;

    const attachBlocks = state.composerAttachments.map((att) => {
      if (att.type === 'artifact') {
        return `【引用交付工件: ${att.name}】`;
      }
      return `【附加本地文件: ${att.name}${att.size ? ` (${att.size})` : ''}】\n\`\`\`\n${att.content || ''}\n\`\`\``;
    }).join('\n\n');

    effectivePrompt = effectivePrompt ? `${attachBlocks}\n\n${effectivePrompt}` : attachBlocks;
  }

  dom.composerInput.value = '';
  dom.composerInput.style.height = 'auto';
  clearComposerAttachments();
  updateComposerClearButton();
  closeAllComposerPopovers();

  state.isStreaming = true;
  dom.btnSendMessage.disabled = true;

  // 1. 添加用户消息气泡
  state.messages.push({ role: 'user', content: displayText });
  appendMessageBubble('user', displayText);

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
    <div class="message-avatar" style="display: flex; align-items: center; justify-content: center;">${bot ? renderBotAvatar(bot, { size: 36, motion: 'avatar-working', mood: 'working', useVideo: true }) : '🤖'}</div>
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
        ? Math.max(1, Math.min(8, Math.ceil(remaining / 6)))
        : Math.max(1, Math.min(4, Math.ceil(remaining / 4)));
      renderedCharCount += step;
      if (renderedCharCount > rawAccumulatedText.length) {
        renderedCharCount = rawAccumulatedText.length;
      }
      const partial = rawAccumulatedText.slice(0, renderedCharCount);
      streamTextEl.innerHTML = renderMarkdown(partial);
      dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    }

    if (renderedCharCount < rawAccumulatedText.length) {
      typeTimer = setTimeout(tickTyping, 16);
    } else {
      typeTimer = null;
      if (isStreamFinished) {
        removeThinkingPulse();
        streamTextEl.innerHTML = renderMarkdown(rawAccumulatedText);
        dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
      }
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
        prompt: effectivePrompt,
        text: effectivePrompt,
        message: effectivePrompt,
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
    if (!typeTimer && renderedCharCount < rawAccumulatedText.length) {
      tickTyping();
    }
    while (renderedCharCount < rawAccumulatedText.length) {
      await new Promise((r) => setTimeout(r, 20));
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
// 2.5 智能体动态与工作简报 (Feed)
// ============================================================================
const AREA_EMOJIS = {
  planning: '🗓️',
  research: '🔍',
  goals: '🎯',
  money: '💰',
  health: '🌿',
  home: '🏠',
  learning: '📚',
  people: '👥',
  files: '📄',
  fun: '🎈'
};

const AREA_LABELS = {
  planning: '规划调研',
  research: '深度研究',
  goals: '目标自驱',
  money: '财务预算',
  health: '健康活力',
  home: '生活日常',
  learning: '技能学习',
  people: '人际协作',
  files: '文档工件',
  fun: '休闲娱乐'
};

const INTRO_ACK_KEY = 'museclaw_feed_intro_ack';

function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  const now = Date.now();
  const t = new Date(isoStr).getTime();
  if (isNaN(t)) return '';
  const diffSec = Math.floor((now - t) / 1000);
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
  return new Date(isoStr).toLocaleDateString();
}

function todayDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function groupPostsByDay(posts) {
  const map = new Map();
  for (const p of posts) {
    const d = new Date(p.ts || Date.now());
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return [...map.entries()];
}

function getFeedDayLabel(dateKey, at) {
  const today = todayDateKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = todayDateKey(yesterday);
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[at.getDay()];

  if (dateKey === today) {
    const hour = new Date().getHours();
    const part = hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上';
    return `${weekday} ${part} · 今天`;
  }
  if (dateKey === yKey) {
    return `${weekday} · 昨天`;
  }
  return `${weekday} · ${at.getMonth() + 1}月${at.getDate()}日`;
}

async function loadFeedData() {
  await Promise.allSettled([loadFeedPosts(), loadFeedActivity()]);
}

async function loadFeedPosts() {
  try {
    const res = await fetch('/api/feed/posts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.feed.posts = Array.isArray(data.posts) ? data.posts : [];
    state.feed.instructions = data.instructions || '';
    state.feed.daily = data.daily !== false;
    state.feed.time = data.time || '08:00';
    renderFeedPosts();
  } catch (err) {
    console.error('加载 Feed 动态失败:', err);
    if (dom.feedPostsContainer) {
      dom.feedPostsContainer.innerHTML = `
        <div class="feed-card" style="padding: 24px; text-align: center; color: var(--om-muted);">
          加载动态失败: ${escapeHtml(err.message)}
          <div style="margin-top: 10px;"><button class="btn-secondary" onclick="window.loadFeedData()">重试</button></div>
        </div>
      `;
    }
  }
}
window.loadFeedData = loadFeedData;

async function loadFeedActivity() {
  try {
    const res = await fetch('/api/feed/activity?limit=40');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.feed.activities = Array.isArray(data) ? data : (data.items || []);
    renderFeedActivity();
  } catch (err) {
    console.error('加载离开时动态失败:', err);
  }
}

function renderFeedPosts() {
  if (!dom.feedPostsContainer) return;
  const posts = state.feed.posts;
  const groups = groupPostsByDay(posts);
  const introAcked = localStorage.getItem(INTRO_ACK_KEY) === '1';

  let html = '';

  if (!introAcked) {
    const steeringText = state.feed.instructions || '给我做一个关于我关心的事的动态。短一点、直接一点，扫一眼就能看完，别搞标题党。';
    html += `
      <div class="feed-card feed-intro-card" id="feed-intro-banner">
        <div class="feed-intro-header">
          <div class="feed-intro-title">📰 关于智能体动态 (Feed)</div>
          <p class="feed-intro-sub">
            智能体根据它记录的关于您的记忆事实、最近对话重点与自驱目标，提炼生成的短篇简报。下方的引导指令将直接决定未来每一篇动态的侧重点，您可以随时修改。
          </p>
        </div>
        <div class="feed-intro-body">
          <p class="feed-intro-text">“${escapeHtml(steeringText)}”</p>
          <div class="feed-intro-footer">
            <button class="btn-secondary" id="btn-edit-feed-intro" style="border-radius: 9999px; padding: 6px 16px; font-size: 13.5px;">✏️ 修改偏好指令</button>
            <button class="btn-primary" id="btn-ack-feed-intro" style="border-radius: 9999px; padding: 6px 18px; font-size: 13.5px;">我知道了</button>
          </div>
        </div>
      </div>
    `;
  }

  if (state.feed.writing) {
    html += `
      <div class="feed-card feed-loading-box">
        <span class="om-spinner" style="display: inline-block; width: 18px; height: 18px; border: 2px solid var(--om-border); border-top-color: var(--om-accent); border-radius: 50%; animation: om-spin 0.8s linear infinite;"></span>
        <span>智能体正在为您提炼记忆与目标，撰写最新动态…</span>
      </div>
    `;
  }

  if (groups.length === 0 && !state.feed.writing) {
    html += `
      <div class="feed-day-title">${getFeedDayLabel(todayDateKey(), new Date())}</div>
      <div class="feed-card" style="padding: 24px 20px;">
        <div style="display: flex; gap: 14px; align-items: flex-start;">
          <div class="feed-area-badge">🖼️</div>
          <div style="flex: 1;">
            <div style="font-size: 16px; font-weight: 600; color: var(--om-fg); margin-bottom: 6px;">暂无动态内容</div>
            <div style="font-size: 14px; color: var(--om-muted); line-height: 1.6;">
              每天在预设时间（${escapeHtml(state.feed.time || '08:00')}），智能体会阅读关于您的记忆事实、近期对话与目标，为您量身定制几条短小精悍的动态。
            </div>
          </div>
        </div>
      </div>

      <div class="feed-card" style="padding: 24px 20px;">
        <div style="display: flex; gap: 14px; align-items: flex-start;">
          <div class="feed-area-badge">📝</div>
          <div style="flex: 1;">
            <div style="font-size: 16px; font-weight: 600; color: var(--om-fg); margin-bottom: 6px;">用一句话引导它</div>
            <div style="font-size: 14px; color: var(--om-muted); line-height: 1.6;">
              点击右上角「偏好设置」可以告诉智能体您更希望看到哪些领域，或者立刻点击下方按钮生成第一期动态。
            </div>
            <div style="margin-top: 14px;">
              <button class="btn-primary" id="btn-feed-empty-write" style="border-radius: 9999px; padding: 8px 20px; font-size: 14px; font-weight: 600;">
                ✨ 立即撰写动态
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    for (const [dayKey, dayPosts] of groups) {
      const firstDate = new Date(dayPosts[0]?.ts || Date.now());
      html += `<div class="feed-day-title">${getFeedDayLabel(dayKey, firstDate)}</div>`;
      for (const p of dayPosts) {
        const emoji = AREA_EMOJIS[p.area] || '📝';
        const areaLabel = AREA_LABELS[p.area] || '工作简报';
        html += `
          <div class="feed-card feed-post-card" data-post-id="${escapeHtml(p.id)}">
            <div class="feed-post-top">
              <div class="feed-area-badge" title="${escapeHtml(areaLabel)}">${emoji}</div>
              <div class="feed-post-content">
                <div class="feed-post-title">${escapeHtml(p.title)}</div>
                <div class="feed-post-body">${renderMarkdown(p.body)}</div>
              </div>
            </div>
            <div class="feed-post-actions">
              <button class="feed-action-btn" onclick="window._discussFeedPost('${escapeHtml(p.id)}')">
                ${Icons.messageCircle(16)} 展开讨论
              </button>
              <button class="feed-action-btn" onclick="window._openFeedPostInfo('${escapeHtml(p.id)}')">
                ${Icons.info(16)} 详情与操作
              </button>
            </div>
          </div>
        `;
      }
    }
  }

  dom.feedPostsContainer.innerHTML = html;

  const btnAck = document.getElementById('btn-ack-feed-intro');
  if (btnAck) {
    btnAck.onclick = () => {
      localStorage.setItem(INTRO_ACK_KEY, '1');
      renderFeedPosts();
    };
  }
  const btnEditIntro = document.getElementById('btn-edit-feed-intro');
  if (btnEditIntro) {
    btnEditIntro.onclick = () => openFeedSettingsModal();
  }
  const btnEmptyWrite = document.getElementById('btn-feed-empty-write');
  if (btnEmptyWrite) {
    btnEmptyWrite.onclick = () => writeFeedNow();
  }
}

function renderFeedActivity() {
  if (!dom.feedActivityContainer) return;
  const items = state.feed.activities;
  if (!items || items.length === 0) {
    dom.feedActivityContainer.innerHTML = `
      <div style="padding: 18px 12px; color: var(--om-muted); font-size: 13px; text-align: center;">
        暂无离开时的后台推进记录。后台无人值守推进目标或产生工件时将在此处留痕。
      </div>
    `;
    return;
  }

  let html = '';
  for (const it of items) {
    let icon = Icons.sparkles(16);
    if (it.kind === 'artifact') icon = Icons.fileText(16);
    else if (it.kind === 'approval') icon = Icons.shieldAlert(16);
    else if (it.kind === 'question') icon = Icons.messageCircle(16);
    else if (it.quiet) icon = Icons.moon(16);

    const relTime = formatRelativeTime(it.ts);

    html += `
      <div class="feed-activity-row" onclick="window._openFeedActivityItem('${escapeHtml(it.id)}')">
        <div class="feed-activity-icon">${icon}</div>
        <div class="feed-activity-body">
          <div class="feed-activity-title-bar">
            <span class="feed-activity-title">${escapeHtml(it.title || '后台推进事件')}</span>
            <span class="feed-activity-time">${relTime}</span>
          </div>
          ${it.text ? `<div class="feed-activity-text">${escapeHtml(it.text)}</div>` : ''}
        </div>
      </div>
    `;
  }
  dom.feedActivityContainer.innerHTML = html;
}

async function writeFeedNow() {
  if (state.feed.writing) return;
  state.feed.writing = true;
  renderFeedPosts();
  try {
    const res = await fetch('/api/feed/posts/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    state.feed.posts = Array.isArray(data.posts) ? data.posts : [];
    if (data.instructions) state.feed.instructions = data.instructions;
    showToast('✨ 新动态撰写完成', 'success');
  } catch (err) {
    console.error('撰写动态失败:', err);
    showToast(`撰写动态失败: ${err.message}`, 'error');
  } finally {
    state.feed.writing = false;
    renderFeedPosts();
  }
}

function discussFeedPost(postId) {
  const post = state.feed.posts.find((p) => p.id === postId);
  if (!post) return;
  switchTab('chat');
  const discussText = post.prompt || `关于动态中的这条建议：\n\n**${post.title}**\n\n${post.body.slice(0, 1000)}`;
  if (dom.composerInput) {
    dom.composerInput.value = discussText;
    dom.composerInput.focus();
    dom.composerInput.style.height = 'auto';
    dom.composerInput.style.height = `${Math.min(dom.composerInput.scrollHeight, 200)}px`;
  }
}
window._discussFeedPost = discussFeedPost;

function openPostInfoModal(postId) {
  const post = state.feed.posts.find((p) => p.id === postId);
  if (!post) return;
  const areaLabel = AREA_LABELS[post.area] || '工作简报';
  const emoji = AREA_EMOJIS[post.area] || '📝';
  const writtenTime = new Date(post.ts || Date.now()).toLocaleString();

  const bodyHtml = `
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 26px;">${emoji}</span>
        <div>
          <div style="font-size: 15px; font-weight: 600; color: var(--om-fg);">${escapeHtml(post.title)}</div>
          <div style="font-size: 12px; color: var(--om-muted);">分类领域: ${escapeHtml(areaLabel)} · 生成时间: ${escapeHtml(writtenTime)}</div>
        </div>
      </div>

      ${post.prompt ? `
        <div style="background-color: var(--om-surface-2); border-radius: 12px; padding: 12px; font-size: 13px; color: var(--om-fg);">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--om-muted); margin-bottom: 4px;">建议跟进 Prompt</div>
          ${escapeHtml(post.prompt)}
        </div>
      ` : ''}

      <div class="modal-footer" style="margin-top: 10px; display: flex; justify-content: space-between;">
        <button class="btn-danger" id="btn-delete-feed-post" style="padding: 7px 16px; border-radius: 9999px; font-size: 13px; cursor: pointer;">
          🗑️ 删除此篇动态
        </button>
        <button class="btn-secondary" onclick="window.closeModal()" style="padding: 7px 16px; border-radius: 9999px; font-size: 13px;">
          关闭
        </button>
      </div>
    </div>
  `;

  openModal('动态详情与操作', bodyHtml, { icon: '📰' });

  const btnDel = document.getElementById('btn-delete-feed-post');
  if (btnDel) {
    btnDel.onclick = async () => {
      const ok = await showConfirm('确认删除', '确定要删除此篇动态记录吗？此操作不可恢复。');
      if (!ok) return;
      await deleteFeedPost(postId);
      closeModal();
    };
  }
}
window._openFeedPostInfo = openPostInfoModal;

async function deleteFeedPost(postId) {
  try {
    const res = await fetch(`/api/feed/posts/${encodeURIComponent(postId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.feed.posts = state.feed.posts.filter((p) => p.id !== postId);
    renderFeedPosts();
    showToast('动态已成功删除', 'info');
  } catch (err) {
    console.error('删除动态失败:', err);
    showToast(`删除动态失败: ${err.message}`, 'error');
  }
}

function openFeedSettingsModal() {
  const currentInst = state.feed.instructions || '';
  const daily = state.feed.daily !== false;
  const time = state.feed.time || '08:00';

  const bodyHtml = `
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div>
        <label style="font-size: 13px; font-weight: 600; color: var(--om-fg); display: block; margin-bottom: 6px;">
          动态偏好引导指令 (Steering Instruction)
        </label>
        <div style="font-size: 12.5px; color: var(--om-muted); margin-bottom: 8px;">
          用一两句话告诉智能体您最关心的方向（如：重点跟进前端进展、每天提醒日程、别搞标题党等）。后续撰写的每篇动态都将遵循该指令。
        </div>
        <textarea id="modal-feed-instructions" class="form-control" rows="3" placeholder="给我做一个关于我关心的事的动态。短一点、直接一点，扫一眼就能看完，别搞标题党。" style="font-size: 13.5px; line-height: 1.5;">${escapeHtml(currentInst)}</textarea>
      </div>

      <div style="background-color: var(--om-surface-2); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 13.5px; font-weight: 600; color: var(--om-fg);">每日定时自动撰写</div>
            <div style="font-size: 12px; color: var(--om-muted);">由后台定时例行任务驱动，在每日指定时刻自动生成</div>
          </div>
          <input type="checkbox" id="modal-feed-daily" ${daily ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" />
        </div>

        <div id="feed-time-wrap" style="display: ${daily ? 'flex' : 'none'}; justify-content: space-between; align-items: center; border-top: 1px solid var(--om-border); padding-top: 10px;">
          <span style="font-size: 13px; color: var(--om-muted);">每日执行时刻</span>
          <input type="time" id="modal-feed-time" class="form-control" value="${escapeHtml(time)}" style="width: 110px; font-family: var(--font-mono); font-size: 13px;" />
        </div>
      </div>

      <div class="modal-footer" style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
        <button class="btn-secondary" id="btn-modal-feed-writenow" style="border-radius: 9999px; padding: 7px 16px; font-size: 13px;">
          ✨ 立即撰写一期
        </button>
        <div style="display: flex; gap: 8px;">
          <button class="btn-secondary" onclick="window.closeModal()" style="border-radius: 9999px; padding: 7px 16px; font-size: 13px;">取消</button>
          <button class="btn-primary" id="btn-modal-save-feed-settings" style="border-radius: 9999px; padding: 7px 20px; font-size: 13px; font-weight: 600;">保存设置</button>
        </div>
      </div>
    </div>
  `;

  openModal('动态偏好设置 (Feed Settings)', bodyHtml, { icon: '⚙️' });

  const chkDaily = document.getElementById('modal-feed-daily');
  const timeWrap = document.getElementById('feed-time-wrap');
  if (chkDaily && timeWrap) {
    chkDaily.onchange = () => {
      timeWrap.style.display = chkDaily.checked ? 'flex' : 'none';
    };
  }

  const btnWriteNow = document.getElementById('btn-modal-feed-writenow');
  if (btnWriteNow) {
    btnWriteNow.onclick = async () => {
      closeModal();
      await writeFeedNow();
    };
  }

  const btnSave = document.getElementById('btn-modal-save-feed-settings');
  if (btnSave) {
    btnSave.onclick = async () => {
      const instructions = (document.getElementById('modal-feed-instructions')?.value || '').trim();
      const dailyVal = document.getElementById('modal-feed-daily')?.checked !== false;
      const timeVal = (document.getElementById('modal-feed-time')?.value || '08:00').trim();

      try {
        const res = await fetch('/api/feed/instructions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions, daily: dailyVal, time: timeVal })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = await res.json();
        state.feed.instructions = updated.instructions || instructions;
        state.feed.daily = updated.daily !== false;
        state.feed.time = updated.time || timeVal;
        showToast('动态偏好设置已保存', 'success');
        closeModal();
        renderFeedPosts();
      } catch (err) {
        console.error('保存设置失败:', err);
        showToast(`保存失败: ${err.message}`, 'error');
      }
    };
  }
}

function openFeedActivityItem(itemId) {
  const item = state.feed.activities.find((x) => x.id === itemId);
  if (!item) return;
  if (item.kind === 'artifact' && item.path) {
    switchTab('artifacts');
  } else {
    switchTab('chat');
  }
}
window._openFeedActivityItem = openFeedActivityItem;

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
        <button class="btn-secondary" style="padding: 2px 6px; font-size: 10px; flex-shrink: 0;" onclick="copyToClipboard('${webhookUrl}').then(() => showToast('已复制 Webhook 触发地址！', 'success'));">
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

async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级使用传统选中复制模式
    }
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return Boolean(successful);
  } catch (err) {
    console.error('Copy to clipboard failed:', err);
    return false;
  }
}
window.copyToClipboard = copyToClipboard;

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

// ============================================================================
// nanoMuse 风格数字员工主卡片 (Bot Profile Modal) 与虚拟形象工坊 (Avatar Studio)
// ============================================================================
const AVATAR_PRESETS = [
  { id: 'haibara', name: '小哀 (Haibara)', style: 'anime', desc: '手捧热咖啡的慵懒小哀，浅蓝针织毛衣与沉静目光' },
  { id: 'moss-courier', name: '苔藓邮差 (Moss)', style: 'muse', desc: '头顶绿叶耳朵的森林信使，随身携带布制信件包' },
  { id: 'tide-tinker', name: '潮汐工匠 (Tide)', style: 'clay', desc: '生机勃勃的海沫色蝾螈工匠，带有珊瑚领结与随身工具囊' },
  { id: 'dusk-moth', name: '暮光飞蛾 (Dusk)', style: 'watercolor', desc: '佩戴小圆眼镜的深邃飞蛾，温润米白毛领与水彩双翼' },
  { id: 'copper-acorn', name: '纯铜橡果 (Copper)', style: 'line', desc: '精致橡果发条小人偶，纯铜齿轮与雾霾蓝保暖围巾' }
];

const EMOJI_PALETTE = ['✨', '🌙', '🪐', '🌿', '🔥', '🌊', '🦉', '🦊', '🐙', '🎯', '🧭', '💎', '🍀', '🎈', '🤖', '🧠'];
const COLOR_PALETTE = ['#0064d4', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#4b5563'];

const STUDIO_STYLES = [
  { id: 'muse', label: '3D 潮玩 (Muse)' },
  { id: 'anime', label: '日系动漫 (Anime)' },
  { id: 'flat', label: '扁平插画 (Flat)' },
  { id: 'clay', label: '3D 黏土 (Clay)' },
  { id: 'watercolor', label: '水彩手绘 (Watercolour)' },
  { id: 'pixel', label: '像素艺术 (Pixel)' },
  { id: 'line', label: '极简线条 (Line)' }
];

/**
 * 打开 nanoMuse 数字员工主卡片弹窗
 * 顶部居中大尺寸虚拟形象、右下角编辑铅笔、连接状态指示与任务/安全/人设三段式切换
 */
function openBotDetailModal() {
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  if (!bot) return;

  const bodyHtml = `
    <div class="bot-profile-header">
      <button class="bot-profile-close-btn" onclick="window.closeModal()" title="关闭 (Esc)">&times;</button>
      
      <div id="bot-profile-avatar-slot">
        ${renderBotAvatar(bot, { size: 128, showEditBadge: true, useVideo: true, motion: 'avatar-idle' })}
      </div>

      <div class="bot-profile-name" id="bot-profile-card-name">${escapeHtml(bot.name)}</div>
      <div class="bot-profile-status">
        <span class="bot-status-dot-pulse"></span>
        <span>已连接</span>
      </div>

      <div class="bot-segmented-tabs" id="bot-profile-tabs">
        <button type="button" class="bot-segmented-tab active" data-tab="tasks" title="预定任务与自动化例行">${Icons.list(18)}</button>
        <button type="button" class="bot-segmented-tab" data-tab="security" title="门禁审批与安全策略">${Icons.shield(18)}</button>
        <button type="button" class="bot-segmented-tab" data-tab="identity" title="身份人设与系统配置">${Icons.fingerprint(18)}</button>
      </div>
    </div>

    <div class="bot-tab-body">
      <!-- 1. 预定任务与巡检 -->
      <div class="bot-tab-page" id="bot-page-tasks">
        <div class="bot-task-group-title">
          <span>1 项预定任务</span>
          <span style="font-size: 11px; color: var(--om-muted); font-weight: 400;">自动化常驻</span>
        </div>
        
        <div class="bot-task-card">
          <div class="bot-task-icon-wrap" style="background-color: rgba(239, 68, 68, 0.1); color: #ef4444;">
            ${Icons.sparkles(16)}
          </div>
          <div class="bot-task-details">
            <div class="bot-task-name">Heartbeat</div>
            <div class="bot-task-sub">每30分钟 · 维持数字员工后台常驻心跳与自驱状态检测</div>
          </div>
        </div>

        <div class="bot-task-card" style="cursor: pointer;" id="btn-goto-routines">
          <div class="bot-task-icon-wrap" style="background-color: rgba(0, 100, 212, 0.1); color: var(--om-accent);">
            ${Icons.routines(16)}
          </div>
          <div class="bot-task-details">
            <div class="bot-task-name">例行巡检与触发器 (Routines)</div>
            <div class="bot-task-sub">已配置环境巡检、日志上报与 Webhook 自动化规则</div>
          </div>
          <div style="color: var(--om-muted); font-size: 12px;">${Icons.chevronRight(16)}</div>
        </div>

        <div style="text-align: center; margin-top: 20px;">
          <button type="button" class="btn-secondary" id="btn-view-all-goals" style="border-radius: 9999px; padding: 6px 16px; font-size: 12px;">
            查看所有预定与长周期目标
          </button>
        </div>
      </div>

      <!-- 2. 门禁与安全 -->
      <div class="bot-tab-page" id="bot-page-security" style="display: none;">
        <div class="form-group">
          <label class="form-label" style="font-weight: 600; font-size: 13px;">门禁审批级别 (Approval Mode):</label>
          <select id="modal-bot-level" class="form-control" style="border-radius: 12px;">
            <option value="ask" ${bot.approval_level === 'ask' ? 'selected' : ''}>ASK (严格模式: 高危全量拦截审批)</option>
            <option value="auto_edits" ${bot.approval_level === 'auto_edits' ? 'selected' : ''}>AUTO_EDITS (免批代码编辑与工件产出)</option>
            <option value="full" ${bot.approval_level === 'full' ? 'selected' : ''}>FULL (完全自驱模式: 仅拦截破坏底线)</option>
          </select>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: var(--om-surface-2); border-radius: 12px; border: 1px solid var(--om-border);">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: var(--om-accent);">${Icons.terminal(16)}</span>
              <span style="font-size: 13px; font-weight: 500;">微沙箱环境隔离</span>
            </div>
            <span class="pill-badge pill-blue" style="font-size: 11px;">bwrap 容器隔离</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: var(--om-surface-2); border-radius: 12px; border: 1px solid var(--om-border);">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #10b981;">${Icons.shield(16)}</span>
              <span style="font-size: 13px; font-weight: 500;">动态污点跟踪</span>
            </div>
            <span class="pill-badge pill-green" style="font-size: 11px;">纯净态 (Untainted)</span>
          </div>
        </div>

        <div style="margin-top: 20px; display: flex; justify-content: flex-end;">
          <button type="button" class="btn-primary" id="btn-save-security" style="border-radius: 9999px;">保存门禁策略</button>
        </div>
      </div>

      <!-- 3. 身份人设与 Prompt -->
      <div class="bot-tab-page" id="bot-page-identity" style="display: none;">
        <div class="form-group">
          <label class="form-label" style="font-weight: 600; font-size: 13px;">数字员工名称:</label>
          <input type="text" id="modal-bot-name-input" class="form-control" value="${escapeHtml(bot.name)}" style="border-radius: 10px;" />
        </div>
        <div class="form-group">
          <label class="form-label" style="font-weight: 600; font-size: 13px;">业务角色 / 职能描述:</label>
          <input type="text" id="modal-bot-role-input" class="form-control" value="${escapeHtml(bot.role || bot.description || '')}" placeholder="例如: 智能研发助手 / 自动化运维工程师" style="border-radius: 10px;" />
        </div>
        <div class="form-group">
          <label class="form-label" style="font-weight: 600; font-size: 13px;">系统人设 Prompt:</label>
          <textarea id="modal-bot-prompt" class="form-control" rows="5" style="font-family: var(--font-mono); font-size: 12px; border-radius: 10px;">${escapeHtml(bot.system_prompt || '')}</textarea>
        </div>

        <div style="margin-top: 20px; display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn-secondary" onclick="window.closeModal()" style="border-radius: 9999px;">取消</button>
          <button type="button" class="btn-primary" id="btn-save-identity" style="border-radius: 9999px;">保存身份配置</button>
        </div>
      </div>
    </div>
  `;

  openModal(`数字员工: ${bot.name}`, bodyHtml, { hideHeader: true, contentClass: 'bot-profile-modal-content' });

  // 绑定编辑铅笔 -> 打开虚拟形象工坊
  const editBadge = document.getElementById('btn-trigger-avatar-studio');
  if (editBadge) {
    editBadge.onclick = (e) => {
      e.stopPropagation();
      openAvatarStudioModal(bot);
    };
  }

  // 分段选项卡切换逻辑
  const tabsContainer = document.getElementById('bot-profile-tabs');
  if (tabsContainer) {
    tabsContainer.querySelectorAll('.bot-segmented-tab').forEach((tabBtn) => {
      tabBtn.onclick = () => {
        tabsContainer.querySelectorAll('.bot-segmented-tab').forEach((b) => b.classList.remove('active'));
        tabBtn.classList.add('active');

        const target = tabBtn.dataset.tab;
        document.getElementById('bot-page-tasks').style.display = target === 'tasks' ? 'block' : 'none';
        document.getElementById('bot-page-security').style.display = target === 'security' ? 'block' : 'none';
        document.getElementById('bot-page-identity').style.display = target === 'identity' ? 'block' : 'none';
      };
    });
  }

  const btnGotoRoutines = document.getElementById('btn-goto-routines');
  if (btnGotoRoutines) {
    btnGotoRoutines.onclick = () => {
      closeModal();
      switchTab('goals');
    };
  }

  const btnViewGoals = document.getElementById('btn-view-all-goals');
  if (btnViewGoals) {
    btnViewGoals.onclick = () => {
      closeModal();
      switchTab('goals');
    };
  }

  const btnSaveSec = document.getElementById('btn-save-security');
  if (btnSaveSec) {
    btnSaveSec.onclick = async () => {
      const approval_level = document.getElementById('modal-bot-level').value;
      try {
        await fetch(`/api/bots/${encodeURIComponent(bot.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approval_level })
        });
        showToast('门禁审批策略已更新！', 'success');
        bot.approval_level = approval_level;
        dom.approvalModeText.textContent = `${approval_level.toUpperCase()} 门禁`;
        renderBotList();
        closeModal();
      } catch (err) {
        showToast(`保存失败: ${err.message}`, 'error');
      }
    };
  }

  const btnSaveId = document.getElementById('btn-save-identity');
  if (btnSaveId) {
    btnSaveId.onclick = async () => {
      const name = document.getElementById('modal-bot-name-input').value.trim();
      const role = document.getElementById('modal-bot-role-input').value.trim();
      const system_prompt = document.getElementById('modal-bot-prompt').value;
      if (!name) return showToast('请输入数字员工名称', 'warning');

      try {
        await fetch(`/api/bots/${encodeURIComponent(bot.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, role, system_prompt })
        });
        bot.name = name;
        bot.role = role;
        bot.system_prompt = system_prompt;
        dom.activeBotName.textContent = name;
        dom.activeBotRole.textContent = role || 'Bot';
        renderBotList();
        showToast('身份与人设 Prompt 已更新！', 'success');
        closeModal();
      } catch (err) {
        showToast(`保存失败: ${err.message}`, 'error');
      }
    };
  }
}

/**
 * nanoMuse 虚拟形象工坊 (Avatar Studio Modal)
 * 支持小金龙、小哀/动漫预设、本地图片上传、个性 Emoji 调色盘与 AI 定制
 */
function openAvatarStudioModal(bot) {
  let draftAvatar = bot.avatar || 'haibara';
  let draftType = bot.avatar_type || (
    draftAvatar === 'dragon' ? 'dragon' :
    ['haibara', 'moss-courier', 'tide-tinker', 'dusk-moth', 'copper-acorn'].includes(draftAvatar) ? 'preset' :
    draftAvatar.startsWith('/') || draftAvatar.startsWith('http') || draftAvatar.startsWith('data:image/') ? 'image' :
    'emoji'
  );
  let draftEmoji = bot.avatar_emoji || (draftAvatar.length <= 4 ? draftAvatar : '✨');
  let draftColor = bot.avatar_color || '#0064d4';
  let currentMood = 'idle';
  let currentSourceTab = draftType === 'dragon' ? 'dragon' : draftType === 'image' ? 'upload' : draftType === 'emoji' ? 'emoji' : 'presets';

  const updatePreviewBox = () => {
    const previewEl = document.getElementById('studio-avatar-preview-circle');
    if (!previewEl) return;

    const mockBot = {
      ...bot,
      avatar: draftAvatar,
      avatar_type: draftType,
      avatar_emoji: draftEmoji,
      avatar_color: draftColor
    };

    previewEl.innerHTML = renderBotAvatar(mockBot, {
      size: 140,
      mood: currentMood,
      motion: currentMood === 'working' ? 'avatar-working' : currentMood === 'waiting' ? 'avatar-waiting' : 'avatar-idle',
      useVideo: true
    });
  };

  const bodyHtml = `
    <div class="avatar-studio-container">
      <!-- 顶部形象与姿态动态预览台 -->
      <div class="avatar-studio-stage">
        <div id="studio-avatar-preview-circle">
          <!-- 动态更新 -->
        </div>

        <div class="avatar-mood-pills">
          <button type="button" class="avatar-mood-pill active" data-mood="idle">闲置 (Idle)</button>
          <button type="button" class="avatar-mood-pill" data-mood="working">执行 (Working)</button>
          <button type="button" class="avatar-mood-pill" data-mood="waiting">等待 (Waiting)</button>
          <button type="button" class="avatar-mood-pill" data-mood="happy">就绪 (Happy)</button>
        </div>
      </div>

      <!-- 形象来源导航 -->
      <div class="avatar-source-nav">
        <button type="button" class="avatar-source-tab ${currentSourceTab === 'presets' ? 'active' : ''}" data-source="presets">🎨 精选形象集</button>
        <button type="button" class="avatar-source-tab ${currentSourceTab === 'dragon' ? 'active' : ''}" data-source="dragon">🐲 经典小金龙</button>
        <button type="button" class="avatar-source-tab ${currentSourceTab === 'upload' ? 'active' : ''}" data-source="upload">📁 本地图片上传</button>
        <button type="button" class="avatar-source-tab ${currentSourceTab === 'emoji' ? 'active' : ''}" data-source="emoji">✨ 个性 Emoji</button>
        <button type="button" class="avatar-source-tab ${currentSourceTab === 'ai' ? 'active' : ''}" data-source="ai">🪄 AI 形象工坊</button>
      </div>

      <!-- 来源面板容器 -->
      <div class="avatar-source-panel-wrap">
        <!-- 1. 精选形象预设 -->
        <div class="avatar-source-panel" id="panel-source-presets" style="${currentSourceTab === 'presets' ? 'display:block;' : 'display:none;'}">
          <div class="avatar-grid-picker">
            ${AVATAR_PRESETS.map((p) => `
              <div class="avatar-preset-tile ${draftAvatar === p.id ? 'selected' : ''}" data-preset-id="${p.id}">
                <img src="/avatars/presets/${p.id}/idle.webp" class="avatar-preset-img" alt="${p.name}" />
                <span class="avatar-preset-name">${p.name.split(' ')[0]}</span>
              </div>
            `).join('')}
          </div>
          <div id="studio-preset-desc" style="font-size: 12px; color: var(--om-muted); margin-top: 10px; padding: 6px 10px; background: var(--om-surface-2); border-radius: 8px;">
            ${(AVATAR_PRESETS.find((p) => p.id === draftAvatar) || AVATAR_PRESETS[0]).desc}
          </div>
        </div>

        <!-- 2. 经典小金龙 -->
        <div class="avatar-source-panel" id="panel-source-dragon" style="${currentSourceTab === 'dragon' ? 'display:block;' : 'display:none;'}">
          <div style="display: flex; gap: 14px; align-items: center; padding: 12px; background: var(--om-surface-2); border-radius: 14px; border: 1px solid var(--om-border);">
            <img src="/avatars/dragon-idle.webp" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background: #f1efeb;" />
            <div>
              <div style="font-size: 14px; font-weight: 600; color: var(--om-fg);">The Dragon (萌宠金龙)</div>
              <div style="font-size: 12px; color: var(--om-muted); margin-top: 2px;">nanoMuse 标志性图腾伙伴，包含 5 态情绪表达与短视频动态姿态。</div>
              <button type="button" class="btn-primary" id="btn-select-dragon" style="margin-top: 8px; padding: 3px 12px; font-size: 11.5px; border-radius: 9999px;">
                选择小金龙作为形象
              </button>
            </div>
          </div>
        </div>

        <!-- 3. 本地图片上传 -->
        <div class="avatar-source-panel" id="panel-source-upload" style="${currentSourceTab === 'upload' ? 'display:block;' : 'display:none;'}">
          <div style="border: 2px dashed var(--om-border); border-radius: 16px; padding: 20px; text-align: center; cursor: pointer;" id="studio-dropzone">
            <input type="file" id="studio-upload-file-input" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display: none;" />
            <div style="font-size: 28px; margin-bottom: 6px;">🖼️</div>
            <div style="font-size: 13.5px; font-weight: 600; color: var(--om-fg);">点击或拖拽上传任意头像图片</div>
            <div style="font-size: 11.5px; color: var(--om-muted); margin-top: 4px;">支持 PNG、JPG、WEBP 格式，系统将自动裁剪为高清圆形形象</div>
          </div>
        </div>

        <!-- 4. 个性 Emoji -->
        <div class="avatar-source-panel" id="panel-source-emoji" style="${currentSourceTab === 'emoji' ? 'display:block;' : 'display:none;'}">
          <div class="avatar-emoji-grid">
            ${EMOJI_PALETTE.map((e) => `
              <button type="button" class="avatar-emoji-btn ${draftEmoji === e ? 'selected' : ''}" data-emoji="${e}">${e}</button>
            `).join('')}
          </div>
          <div style="font-size: 12px; font-weight: 600; color: var(--om-muted); margin-top: 14px; margin-bottom: 6px;">选择底色色调:</div>
          <div class="avatar-color-strip">
            ${COLOR_PALETTE.map((c) => `
              <div class="avatar-color-circle ${draftColor === c ? 'selected' : ''}" data-color="${c}" style="background-color: ${c};"></div>
            `).join('')}
          </div>
        </div>

        <!-- 5. AI 虚拟形象工坊 -->
        <div class="avatar-source-panel" id="panel-source-ai" style="${currentSourceTab === 'ai' ? 'display:block;' : 'display:none;'}">
          <div class="form-group">
            <label class="form-label" style="font-size: 12px; font-weight: 600;">输入形象提示词 Prompt:</label>
            <input type="text" id="studio-ai-prompt" class="form-control" value="a thoughtful anime girl holding a warm coffee cup, cozy blue sweater" style="border-radius: 10px; font-size: 13px;" />
          </div>
          <div class="form-group">
            <label class="form-label" style="font-size: 12px; font-weight: 600;">艺术质感风格 (Style):</label>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;" id="studio-style-picker">
              ${STUDIO_STYLES.map((st, idx) => `
                <button type="button" class="btn-secondary ${idx === 1 ? 'active' : ''}" data-style-id="${st.id}" style="padding: 4px 10px; font-size: 11.5px; border-radius: 9999px;">
                  ${st.label}
                </button>
              `).join('')}
            </div>
          </div>
          <button type="button" class="btn-primary" id="btn-studio-generate-ai" style="width: 100%; border-radius: 12px; padding: 8px; margin-top: 4px; display: flex; align-items: center; justify-content: center; gap: 6px;">
            ${Icons.sparkles(16)} 生成并应用定制虚拟形象
          </button>
        </div>
      </div>

      <div class="modal-footer" style="margin-top: 8px; padding-top: 14px; border-top: 1px solid var(--om-border); display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" class="btn-secondary" onclick="window.closeModal()" style="border-radius: 9999px;">取消</button>
        <button type="button" class="btn-primary" id="btn-save-studio-avatar" style="border-radius: 9999px; padding: 6px 18px;">保存并应用形象</button>
      </div>
    </div>
  `;

  openModal(`虚拟形象工坊 · ${bot.name}`, bodyHtml, { icon: '✨' });
  updatePreviewBox();

  // 姿态 Mood 切换
  dom.modalContainer.querySelectorAll('.avatar-mood-pill').forEach((pill) => {
    pill.onclick = () => {
      dom.modalContainer.querySelectorAll('.avatar-mood-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentMood = pill.dataset.mood;
      updatePreviewBox();
    };
  });

  // 来源 Tabs 切换
  dom.modalContainer.querySelectorAll('.avatar-source-tab').forEach((tab) => {
    tab.onclick = () => {
      dom.modalContainer.querySelectorAll('.avatar-source-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const src = tab.dataset.source;
      currentSourceTab = src;

      document.getElementById('panel-source-presets').style.display = src === 'presets' ? 'block' : 'none';
      document.getElementById('panel-source-dragon').style.display = src === 'dragon' ? 'block' : 'none';
      document.getElementById('panel-source-upload').style.display = src === 'upload' ? 'block' : 'none';
      document.getElementById('panel-source-emoji').style.display = src === 'emoji' ? 'block' : 'none';
      document.getElementById('panel-source-ai').style.display = src === 'ai' ? 'block' : 'none';
    };
  });

  // 预设项点击选择
  dom.modalContainer.querySelectorAll('.avatar-preset-tile').forEach((tile) => {
    tile.onclick = () => {
      dom.modalContainer.querySelectorAll('.avatar-preset-tile').forEach((t) => t.classList.remove('selected'));
      tile.classList.add('selected');
      const pId = tile.dataset.presetId;
      draftType = 'preset';
      draftAvatar = pId;
      const descEl = document.getElementById('studio-preset-desc');
      const found = AVATAR_PRESETS.find((p) => p.id === pId);
      if (descEl && found) descEl.textContent = found.desc;
      updatePreviewBox();
    };
  });

  // 小金龙选择
  const btnDragon = document.getElementById('btn-select-dragon');
  if (btnDragon) {
    btnDragon.onclick = () => {
      draftType = 'dragon';
      draftAvatar = 'dragon';
      showToast('已选中经典小金龙形象', 'info');
      updatePreviewBox();
    };
  }

  // 本地图片上传
  const dropzone = document.getElementById('studio-dropzone');
  const fileInput = document.getElementById('studio-upload-file-input');
  if (dropzone && fileInput) {
    dropzone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = evt.target?.result;
        if (!base64) return;

        try {
          showToast('正在上传并裁剪头像...', 'info');
          const res = await fetch('/api/upload/avatar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, name: file.name })
          });
          const resData = await res.json();
          if (resData.url) {
            draftType = 'image';
            draftAvatar = resData.url;
            updatePreviewBox();
            showToast('自定义头像上传成功！', 'success');
          } else {
            throw new Error(resData.error || '上传失败');
          }
        } catch (err) {
          showToast(`上传异常: ${err.message}`, 'error');
        }
      };
      reader.readAsDataURL(file);
    };
  }

  // Emoji 与色调选择
  dom.modalContainer.querySelectorAll('.avatar-emoji-btn').forEach((btn) => {
    btn.onclick = () => {
      dom.modalContainer.querySelectorAll('.avatar-emoji-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      draftEmoji = btn.dataset.emoji;
      draftType = 'emoji';
      draftAvatar = draftEmoji;
      updatePreviewBox();
    };
  });

  dom.modalContainer.querySelectorAll('.avatar-color-circle').forEach((circle) => {
    circle.onclick = () => {
      dom.modalContainer.querySelectorAll('.avatar-color-circle').forEach((c) => c.classList.remove('selected'));
      circle.classList.add('selected');
      draftColor = circle.dataset.color;
      draftType = 'emoji';
      updatePreviewBox();
    };
  });

  // AI 工坊生成模拟定制
  const btnAiGen = document.getElementById('btn-studio-generate-ai');
  if (btnAiGen) {
    btnAiGen.onclick = () => {
      const prompt = document.getElementById('studio-ai-prompt').value.trim();
      btnAiGen.disabled = true;
      btnAiGen.innerHTML = `正在调用画图模型生成形象...`;

      setTimeout(() => {
        btnAiGen.disabled = false;
        btnAiGen.innerHTML = `${Icons.sparkles(16)} 生成并应用定制虚拟形象`;
        // 智能匹配或分配预设作为结果
        draftType = 'preset';
        draftAvatar = prompt.includes('moth') ? 'dusk-moth' : prompt.includes('tinker') ? 'tide-tinker' : prompt.includes('acorn') ? 'copper-acorn' : prompt.includes('moss') ? 'moss-courier' : 'haibara';
        updatePreviewBox();
        showToast('AI 形象绘制完成并已就绪！', 'success');
      }, 700);
    };
  }

  // 保存并应用
  const btnSave = document.getElementById('btn-save-studio-avatar');
  if (btnSave) {
    btnSave.onclick = async () => {
      try {
        const patchData = {
          avatar: draftAvatar,
          avatar_type: draftType,
          avatar_emoji: draftEmoji,
          avatar_color: draftColor
        };

        await fetch(`/api/bots/${encodeURIComponent(bot.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchData)
        });

        Object.assign(bot, patchData);
        dom.activeBotAvatar.innerHTML = renderBotAvatar(bot, { size: 22, still: true });
        renderBotList();
        closeModal();
        showToast('数字员工虚拟形象已更新！', 'success');
      } catch (err) {
        showToast(`保存失败: ${err.message}`, 'error');
      }
    };
  }
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

function updateUserUI(user) {
  if (!dom.topUserName || !dom.topUserAvatar) return;
  if (user && user.username) {
    const name = user.displayName || user.username;
    dom.topUserName.textContent = name;
    dom.topUserName.title = `${name} (${user.username})`;
    dom.topUserAvatar.textContent = name.slice(0, 1).toUpperCase();
    dom.topUserAvatar.style.backgroundColor = 'var(--om-accent)';
  } else {
    dom.topUserName.textContent = '登录 / 注册';
    dom.topUserName.title = '点击登录或注册账号';
    dom.topUserAvatar.textContent = '👤';
    dom.topUserAvatar.style.backgroundColor = 'var(--om-muted)';
  }
}

async function getLoginUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const json = await res.json();
      const user = json.data || json.user || json;
      state.currentUser = user;
      updateUserUI(user);
      return user;
    }
  } catch (err) {
    console.warn('[Auth] 获取登录身份异常:', err);
  }
  state.currentUser = null;
  updateUserUI(null);
  return null;
}

function openAuthModal(defaultTab = 'login') {
  let activeTab = defaultTab;

  function renderForm() {
    const isLogin = activeTab === 'login';
    const bodyHtml = `
      <div style="margin-bottom: 20px;">
        <div style="display: flex; gap: 8px; border-bottom: 1px solid var(--om-border); padding-bottom: 10px; margin-bottom: 18px;">
          <button type="button" id="tab-auth-login" style="padding: 7px 18px; border-radius: 20px; font-weight: 600; font-size: 13.5px; cursor: pointer; border: none; background: ${isLogin ? 'var(--om-accent)' : 'transparent'}; color: ${isLogin ? '#fff' : 'var(--om-muted)'}; transition: all 0.15s ease;">
            账号登录
          </button>
          <button type="button" id="tab-auth-register" style="padding: 7px 18px; border-radius: 20px; font-weight: 600; font-size: 13.5px; cursor: pointer; border: none; background: ${!isLogin ? 'var(--om-accent)' : 'transparent'}; color: ${!isLogin ? '#fff' : 'var(--om-muted)'}; transition: all 0.15s ease;">
            注册新账号
          </button>
        </div>

        ${isLogin ? `
          <form id="form-auth-login" style="display: flex; flex-direction: column; gap: 14px;">
            <div>
              <label style="display: block; font-size: 13px; font-weight: 550; margin-bottom: 6px; color: var(--om-fg);">账号 / 用户名</label>
              <input type="text" id="auth-username" required autocomplete="username" placeholder="请输入注册账号" style="width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--om-border); background: var(--om-surface-2); color: var(--om-fg); font-size: 13.5px;" />
            </div>
            <div>
              <label style="display: block; font-size: 13px; font-weight: 550; margin-bottom: 6px; color: var(--om-fg);">密码</label>
              <input type="password" id="auth-password" required autocomplete="current-password" placeholder="请输入密码" style="width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--om-border); background: var(--om-surface-2); color: var(--om-fg); font-size: 13.5px;" />
            </div>
            <div id="auth-error-msg" style="display: none; font-size: 12.5px; color: var(--accent-red, #ef4444); padding: 2px 0;"></div>
            <button type="submit" class="btn-primary" style="margin-top: 8px; padding: 11px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer;">
              立即登录
            </button>
          </form>
        ` : `
          <form id="form-auth-register" style="display: flex; flex-direction: column; gap: 14px;">
            <div>
              <label style="display: block; font-size: 13px; font-weight: 550; margin-bottom: 6px; color: var(--om-fg);">账号 / 用户名</label>
              <input type="text" id="reg-username" required autocomplete="username" placeholder="2-32位字符（字母、数字或中文）" style="width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--om-border); background: var(--om-surface-2); color: var(--om-fg); font-size: 13.5px;" />
            </div>
            <div>
              <label style="display: block; font-size: 13px; font-weight: 550; margin-bottom: 6px; color: var(--om-fg);">显示昵称 (选填)</label>
              <input type="text" id="reg-displayname" autocomplete="name" placeholder="例如：开发助手小李" style="width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--om-border); background: var(--om-surface-2); color: var(--om-fg); font-size: 13.5px;" />
            </div>
            <div>
              <label style="display: block; font-size: 13px; font-weight: 550; margin-bottom: 6px; color: var(--om-fg);">设置密码</label>
              <input type="password" id="reg-password" required autocomplete="new-password" placeholder="至少 6 位密码" style="width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--om-border); background: var(--om-surface-2); color: var(--om-fg); font-size: 13.5px;" />
            </div>
            <div>
              <label style="display: block; font-size: 13px; font-weight: 550; margin-bottom: 6px; color: var(--om-fg);">确认密码</label>
              <input type="password" id="reg-confirm" required autocomplete="new-password" placeholder="再次输入密码" style="width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--om-border); background: var(--om-surface-2); color: var(--om-fg); font-size: 13.5px;" />
            </div>
            <div id="reg-error-msg" style="display: none; font-size: 12.5px; color: var(--accent-red, #ef4444); padding: 2px 0;"></div>
            <button type="submit" class="btn-primary" style="margin-top: 8px; padding: 11px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer;">
              立即注册并登录
            </button>
          </form>
        `}
      </div>
    `;

    openModal(isLogin ? '登录 MuseClaw 工作台' : '注册 MuseClaw 新账号', bodyHtml);

    const btnTabLogin = document.getElementById('tab-auth-login');
    const btnTabReg = document.getElementById('tab-auth-register');
    if (btnTabLogin && btnTabReg) {
      btnTabLogin.onclick = () => { activeTab = 'login'; renderForm(); };
      btnTabReg.onclick = () => { activeTab = 'register'; renderForm(); };
    }

    if (isLogin) {
      const loginForm = document.getElementById('form-auth-login');
      if (loginForm) {
        loginForm.onsubmit = async (e) => {
          e.preventDefault();
          const username = document.getElementById('auth-username')?.value.trim();
          const password = document.getElementById('auth-password')?.value;
          const errBox = document.getElementById('auth-error-msg');
          try {
            const res = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
              throw new Error(data.error || '登录失败');
            }
            state.currentUser = data.user || data.data;
            updateUserUI(state.currentUser);
            closeModal();
            showToast(`欢迎回来，${state.currentUser.displayName || state.currentUser.username}！`, 'success');
            loadBots();
            loadSessions();
          } catch (err) {
            if (errBox) {
              errBox.textContent = err.message;
              errBox.style.display = 'block';
            }
          }
        };
      }
    } else {
      const regForm = document.getElementById('form-auth-register');
      if (regForm) {
        regForm.onsubmit = async (e) => {
          e.preventDefault();
          const username = document.getElementById('reg-username')?.value.trim();
          const displayName = document.getElementById('reg-displayname')?.value.trim();
          const password = document.getElementById('reg-password')?.value;
          const confirm = document.getElementById('reg-confirm')?.value;
          const errBox = document.getElementById('reg-error-msg');

          if (password !== confirm) {
            if (errBox) {
              errBox.textContent = '两次输入的密码不一致';
              errBox.style.display = 'block';
            }
            return;
          }

          try {
            const res = await fetch('/api/auth/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password, displayName })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
              throw new Error(data.error || '注册失败');
            }
            state.currentUser = data.user || data.data;
            updateUserUI(state.currentUser);
            closeModal();
            showToast('注册成功，已为你自动登录！', 'success');
            loadBots();
            loadSessions();
          } catch (err) {
            if (errBox) {
              errBox.textContent = err.message;
              errBox.style.display = 'block';
            }
          }
        };
      }
    }
  }

  renderForm();
}

function openUserProfileModal() {
  const user = state.currentUser;
  if (!user) {
    openAuthModal('login');
    return;
  }

  const bodyHtml = `
    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--om-border);">
      <div style="width: 52px; height: 52px; border-radius: 50%; background: var(--om-accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 650; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        ${escapeHtml((user.displayName || user.username || 'U').slice(0, 1).toUpperCase())}
      </div>
      <div>
        <div style="font-size: 16px; font-weight: 650; color: var(--om-fg); display: flex; align-items: center; gap: 8px;">
          <span>${escapeHtml(user.displayName || user.username)}</span>
          <span class="pill-badge pill-blue" style="font-size: 11px;">账号已就绪</span>
        </div>
        <div style="font-size: 13px; color: var(--om-muted); margin-top: 3px;">
          用户名: <code style="color: var(--om-fg);">${escapeHtml(user.username)}</code>
        </div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 10px; font-size: 13px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--om-muted);">数据沙箱隔离</span>
        <span style="color: var(--om-success, #10b981); font-weight: 550;">● 独立数据存储就绪</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--om-muted);">伴侣接入 Token</span>
        <span style="color: var(--om-fg); font-family: var(--font-mono);">${escapeHtml(user.username)}</span>
      </div>
    </div>

    <div style="display: flex; justify-content: flex-end; gap: 10px;">
      <button type="button" class="btn-secondary" onclick="closeModal();">关闭</button>
      <button type="button" class="btn-danger" id="btn-modal-logout" style="padding: 7px 14px; border-radius: 8px; font-size: 12.5px; cursor: pointer;">
        退出登录
      </button>
    </div>
  `;

  openModal('个人中心与账号设置', bodyHtml);

  const btnLogout = document.getElementById('btn-modal-logout');
  if (btnLogout) {
    btnLogout.onclick = async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        state.currentUser = null;
        updateUserUI(null);
        closeModal();
        showToast('已安全退出登录', 'info');
        openAuthModal('login');
      } catch (err) {
        showToast(`退出异常: ${err.message}`, 'error');
      }
    };
  }
}

function getOrCreateUserId() {
  if (state.currentUser && state.currentUser.username) {
    return state.currentUser.username;
  }
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
        <button type="button" class="btn-secondary" id="btn-copy-install-cmd" style="padding: 2px 8px; font-size: 11px; cursor: pointer;">
          📋 一键复制整组命令
        </button>
      </div>
      <div style="position: relative; background: var(--om-surface-3); border: 1px solid var(--om-border); border-radius: 8px; padding: 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; word-break: break-all; color: var(--om-fg); white-space: pre-wrap; user-select: all; -webkit-user-select: all; cursor: text;" id="install-cmd-code"><code>${escapeHtml(installCmd)}</code></div>
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

  const copyBtn = document.getElementById('btn-copy-install-cmd');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const ok = await copyToClipboard(installCmd);
      if (ok) {
        showToast('已复制接入命令到剪贴板！', 'success');
      } else {
        showToast('复制失败，请手动选中文本框命令进行复制', 'warning');
      }
    };
  }

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
          ? (p.installed ? (p.executablePath ? '💻 本地已就绪' : '🌐 远程就绪') : '未检测到')
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
  if (dom.btnTopUserProfile) {
    dom.btnTopUserProfile.onclick = () => {
      if (state.currentUser) {
        openUserProfileModal();
      } else {
        openAuthModal('login');
      }
    };
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

  initComposerControls();

  if (dom.btnFeedSettings) {
    dom.btnFeedSettings.onclick = openFeedSettingsModal;
  }
  if (dom.btnFeedWriteNow) {
    dom.btnFeedWriteNow.onclick = writeFeedNow;
  }
  if (dom.btnRefreshFeedActivity) {
    dom.btnRefreshFeedActivity.onclick = loadFeedActivity;
  }

  if (dom.btnEditMemory) dom.btnEditMemory.onclick = openEditMemoryModal;
  if (dom.btnDryRunMemory) dom.btnDryRunMemory.onclick = () => triggerConsolidation(true);
  if (dom.btnRunConsolidate) dom.btnRunConsolidate.onclick = () => triggerConsolidation(false);
  if (dom.btnUndoMemory) dom.btnUndoMemory.onclick = undoConsolidation;

  if (dom.btnRefreshRoutines) dom.btnRefreshRoutines.onclick = loadRoutines;
  if (dom.btnRefreshSandbox) dom.btnRefreshSandbox.onclick = loadSandboxStatus;
  if (dom.btnRefreshArtifacts) dom.btnRefreshArtifacts.onclick = loadArtifacts;

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
getLoginUser().finally(() => {
  loadBots();
  loadModelsConfig();
  if (!state.currentUser) {
    openAuthModal('login');
  }
});
const initialTab = getTabFromLocation();
switchTab(initialTab, true);
