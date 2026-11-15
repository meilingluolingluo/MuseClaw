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
  messages: [],
  goals: [],
  memoryText: '',
  memoryItems: [],
  memoryReports: [],
  sandboxStatus: null,
  channelLadder: null,
  artifacts: [],
  pendingApproval: null,
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
    memory: document.getElementById('view-memory'),
    skills: document.getElementById('view-skills'),
    artifacts: document.getElementById('view-artifacts')
  },
  botList: document.getElementById('bot-list-container'),
  sessionList: document.getElementById('session-list-container'),
  botCountBadge: document.getElementById('bot-count-badge'),
  btnNewSession: document.getElementById('btn-new-session'),
  activeBotAvatar: document.getElementById('active-bot-avatar'),
  activeBotName: document.getElementById('active-bot-name'),
  activeBotRole: document.getElementById('active-bot-role'),
  taintBadgeContainer: document.getElementById('taint-badge-container'),
  approvalModeBtn: document.getElementById('approval-mode-btn'),
  approvalModeText: document.getElementById('current-approval-mode-text'),
  chatMessages: document.getElementById('chat-messages'),
  composerInput: document.getElementById('composer-input'),
  btnSendMessage: document.getElementById('btn-send-message'),
  promptPills: document.querySelectorAll('.prompt-pill'),
  goalsContainer: document.getElementById('goals-container'),
  btnCreateGoal: document.getElementById('btn-create-goal'),
  memoryItemsList: document.getElementById('memory-items-list'),
  memoryMetaInfo: document.getElementById('memory-meta-info'),
  btnDryRunMemory: document.getElementById('btn-dry-run-memory'),
  btnRunConsolidate: document.getElementById('btn-run-consolidate'),
  btnUndoMemory: document.getElementById('btn-undo-memory'),
  consolidationHistoryList: document.getElementById('consolidation-history-list'),
  sandboxDetails: document.getElementById('sandbox-details-container'),
  ladderContainer: document.getElementById('ladder-rungs-container'),
  btnRefreshSandbox: document.getElementById('btn-refresh-sandbox'),
  artifactsContainer: document.getElementById('artifacts-container'),
  btnRefreshArtifacts: document.getElementById('btn-refresh-artifacts'),
  modalContainer: document.getElementById('modal-container')
};

// ============================================================================
// 图标注入初始化
// ============================================================================
function initIcons() {
  document.getElementById('icon-nav-chat').innerHTML = Icons.chat(20);
  document.getElementById('icon-nav-goals').innerHTML = Icons.goals(20);
  document.getElementById('icon-nav-memory').innerHTML = Icons.memory(20);
  document.getElementById('icon-nav-ladder').innerHTML = Icons.ladder(20);
  document.getElementById('icon-nav-artifacts').innerHTML = Icons.artifacts(20);

  document.getElementById('icon-taint-clean').innerHTML = Icons.shield(12);
  document.getElementById('icon-sandbox').innerHTML = Icons.terminal(12);
  document.getElementById('icon-lock').innerHTML = Icons.lock(12);
  document.getElementById('icon-dropdown').innerHTML = Icons.chevronDown(12);
  document.getElementById('icon-send').innerHTML = Icons.send(14);

  document.getElementById('icon-goals-heading').innerHTML = Icons.goals(22);
  document.getElementById('icon-memory-heading').innerHTML = Icons.memory(22);
  document.getElementById('icon-undo').innerHTML = Icons.undo(14);
  document.getElementById('icon-sparkles-dry').innerHTML = Icons.sparkles(14);
  document.getElementById('icon-sparkles-run').innerHTML = Icons.sparkles(14);

  document.getElementById('icon-ladder-heading').innerHTML = Icons.ladder(22);
  document.getElementById('icon-shield-sandbox').innerHTML = Icons.shield(18);
  document.getElementById('icon-refresh').innerHTML = Icons.refresh(14);
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
    if (name === tabName) {
      el.style.display = name === 'chat' ? 'flex' : 'block';
    } else {
      el.style.display = 'none';
    }
  });

  // 切换视窗时按需刷新数据
  if (tabName === 'goals') loadGoals();
  if (tabName === 'memory') loadMemory();
  if (tabName === 'skills') loadSandboxStatus();
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
        <div class="bot-name">${bot.name}</div>
        <div class="bot-desc">${bot.role || bot.description || '数字员工'}</div>
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

  // 加载该 Bot 下的专属会话
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
      <span style="overflow: hidden; text-overflow: ellipsis;">${s.title || '新任务会话'}</span>
      <span style="font-size: 10px; color: var(--text-dim);">${s.messageCount || 0}条</span>
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

