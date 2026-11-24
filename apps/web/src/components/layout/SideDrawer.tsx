import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { BotAvatar } from '../common/BotAvatar';
import { Plus, Trash2, MessageSquare, Search, X, Home, RotateCcw } from 'lucide-react';

export const SideDrawer: React.FC = () => {
  const {
    bots,
    activeBotId,
    activeBot,
    selectBot,
    mainSession,
    sideSessions,
    activeSessionId,
    isMainChat,
    selectSession,
    switchToMainChat,
    createNewSession,
    createNewSideChat,
    deleteSession,
    isDrawerCollapsed,
    isMobileDrawerOpen,
    setIsMobileDrawerOpen,
    tab,
    setTab,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const closeMobileDrawer = () => setIsMobileDrawerOpen(false);

  const filteredBots = useMemo(() => {
    if (!searchQuery.trim()) return bots;
    const q = searchQuery.toLowerCase().trim();
    return bots.filter(
      (b) => b.name?.toLowerCase().includes(q) || b.role?.toLowerCase().includes(q)
    );
  }, [bots, searchQuery]);

  const filteredSideSessions = useMemo(() => {
    if (!searchQuery.trim()) return sideSessions;
    const q = searchQuery.toLowerCase().trim();
    return sideSessions.filter((s) => s.title?.toLowerCase().includes(q));
  }, [sideSessions, searchQuery]);

  if (tab !== 'chat' && tab !== 'memory') return null;

  const handleDeleteClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirmDeleteId === sessionId) {
      deleteSession(sessionId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(sessionId);
      // 3秒后自动恢复
      setTimeout(() => {
        setConfirmDeleteId((cur) => (cur === sessionId ? null : cur));
      }, 3000);
    }
  };

  return (
    <>
      {isMobileDrawerOpen && (
        <div className="drawer-scrim" onClick={closeMobileDrawer} aria-hidden="true" />
      )}
      <aside
        className={`side-drawer ${isDrawerCollapsed ? 'drawer-collapsed' : ''} ${
          isMobileDrawerOpen ? 'mobile-open' : ''
        }`}
        aria-label="数字员工与会话列表"
      >
        {/* 顶部标题与快速检索 */}
        <div className="drawer-header">
          <div className="drawer-title-row">
            <span className="drawer-title">{tab === 'memory' ? '数字员工记忆库' : '数字员工'}</span>
            <span className="pill-badge pill-blue" title={`${bots.length} 个数字员工就绪`}>
              {bots.length}
            </span>
          </div>

          <div className="drawer-search-wrapper">
            <Search size={13} className="drawer-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="drawer-search-input"
              placeholder="搜索员工或会话..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="搜索数字员工或会话历史"
            />
            {searchQuery && (
              <button
                type="button"
                className="drawer-search-clear"
                onClick={() => setSearchQuery('')}
                title="清空搜索"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* 数字员工列表 */}
        <div className="bot-list" role="listbox" aria-label="数字员工列表">
          {filteredBots.length === 0 ? (
            <div className="drawer-empty-hint">未找到匹配的数字员工</div>
          ) : (
            filteredBots.map((bot) => {
              const isActive = bot.id === activeBotId;

              return (
                <div
                  key={bot.id}
                  className={`bot-card ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    selectBot(bot.id);
                    if (tab !== 'chat' && tab !== 'memory') {
                      setTab('chat');
                    }
                    closeMobileDrawer();
                  }}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      selectBot(bot.id);
                      if (tab !== 'chat' && tab !== 'memory') setTab('chat');
                      closeMobileDrawer();
                    }
                  }}
                >
                  <div className="bot-avatar-wrap">
                    <BotAvatar bot={bot} size={34} still />
                    <span className="bot-online-indicator" aria-hidden="true" />
                  </div>
                  <div className="bot-info">
                    <div className="bot-name">{bot.name}</div>
                    <div className="bot-desc">{bot.role || '智能协同'}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 会话分区：主聊置顶常驻 + 独立旁聊列表 (仅对话 Tab 下呈现) */}
        {tab === 'chat' && (
          <div className="session-section">
            {/* 1. 常驻主聊 (Main Chat) 卡片 */}
            <div className="main-chat-container">
              <div className="section-label">核心工作流</div>
              <div
                className={`main-chat-card ${isMainChat ? 'active' : ''}`}
                onClick={() => {
                  switchToMainChat();
                  closeMobileDrawer();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    switchToMainChat();
                    closeMobileDrawer();
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="主要常驻主聊会话"
              >
                <div className="main-chat-left">
                  <div className="main-chat-icon-wrap">
                    <Home size={15} />
                  </div>
                  <div className="main-chat-info">
                    <div className="main-chat-title-row">
                      <span className="main-chat-title">
                        {activeBot?.name ? `${activeBot.name} · 主聊` : '主要聊天'}
                      </span>
                      <span className="pill-badge pill-blue thread-pill">主聊</span>
                    </div>
                    <span className="main-chat-desc">常驻上下文 · 核心任务推演</span>
                  </div>
                </div>

                {mainSession && (
                  <button
                    type="button"
                    className={`session-delete-btn ${confirmDeleteId === mainSession.id ? 'confirming' : ''}`}
                    title={confirmDeleteId === mainSession.id ? '点击确认重置清空主聊历史' : '清空主聊历史'}
                    aria-label={confirmDeleteId === mainSession.id ? '确认重置主聊' : '重置主聊'}
                    onClick={(e) => handleDeleteClick(e, mainSession.id)}
                  >
                    {confirmDeleteId === mainSession.id ? (
                      <span className="session-delete-confirm-text">清空?</span>
                    ) : (
                      <RotateCcw size={12} />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* 2. 旁聊区域 (Side Chats) */}
            <div className="side-chats-header">
              <div className="side-chats-header-left">
                <span className="session-header-title">独立旁聊</span>
                <span className="pill-badge pill-neutral side-count-badge">
                  {sideSessions.length}
                </span>
              </div>
              <button
                type="button"
                className="btn-new-session"
                onClick={() => {
                  createNewSideChat();
                  closeMobileDrawer();
                }}
                title="开启独立旁聊任务，不干扰主聊记忆"
                aria-label="新建旁聊"
              >
                <Plus size={13} />
                <span>新旁聊</span>
              </button>
            </div>

            <div className="session-list" role="listbox" aria-label="旁聊会话列表">
              {filteredSideSessions.length === 0 ? (
                <div className="session-empty-state">
                  <div className="session-empty-icon">
                    <MessageSquare size={20} />
                  </div>
                  <div className="session-empty-text">
                    {searchQuery ? '未找到相关旁聊' : '暂无独立旁聊'}
                  </div>
                  {!searchQuery && (
                    <>
                      <div className="session-empty-sub">
                        开启独立旁聊处理副任务，不污染主聊上下文与记忆。
                      </div>
                      <button
                        type="button"
                        className="session-empty-action"
                        onClick={() => {
                          createNewSideChat();
                          closeMobileDrawer();
                        }}
                      >
                        <Plus size={12} /> 发起旁聊
                      </button>
                    </>
                  )}
                </div>
              ) : (
                filteredSideSessions.map((sess) => {
                  const isActive = sess.id === activeSessionId;
                  const isConfirming = confirmDeleteId === sess.id;

                  return (
                    <div
                      key={sess.id}
                      className={`session-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        selectSession(sess.id);
                        closeMobileDrawer();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectSession(sess.id);
                          closeMobileDrawer();
                        }
                      }}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={0}
                    >
                      <div className="session-main">
                        <MessageSquare size={13} className="session-icon" aria-hidden="true" />
                        <span className="session-title" title={sess.title || '新旁聊'}>
                          {sess.title || '新旁聊'}
                        </span>
                      </div>

                      <button
                        type="button"
                        className={`session-delete-btn ${isConfirming ? 'confirming' : ''}`}
                        title={isConfirming ? '点击确认删除旁聊' : '删除旁聊'}
                        aria-label={isConfirming ? '确认删除旁聊' : '删除旁聊'}
                        onClick={(e) => handleDeleteClick(e, sess.id)}
                      >
                        {isConfirming ? (
                          <span className="session-delete-confirm-text">确认?</span>
                        ) : (
                          <Trash2 size={12} />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
