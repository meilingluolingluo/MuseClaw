import React from 'react';
import { useApp } from '../../context/AppContext';
import { BotAvatar } from '../common/BotAvatar';
import { Plus, Trash2, MessageSquare } from 'lucide-react';

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
    tab,
    setTab,
  } = useApp();

  const isVisible = (tab === 'chat' || tab === 'memory') && !isDrawerCollapsed;
  if (!isVisible) return null;

  return (
    <aside
      className={`side-drawer ${isDrawerCollapsed ? 'collapsed' : ''}`}
      style={isDrawerCollapsed ? { display: 'none' } : {}}
    >
      <div className="drawer-header">
        <span className="drawer-title">{tab === 'memory' ? '选择数字员工' : '数字员工 (Bots)'}</span>
        <span className="pill-badge pill-blue">{bots.length} 个活跃</span>
      </div>

      <div className="bot-list">
        {bots.map((bot) => {
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
              }}
              style={{ cursor: 'pointer' }}
            >
              <div className="bot-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BotAvatar bot={bot} size={36} still />
              </div>
              <div className="bot-info">
                <div className="bot-name">{bot.name}</div>
                <div className="bot-desc">{bot.role || '数字员工'}</div>
              </div>
              <span className={`pill-badge ${approvalClass}`} style={{ fontSize: '10px' }}>
                {bot.approvalMode || 'ASK'}
              </span>
            </div>
          );
        })}
      </div>

      {tab === 'chat' && (
        <div className="session-section">
          <div className="session-header">
            <span>会话历史 (SESSIONS)</span>
            <button
              type="button"
              className="btn-secondary"
              onClick={createNewSession}
              style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Plus size={12} /> 新建
            </button>
          </div>

          <div className="session-list">
            {sessions.length === 0 ? (
              <div style={{ padding: '16px 8px', fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center' }}>
                暂无历史会话
              </div>
            ) : (
              sessions.map((sess) => {
                const isActive = sess.id === activeSessionId;
                return (
                  <div
                    key={sess.id}
                    className={`session-item ${isActive ? 'active' : ''}`}
                    onClick={() => selectSession(sess.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                      <MessageSquare size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
                      <span className="session-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {sess.title || '新会话'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="session-delete-btn"
                      title="删除会话"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('确定要删除此会话历史吗？')) {
                          deleteSession(sess.id);
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: '2px',
                        cursor: 'pointer',
                        opacity: 0.5,
                        color: 'var(--text-muted)',
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
