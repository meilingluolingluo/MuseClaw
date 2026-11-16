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
  isStreaming: false
};

// ============================================================================
// DOM 元素引用
// ============================================================================
const dom = {
  navItems: document.querySelectorAll('.nav-item'),
  views: {
    chat: document.getElementById('view-chat'),
    goals: document.getElementById('view-goals'),
    routines: document.getElementById('view-routines'),
    memory: document.getElementById('view-memory'),
    skills: document.getElementById('view-skills'),
    audit: document.getElementById('view-audit'),
    artifacts: document.getElementById('view-artifacts')
  },
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
// 主题切换管理 (nanoMuse 风格深色/浅色切换)
// ============================================================================
function initTheme() {
  const saved = localStorage.getItem('museclaw_theme') || 'light';
  document.documentElement.dataset.theme = saved;
  updateThemeUI(saved);

  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.onclick = toggleTheme;
  }
}

function updateThemeUI(theme) {
  const icon = document.getElementById('icon-theme-toggle');
  const label = document.getElementById('label-theme');
  if (icon) {
    icon.innerHTML = theme === 'dark' ? Icons.sun(18) : Icons.moon(18);
  }
  if (label) {
    label.textContent = theme === 'dark' ? '浅色' : '深色';
  }
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('museclaw_theme', next);
  updateThemeUI(next);
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

  const themeToggle = document.getElementById('icon-theme-toggle');
  if (themeToggle) {
    const currentTheme = document.documentElement.dataset.theme || 'light';
    themeToggle.innerHTML = currentTheme === 'dark' ? Icons.sun(18) : Icons.moon(18);
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
}

// ============================================================================
// 视图切换与导航路由
// ============================================================================
function switchTab(tabName) {
  state.currentTab = tabName;
  dom.navItems.forEach((item) => {
    if (item.dataset.tab === tabName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  Object.entries(dom.views).forEach(([name, el]) => {
    if (!el) return;
    if (name === tabName) {
      el.style.display = name === 'chat' ? 'flex' : 'block';
    } else {
      el.style.display = 'none';
    }
  });

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
      const coordinator = state.bots.find((b) => b.is_coordinator) || state.bots[0];
      selectBot(coordinator.id);
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
    card.onclick = () => selectBot(bot.id);

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
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return;

  renderBotList();
  dom.activeBotAvatar.textContent = bot.avatar || '🤖';
  dom.activeBotName.textContent = bot.name;
  dom.activeBotRole.textContent = bot.role || (bot.is_coordinator ? 'Coordinator' : 'Bot');
  dom.approvalModeText.textContent = `${(bot.approval_level || 'ask').toUpperCase()} 门禁`;

  await loadSessionsForBot(botId);
}

async function loadSessionsForBot(botId) {
  try {
    const res = await fetch(`/api/sessions?bot_id=${encodeURIComponent(botId)}`);
    const sessions = await res.json();
    state.sessions = sessions;
    renderSessionList();

    if (sessions.length > 0) {
      selectSession(sessions[0].id);
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
    item.onclick = () => selectSession(s.id);
    item.innerHTML = `
      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(s.title || '新任务会话')}</span>
      <span style="font-size: 10px; color: var(--text-dim); flex-shrink: 0;">${s.messageCount || 0}条</span>
    `;
    dom.sessionList.appendChild(item);
  });
}

async function selectSession(sessionId) {
  state.activeSessionId = sessionId;
  renderSessionList();

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
  renderSessionList();
  renderChatMessages();
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

  // 2. 创建 Assistant 占位气泡
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  const assistantRow = document.createElement('div');
  assistantRow.className = 'message-row assistant';
  assistantRow.innerHTML = `
    <div class="message-avatar">${bot ? bot.avatar || '🤖' : '🤖'}</div>
    <div class="message-bubble" id="streaming-bubble">
      <div id="plan-steps-container"></div>
      <div id="activity-container"></div>
      <div id="stream-text" style="line-height: 1.6;"></div>
    </div>
  `;
  dom.chatMessages.appendChild(assistantRow);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

  const streamTextEl = assistantRow.querySelector('#stream-text');
  const activityContainer = assistantRow.querySelector('#activity-container');
  const planContainer = assistantRow.querySelector('#plan-steps-container');

  let fullAssistantText = '';

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
        user_id: 'user_web'
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
          handleStreamEvent(event, { streamTextEl, activityContainer, planContainer, assistantRow });
          if (event.type === 'stream:text-delta') {
            fullAssistantText += event.text;
          }
        } catch (e) {
          console.warn('解析流式事件错误:', e);
        }
      }
    }

    // 流式传输完毕后，以完整 Markdown 格式固化渲染
    streamTextEl.innerHTML = renderMarkdown(fullAssistantText);
    state.messages.push({ role: 'assistant', content: fullAssistantText });
  } catch (err) {
    streamTextEl.innerHTML += `<div style="color: var(--accent-red); margin-top: 8px;">[通信失败: ${err.message}]</div>`;
  } finally {
    state.isStreaming = false;
    dom.btnSendMessage.disabled = false;
  }
}

