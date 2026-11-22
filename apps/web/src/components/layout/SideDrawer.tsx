import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { BotAvatar } from '../common/BotAvatar';
import { Plus, Trash2, MessageSquare, Search, X } from 'lucide-react';

export const SideDrawer: React.FC = () => {
  const {
    bots,
    activeBotId,
    selectBot,
    sessions,
    activeSessionId,
    selectSession,
    createNewSession,
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

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase().trim();
    return sessions.filter((s) => s.title?.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

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
              const approvalClass =
                bot.approvalMode === 'FULL'
                  ? 'pill-green'
                  : bot.approvalMode === 'AUTO_EDITS'
                  ? 'pill-blue'
                  : 'pill-amber';

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
                  <span className={`pill-badge ${approvalClass} bot-approval-pill`}>
                    {bot.approvalMode || 'ASK'}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* 会话历史列表 (仅对话 Tab 下呈现) */}
        {tab === 'chat' && (
          <div className="session-section">
            <div className="session-header">
              <span className="session-header-title">历史会话</span>
              <button
                type="button"
                className="btn-new-session"
                onClick={() => {
                  createNewSession();
                  closeMobileDrawer();
                }}
                title="创建新会话"
                aria-label="创建新会话"
              >
                <Plus size={13} />
                <span>新建</span>
              </button>
            </div>

            <div className="session-list" role="listbox" aria-label="会话历史">
              {filteredSessions.length === 0 ? (
                <div className="session-empty-state">
                  <div className="session-empty-icon">
                    <MessageSquare size={20} />
                  </div>
                  <div className="session-empty-text">
                    {searchQuery ? '未找到相关会话' : '暂无历史会话'}
                  </div>
                  {!searchQuery && (
                    <button
                      type="button"
                      className="session-empty-action"
                      onClick={() => createNewSession()}
                    >
                      <Plus size={12} /> 发起对话
                    </button>
                  )}
                </div>
              ) : (
                filteredSessions.map((sess) => {
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
                      role="option"
                      aria-selected={isActive}
                      tabIndex={0}
                    >
                      <div className="session-main">
                        <MessageSquare size={13} className="session-icon" aria-hidden="true" />
                        <span className="session-title" title={sess.title || '新会话'}>
                          {sess.title || '新会话'}
                        </span>
                      </div>

                      <button
                        type="button"
                        className={`session-delete-btn ${isConfirming ? 'confirming' : ''}`}
                        title={isConfirming ? '点击确认删除' : '删除会话'}
                        aria-label={isConfirming ? '确认删除会话' : '删除会话'}
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