// 切换门禁级别 (Approval Mode Selector - OpenMausBot 风格)
async function cycleApprovalMode() {
  const bot = state.bots.find((b) => b.id === state.activeBotId);
  if (!bot) return;

  const modes = ['ask', 'auto_edits', 'full'];
  const curIdx = modes.indexOf(bot.approval_level || 'ask');
  const nextMode = modes[(curIdx + 1) % modes.length];

  bot.approval_level = nextMode;
  dom.approvalModeText.textContent = `${nextMode.toUpperCase()} 门禁`;
  renderBotList();
}

// 刷新污点状态徽标 (Taint Tracking Badge)
function updateTaintBadge(isTainted, reason = '') {
  state.isTainted = isTainted;
  if (isTainted) {
    dom.taintBadgeContainer.innerHTML = `
      <span class="pill-badge pill-red" title="会话已读取敏感数据 (${reason})，凡试图进行外网出站或发信一律阻断审批">
        ${Icons.shieldAlert(12)} 污染态 (Tainted)
      </span>
    `;
  } else {
    dom.taintBadgeContainer.innerHTML = `
      <span class="pill-badge pill-green" title="会话未读取内部私有涉密数据，网络安全">
        ${Icons.shield(12)} 纯净态 (Untainted)
      </span>
    `;
  }
}

// ============================================================================
// 2. 实时流式对话工作台 (Chat & SSE Streaming & Approval Cards)
// ============================================================================
function renderChatMessages() {
  dom.chatMessages.innerHTML = '';
  if (state.messages.length === 0) {
    dom.chatMessages.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); margin: auto; padding: 40px;">
        <div style="font-size: 32px; margin-bottom: 12px;">🐾</div>
        <div style="font-size: 15px; font-weight: 600; color: var(--text-muted);">随时为您服务</div>
        <div style="font-size: 13px; margin-top: 6px;">输入指令即可调遣数字员工执行任务、自动分析或沉淀工件</div>
      </div>
    `;
    return;
  }

  state.messages.forEach((msg) => {
    appendMessageBubble(msg.role, msg.content, msg.extra);
  });
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function appendMessageBubble(role, content, extra = {}) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const bot = state.bots.find((b) => b.id === state.activeBotId);
  const avatar = role === 'user' ? '👤' : (bot ? bot.avatar || '🤖' : '🤖');

  let bubbleHtml = `<div class="message-bubble">${escapeHtml(content || '')}</div>`;

  row.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    ${bubbleHtml}
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
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        session_id: state.activeSessionId,
        bot_id: state.activeBotId
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // 保留不完整块

      for (const block of lines) {
        const line = block.trim();
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6);
        try {
          const event = JSON.parse(jsonStr);
          handleStreamEvent(event, { streamTextEl, activityContainer, planContainer });
          if (event.type === 'stream:text-delta') {
            fullAssistantText += event.text;
          }
        } catch (e) {
          console.warn('解析流式事件错误:', e);
        }
      }
    }

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
            <span style="color: ${s.status === 'done' ? 'var(--text-muted)' : 'var(--text-main)'}; text-decoration: ${s.status === 'done' ? 'line-through' : 'none'};">${s.description}</span>
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
        <span>⚡ 正在执行工具: <strong>${event.toolName}</strong></span>
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
        <span>⚡ 工具调用完成: <strong>${event.toolName}</strong></span>
        <span style="font-size: 11px; color: var(--text-dim);">${event.durationMs}ms</span>
      `;
    }
  }

  // 微沙箱隔离标记 (sandbox:execution)
  if (event.type === 'sandbox:execution') {
    const sbBadge = document.createElement('div');
    sbBadge.style = 'margin: 6px 0; font-size: 11px; color: var(--accent-blue); display: flex; align-items: center; gap: 6px;';
    sbBadge.innerHTML = `
      ${Icons.shield(12)} 
      <span>[Bubblewrap 微沙箱] 隔离执行 Shell: ${escapeHtml(event.command.slice(0, 30))} (网络阻断: ${event.networkBlocked ? '已激活' : '放行'})</span>
    `;
    activityContainer.appendChild(sbBadge);
  }

  // 动态污点打标 (sentinel:taint_updated)
  if (event.type === 'sentinel:taint_updated') {
    updateTaintBadge(event.isTainted, event.reason);
  }

  // Sentinel 门禁审批拦截卡片 (sentinel:approval_needed - OpenMausBot 风格)
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
      ${request.targetDetails.command ? `<div><strong>目标命令:</strong> ${escapeHtml(request.targetDetails.command)}</div>` : ''}
      ${request.targetDetails.parameters ? `<div><strong>操作参数:</strong> ${escapeHtml(JSON.stringify(request.targetDetails.parameters))}</div>` : ''}
    </div>
    <div class="approval-actions" id="actions-${request.approvalId}">
      <button class="btn-reject" onclick="window.resolveApproval('${request.approvalId}', false)">
        ${Icons.x(14)} 拒绝拦截 (Reject)
      </button>
      <button class="btn-approve" onclick="window.resolveApproval('${request.approvalId}', true)">
        ${Icons.check(14)} 批准执行 (Approve)
      </button>
    </div>
  `;

  container.appendChild(card);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

// 暴露全局解挂审批处理函数
window.resolveApproval = async function (approvalId, approved) {
  const actionContainer = document.getElementById(`actions-${approvalId}`);
  if (actionContainer) {
    actionContainer.innerHTML = `<span style="font-size: 12px; color: ${approved ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: 600;">已${approved ? '批准' : '拒绝'}</span>`;
  }

  try {
    await fetch(`/api/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved })
    });
  } catch (err) {
    console.error('处理审批失败:', err);
  }
};