// 处理每个流式事件 (SSE Events)
function handleStreamEvent(event, { streamTextEl, activityContainer, planContainer }) {
  if (event.type === 'session:init') {
    if (event.sessionId) state.activeSessionId = event.sessionId;
    if (event.title) {
      const cur = state.sessions.find((s) => s.id === state.activeSessionId);
      if (cur) cur.title = event.title;
      renderSessionList();
    }
  }

  if (event.type === 'stream:text-delta') {
    streamTextEl.innerText += event.text;
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
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
    await fetch(`/api/goals/${encodeURIComponent(goalId)}/advance`, { method: 'POST' });
    loadGoals();
  } catch (err) {
    alert(`推进失败: ${err.message}`);
  }
};

window.resolveProposal = async function (goalId, proposalId, accept) {
  try {
    await fetch(`/api/goals/${encodeURIComponent(goalId)}/proposal/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposal_id: proposalId, accept })
    });
    loadGoals();
  } catch (err) {
    alert(`处理提案失败: ${err.message}`);
  }
};

window.deleteGoal = async function (goalId) {
  if (!confirm('确定要删除该长周期目标吗？')) return;
  try {
    await fetch(`/api/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' });
    loadGoals();
  } catch (err) {
    alert(`删除失败: ${err.message}`);
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
        <button class="btn-secondary" style="padding: 2px 6px; font-size: 10px; flex-shrink: 0;" onclick="navigator.clipboard.writeText('${webhookUrl}'); alert('已复制 Webhook 触发地址！');">
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
    alert('已触发例行任务执行，任务在后台沙箱中自驱运转！');
    setTimeout(loadRoutines, 1000);
  } catch (err) {
    alert(`触发失败: ${err.message}`);
  }
};

window.toggleRoutine = async function (routineId) {
  try {
    await fetch(`/api/routines/${encodeURIComponent(routineId)}/toggle`, { method: 'POST' });
    loadRoutines();
  } catch (err) {
    alert(`切换状态失败: ${err.message}`);
  }
};

// ============================================================================
// 5. 受控长期记忆与整理 (Memory)
// ============================================================================
async function loadMemory() {
  if (!state.activeBotId) return;
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
  dom.memoryMetaInfo.textContent = `${state.memoryItems.length} 条事实 | ${new Blob([state.memoryText]).size} 字节`;

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
    dom.consolidationHistoryList.innerHTML = '暂无历史整理记录';
  } else {
    state.memoryReports.slice(-3).reverse().forEach((r) => {
      const item = document.createElement('div');
      item.style = 'padding: 6px 0; border-bottom: 1px solid var(--border-subtle);';
      item.innerHTML = `
        <div>时间: ${new Date(r.timestamp).toLocaleTimeString()}</div>
        <div>精炼: 合并 ${r.merged_count || 0} 条，丢弃 ${r.dropped_count || 0} 条</div>
      `;
      dom.consolidationHistoryList.appendChild(item);
    });
  }
}

