import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Rss, Clock, Settings, Sparkles, RefreshCw, MessageSquare } from 'lucide-react';
import type { FeedPost, FeedActivity } from '../../types';
import { api } from '../../services/api';
import { renderMarkdown } from '../../utils/markdown';
import { formatTime } from '../../utils/format';

export const FeedView: React.FC = () => {
  const { setTab, selectSession, showToast } = useApp();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [activities, setActivities] = useState<FeedActivity[]>([]);
  const [isWriting, setIsWriting] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadFeed = async () => {
    setLoading(true);
    try {
      const [feedData, actData] = await Promise.all([api.getFeed(), api.getFeedActivities()]);
      setPosts(feedData.posts || []);
      setActivities(Array.isArray(actData) ? actData : []);
    } catch (err: any) {
      console.error('Failed to load feed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed();
  }, []);

  const handleWriteNow = async () => {
    setIsWriting(true);
    showToast('智能体正在根据近期记忆与工作记录撰写动态...', 'info');
    try {
      const newPost = await api.triggerFeedWrite();
      if (newPost) {
        setPosts((prev) => [newPost, ...prev]);
        showToast('新动态已生成并沉淀！', 'success');
      }
    } catch (err: any) {
      showToast(`生成动态失败: ${err.message}`, 'error');
    } finally {
      setIsWriting(false);
    }
  };

  return (
    <section className="view-stage">
      <div className="view-header">
        <div>
          <div className="view-heading">
            <Rss size={18} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }} />
            智能体动态 (Feed)
          </div>
          <div className="view-sub">基于您的工作习惯、长期记忆、近期对话与目标自动提炼的每日动态简报</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setTab('routines')}
            title="配置与管理定时任务"
          >
            <Clock size={14} /> 定时任务
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleWriteNow}
            disabled={isWriting}
            title="立即触发智能体撰写新动态"
          >
            <Sparkles size={14} /> {isWriting ? '撰写中...' : '立即撰写'}
          </button>
        </div>
      </div>

      <div className="feed-layout">
        <div className="feed-main-col">
          {posts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-dim)' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>📰</div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-muted)' }}>暂无动态条目</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>
                点击右上角“立即撰写”，智能体将基于近期活动与目标自动归纳动态。
              </div>
            </div>
          ) : (
            posts.map((post) => (
              <div
                key={post.id}
                className="feed-post-card"
                style={{
                  background: 'var(--om-surface)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>{post.area || '📝'}</span>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{post.title}</h4>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{post.date}</span>
                </div>

                <div
                  className="feed-post-content"
                  style={{ fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-main)' }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
                />

                {post.tags && post.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
                    {post.tags.map((tag, idx) => (
                      <span key={idx} className="pill-badge pill-blue" style={{ fontSize: '11px' }}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          {/* While you were away */}
          <div className="feed-activity-section" style={{ marginTop: '32px' }}>
            <div className="feed-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span className="feed-section-title" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>
                在你离开时 (WHILE YOU WERE AWAY)
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={loadFeed}
                style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <RefreshCw size={11} /> 刷新
              </button>
            </div>

            <div className="feed-activity-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {activities.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', padding: '12px 0' }}>暂无后台执行动态</div>
              ) : (
                activities.map((act) => (
                  <div
                    key={act.id}
                    className="feed-activity-item"
                    onClick={() => {
                      if (act.sessionId) {
                        selectSession(act.sessionId);
                        setTab('chat');
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'var(--om-surface)',
                      border: '1px solid var(--om-border)',
                      borderRadius: '8px',
                      cursor: act.sessionId ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="pill-badge pill-blue" style={{ fontSize: '11px' }}>{act.botName || 'Bot'}</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-main)' }}>{act.summary}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{formatTime(act.timestamp)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