// ============================================================================
// 3. 长周期目标管理 (Goals - nanoMuse 风格)
// ============================================================================
async function loadGoals() {
  try {
    const res = await fetch('/api/goals');
    const goals = await res.json();
    state.goals = goals;
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
            <div style="font-weight: 500; color: ${step.status === 'blocked' ? 'var(--accent-red)' : 'var(--text-main)'};">步骤 ${idx + 1}: ${step.title}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${step.description || ''}</div>
          </div>
        </div>
      `;
    }).join('');

    // 如果处于 blocked 且有活跃提案 (Proposal)
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
          <div class="goal-title">${goal.title}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${goal.description || ''}</div>
        </div>
        <span class="pill-badge ${statusPill}">${goal.status.toUpperCase()}</span>
      </div>

      <div style="font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
        ${Icons.clock(13)} 巡检周期: <strong style="color: var(--text-main);">${goal.cadence || '单次任务'}</strong>
      </div>

      <div class="goal-steps-timeline">
        ${stepsHtml}
      </div>

      ${proposalHtml}

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
        <span style="font-size: 11px; color: var(--text-dim);">责任 Bot: ${goal.botId}</span>
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

// ============================================================================
// 4. 受控长期记忆与整理 (Memory & Consolidation - nanoMuse 风格)
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
    dom.memoryItemsList.innerHTML = '<div style="color: var(--text-dim); padding: 20px; text-align: center;">当前 Bot 暂无常驻记忆条目</div>';
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

  // 渲染历史整理审计列表
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
      alert(`记忆整理完成！\n操作计划: 合并 ${data.report.merged_count} 条，清除 ${data.report.dropped_count} 条，受死线保护未变动项 ${data.report.rejected_count} 条`);
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

// ============================================================================
// 5. 技能成本阶梯与微沙箱看板 (Ladder & MicroSandbox)
// ============================================================================
async function loadSandboxStatus() {
  try {
    const res = await fetch('/api/sandbox/status');
    const data = await res.json();
    state.sandboxStatus = data.microSandbox;
    state.channelLadder = data.channelLadder;

    renderSandboxDetails();
    renderLadderRungs();
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
  if (!state.channelLadder) return;
  const details = state.channelLadder.details || {};

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

// ============================================================================
// 6. 交付工件与产出物展台 (Artifacts)
// ============================================================================
async function loadArtifacts() {
  try {
    const res = await fetch('/api/artifacts');
    const files = await res.json();
    state.artifacts = files;
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
    card.onclick = () => window.open(art.url, '_blank');
    card.innerHTML = `
      <div style="font-size: 24px;">📄</div>
      <div style="font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis;">${art.name}</div>
      <div style="font-size: 11px; color: var(--text-dim);">${art.size} 字节 | 点击查看或下载</div>
    `;
    dom.artifactsContainer.appendChild(card);
  });
}

// ============================================================================
// 辅助工具与事件绑定
// ============================================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initEventHandlers() {
  dom.navItems.forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  dom.btnNewSession.onclick = createNewSession;
  dom.approvalModeBtn.onclick = cycleApprovalMode;

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

  dom.btnDryRunMemory.onclick = () => triggerConsolidation(true);
  dom.btnRunConsolidate.onclick = () => triggerConsolidation(false);
  dom.btnUndoMemory.onclick = undoConsolidation;

  dom.btnRefreshSandbox.onclick = loadSandboxStatus;
  dom.btnRefreshArtifacts.onclick = loadArtifacts;

  // 创建新长周期目标模态框
  dom.btnCreateGoal.onclick = () => {
    const title = prompt('请输入新目标名称 (例如: 企业前端核心库升级 React 19):');
    if (!title) return;
    const cadence = prompt('请输入巡检推进周期 (例如: weekdays 09:30 或 daily 09:00):', 'weekdays 09:30');
    if (!cadence) return;

    fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        cadence,
        bot_id: state.activeBotId || 'ops_bot',
        steps: [
          { title: '阶段调研与依赖排查', description: '梳理现有依赖并确认版本兼容性' },
          { title: '核心模块适配与功能验证', description: '修改核心接口并执行单元测试' },
          { title: '生产灰度发布与监控巡检', description: '小流量灰度观察报警并全量上线' }
        ]
      })
    }).then(() => loadGoals());
  };
}

// 启动入口
initIcons();
initEventHandlers();
loadBots();