async function triggerConsolidation(dryRun = false) {
  if (!state.activeBotId) return;
  try {
    const res = await fetch(`/api/bots/${encodeURIComponent(state.activeBotId)}/memory/consolidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: dryRun, budget_share: 0.2 })
    });
    const data = await res.json();
    if (data.success) {
      alert(`记忆受控整理预检/执行成功！\n操作计划: 合并 ${data.report.merged_count} 条，清除 ${data.report.dropped_count} 条，受死线保护未变动项 ${data.report.rejected_count} 条`);
      loadMemory();
    } else {
      alert(`整理失败: ${data.error}`);
    }
  } catch (err) {
    alert(`网络错误: ${err.message}`);
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
      alert('已成功一键无损回滚至上次自整理前的记忆状态！');
      loadMemory();
    } else {
      alert(data.message || '没有可撤销的历史备份');
    }
  } catch (err) {
    alert(`撤销失败: ${err.message}`);
  }
}

function openEditMemoryModal() {
  openModal(`编辑 ${state.activeBotId} 的长期记忆 (MEMORY.md)`, `
    <div class="form-group">
      <label class="form-label">记忆文本内容（每行一条 - 事实，支持 [user] 永久锚点）:</label>
      <textarea id="modal-memory-text" class="form-control" rows="12" style="font-family: var(--font-mono); font-size: 12px; line-height: 1.5;">${escapeHtml(state.memoryText)}</textarea>
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 8px;">
      <button class="btn-secondary" onclick="window.closeModal()">取消</button>
      <button class="btn-primary" id="btn-save-memory">保存更改</button>
    </div>
  `);

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
        loadMemory();
      } else {
        const err = await res.json();
        alert(`保存失败: ${err.error || '超出预算'}`);
      }
    } catch (err) {
      alert(`保存失败: ${err.message}`);
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
  try {
    await fetch(`/api/grants/${encodeURIComponent(grantId)}/revoke`, { method: 'POST' });
    loadAuditAndPolicy();
  } catch (err) {
    alert(`撤销失败: ${err.message}`);
  }
};

// ============================================================================
// 8. 交付工件与产出物展台 (Artifacts)
// ============================================================================
async function loadArtifacts() {
  try {
    const res = await fetch('/api/artifacts');
    const files = await res.json();
    state.artifacts = Array.isArray(files) ? files : [];
    renderArtifactsGrid();
  } catch (err) {
    console.error('加载工件失败:', err);
  }
}

function renderArtifactsGrid() {
  dom.artifactsContainer.innerHTML = '';
  if (state.artifacts.length === 0) {
    dom.artifactsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 40px;">
        暂无交付产出物。Agent 在执行任务时通过 save_artifact 产出的报告与配置将在这里沉淀。
      </div>
    `;
    return;
  }

  state.artifacts.forEach((art) => {
    const card = document.createElement('div');
    card.className = 'artifact-card';
    card.onclick = () => previewArtifact(art);
    card.innerHTML = `
      <div style="font-size: 24px;">📄</div>
      <div style="font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(art.name)}</div>
      <div style="font-size: 11px; color: var(--text-dim);">${art.size} 字节 | 点击在线预览</div>
    `;
    dom.artifactsContainer.appendChild(card);
  });
}

async function previewArtifact(art) {
  try {
    const res = await fetch(art.url);
    const content = await res.text();
    openModal(`交付工件预览: ${art.name}`, `
      <div style="max-height: 480px; overflow-y: auto; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 16px;">
        ${art.name.endsWith('.md') ? renderMarkdown(content) : `<pre style="font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap;">${escapeHtml(content)}</pre>`}
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
        <button class="btn-secondary" onclick="window.closeModal()">关闭</button>
        <a href="${art.url}" download="${art.name}" class="btn-primary" style="text-decoration: none;">
          ${Icons.download(13)} 下载工件
        </a>
      </div>
    `);
  } catch (err) {
    alert(`加载工件失败: ${err.message}`);
  }
}

// ============================================================================
// 通用弹窗与 Bot 配置详情
// ============================================================================
function openModal(title, bodyHtml) {
  dom.modalContainer.innerHTML = `
    <div class="modal-overlay" onclick="if (event.target === this) window.closeModal()">
      <div class="modal-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
          <strong style="font-size: 16px;">${escapeHtml(title)}</strong>
          <button onclick="window.closeModal()" style="background: transparent; border: none; color: var(--text-dim); cursor: pointer; font-size: 18px;">&times;</button>
        </div>
        <div>${bodyHtml}</div>
      </div>
    </div>
  `;
}

window.closeModal = function () {
  dom.modalContainer.innerHTML = '';
};

function openBotDetailModal() {
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  if (!bot) return;

  openModal(`数字员工配置: ${bot.name}`, `
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
    <div style="display: flex; justify-content: flex-end; gap: 8px;">
      <button class="btn-secondary" onclick="window.closeModal()">取消</button>
      <button class="btn-primary" id="btn-save-bot">保存配置</button>
    </div>
  `);

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
      loadBots();
    } catch (err) {
      alert(`保存失败: ${err.message}`);
    }
  };
}

// ============================================================================
// 事件绑定与启动入口
// ============================================================================
function initEventHandlers() {
  dom.navItems.forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

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
    await fetch('/api/policy/reload', { method: 'POST' });
    alert('已成功重载外部安全策略配置 (sentinel-policy.json)！');
    loadAuditAndPolicy();
  };
  dom.btnRefreshAudit.onclick = loadAuditAndPolicy;

  // 创建新长周期目标模态框
  dom.btnCreateGoal.onclick = () => {
    openModal('规划长周期多步自驱目标', `
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
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn-secondary" onclick="window.closeModal()">取消</button>
        <button class="btn-primary" id="btn-submit-goal">创建目标</button>
      </div>
    `);

    document.getElementById('btn-submit-goal').onclick = async () => {
      const title = document.getElementById('modal-goal-title').value.trim();
      if (!title) return alert('请输入目标标题');
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
        loadGoals();
      } catch (err) {
        alert(`创建失败: ${err.message}`);
      }
    };
  };
}

// 启动入口
initTheme();
initIcons();
initEventHandlers();
loadBots();
