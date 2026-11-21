import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Rss,
  Clock,
  Sparkles,
  RefreshCw,
  MessageSquare,
  ShieldAlert,
  FileText,
  Trash2,
  ArrowRight,
} from 'lucide-react';
import type { FeedPost, FeedActivity } from '../../types';
import { api } from '../../services/api';
import { renderMarkdown } from '../../utils/markdown';
import { formatRelativeTime } from '../../utils/format';

const AREA_CONFIG: Record<string, { emoji: string; label: string }> = {
  planning: { emoji: '🗓️', label: '规划巡检' },
  research: { emoji: '🔍', label: '技术调研' },
  goals: { emoji: '🎯', label: '目标推进' },
  money: { emoji: '💰', label: '预算资产' },
  health: { emoji: '🌿', label: '运维健康' },
  home: { emoji: '🏠', label: '环境设施' },
  learning: { emoji: '📚', label: '知识沉淀' },
  people: { emoji: '👥', label: '协作对接' },
  files: { emoji: '📄', label: '工件交付' },
  fun: { emoji: '🎈', label: '灵感探索' },
};

const KIND_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  chat: { icon: <MessageSquare size={15} />, label: '对话互动' },
  goal: { icon: <Sparkles size={15} />, label: '自驱目标' },
  routine: { icon: <Clock size={15} />, label: '定时任务' },
  approval: { icon: <ShieldAlert size={15} />, label: '门禁审批' },
  artifact: { icon: <FileText size={15} />, label: '工件交付' },
};

/** 单条动态卡片（memo：父组件状态变化时不重复渲染/解析 Markdown） */
const FeedPostCard = React.memo<{
  post: FeedPost;
  html: string;
  onDelete: (postId: string) => void;
  onDiscuss: (post: FeedPost) => void;
}>(({ post, html, onDelete, onDiscuss }) => {
  const area = AREA_CONFIG[post.area || ''] || { emoji: '📝', label: '工作动态' };
  const postDate = formatRelativeTime(post.ts || post.date);

  return (
    <div className="feed-card feed-post-card">
      <div className="feed-post-top">
        <div className="feed-area-badge" title={area.label}>
          {area.emoji}
        </div>
        <div className="feed-post-content">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginBottom: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
              <h3 className="feed-post-title" style={{ margin: 0 }}>
                {post.title}
              </h3>
              <span className="pill-badge pill-blue" style={{ fontSize: '11px', padding: '2px 8px', flexShrink: 0 }}>
                {area.label}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span style={{ fontSize: '12px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{postDate}</span>
              <button
                type="button"
                className="btn-icon"
                title="删除此动态"
                aria-label={`删除动态 ${post.title}`}
                style={{ opacity: 0.6, padding: '4px' }}
                onClick={() => onDelete(post.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          <div className="feed-post-body markdown-body" dangerouslySetInnerHTML={{ __html: html }} />

          {post.tags && post.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
              {post.tags.map((tag, idx) => (
                <span key={idx} className="pill-badge pill-blue" style={{ fontSize: '11px' }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {post.prompt && (
            <div className="feed-post-actions">
              <button
                type="button"
                className="feed-action-btn"
                onClick={() => onDiscuss(post)}
                title="一键就此条目进入对话深入探讨"
              >
                <MessageSquare size={14} /> 一键跟进讨论
              </button>
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--text-dim)',
                  fontStyle: 'italic',
                  maxWidth: '420px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={post.prompt}
              >
                “{post.prompt}”
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

FeedPostCard.displayName = 'FeedPostCard';

/** 单条后台执行动态（memo） */
const FeedActivityRow = React.memo<{
  act: FeedActivity;
  onOpen: (act: FeedActivity) => void;
}>(({ act, onOpen }) => {
  const kindCfg = KIND_CONFIG[act.kind || act.type || 'chat'] || {
    icon: <Sparkles size={15} />,
    label: act.botName || '智能体',
  };
  const titleText = act.title || act.sessionTitle || act.summary || '动态记录';
  const textSnippet = (act.text || act.summary || '').replace(/[\r\n]+/g, ' ').trim();
  const timeText = formatRelativeTime(act.ts || act.timestamp);
  const clickable = Boolean(act.sessionId);

  return (
    <div
      className="feed-activity-row"
      onClick={() => clickable && onOpen(act)}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen(act);
        }
      }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? '点击跳转查看对应会话' : undefined}
    >
      <div className="feed-activity-icon" title={kindCfg.label}>
        {kindCfg.icon}
      </div>
      <div className="feed-activity-body">
        <div className="feed-activity-title-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span
              className="feed-activity-title"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {titleText}
            </span>
            <span
              className="pill-badge pill-blue"
              style={{ fontSize: '10px', padding: '1px 6px', flexShrink: 0 }}
            >
              {kindCfg.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span className="feed-activity-time">{timeText}</span>
            {act.sessionId && <ArrowRight size={12} style={{ color: 'var(--text-dim)' }} />}
          </div>
        </div>
        {textSnippet && (
          <div className="feed-activity-text" title={textSnippet}>
            {textSnippet}
          </div>
        )}
      </div>
    </div>
  );
});

FeedActivityRow.displayName = 'FeedActivityRow';

export const FeedView: React.FC = () => {
  const { setTab, selectSession, showToast } = useApp();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [activities, setActivities] = useState<FeedActivity[]>([]);
  const [isWriting, setIsWriting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadSeq = useRef(0);

  const loadFeed = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const [feedData, actData] = await Promise.all([api.getFeed(), api.getFeedActivities()]);
      if (seq !== loadSeq.current) return;
      setPosts(Array.isArray(feedData?.posts) ? feedData.posts : []);
      setActivities(Array.isArray(actData) ? actData : []);
    } catch (err: any) {
      if (seq !== loadSeq.current) return;
      console.error('Failed to load feed:', err);
      showToast('获取动态数据异常', 'error');
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [showToast]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const handleWriteNow = useCallback(async () => {
    setIsWriting(true);
    showToast('智能体正在根据近期记忆与工作记录撰写动态...', 'info');
    try {
      const result: any = await api.triggerFeedWrite();
      if (result?.posts && Array.isArray(result.posts)) {
        setPosts(result.posts);
        showToast('新动态已生成并沉淀！', 'success');
      } else if (result?.id) {
        setPosts((prev) => [result, ...prev]);
        showToast('新动态已生成并沉淀！', 'success');
      } else {
        await loadFeed();
        showToast('动态已刷新！', 'success');
      }
    } catch (err: any) {
      showToast(`生成动态失败: ${err.message}`, 'error');
    } finally {
      setIsWriting(false);
    }
  }, [loadFeed, showToast]);

  const handleDeletePost = useCallback(
    async (postId: string) => {
      try {
        await api.deleteFeedPost(postId);
        setPosts((prev) => prev.filter((p) => p.id !== postId));
        showToast('动态条目已删除', 'success');
      } catch (err: any) {
        showToast(`删除失败: ${err.message}`, 'error');
      }
    },
    [showToast]
  );

  const handleDiscuss = useCallback(
    (post: FeedPost) => {
      if (post.sessionId) {
        selectSession(post.sessionId);
      }
      setTab('chat');
      showToast(`已就「${post.title}」进入对话`, 'info');
    },
    [selectSession, setTab, showToast]
  );

  const handleOpenActivity = useCallback(
    (act: FeedActivity) => {
      if (act.sessionId) {
        selectSession(act.sessionId);
        setTab('chat');
      }
    },
    [selectSession, setTab]
  );

  // Markdown 只在 posts 变化时解析一次，避免每次状态切换都重复渲染全部卡片
  const postsWithHtml = useMemo(
    () =>
      posts.map((post) => ({
        post,
        html: renderMarkdown(post.body || post.content || ''),
      })),
    [posts]
  );

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
          <button type="button" className="btn-secondary" onClick={() => setTab('routines')} title="配置与管理定时任务">
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
          {/* Feed Posts */}
          {!loaded && posts.length === 0 ? (
            <div className="feed-loading chat-loading" role="status" aria-live="polite">
              <span className="chat-loading-dot" />
              正在获取动态…
            </div>
          ) : posts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-dim)' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>📰</div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-muted)' }}>暂无动态条目</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>
                点击右上角“立即撰写”，智能体将基于近期活动与目标自动归纳动态。
              </div>
            </div>
          ) : (
            postsWithHtml.map(({ post, html }, idx) => (
              <FeedPostCard
                key={post.id || `post-${idx}`}
                post={post}
                html={html}
                onDelete={handleDeletePost}
                onDiscuss={handleDiscuss}
              />
            ))
          )}

          {/* While you were away (在你离开时) */}
          <div className="feed-activity-section" style={{ marginTop: '32px' }}>
            <div className="feed-section-header">
              <span className="feed-section-title">
                在你离开时 (WHILE YOU WERE AWAY)
                {activities.length > 0 && (
                  <span style={{ marginLeft: '8px', fontWeight: 'normal', opacity: 0.7 }}>
                    ({activities.length})
                  </span>
                )}
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={loadFeed}
                disabled={loading}
                style={{ padding: '3px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <RefreshCw size={11} className={loading ? 'tool-spin' : ''} /> 刷新
              </button>
            </div>

            <div className="feed-activity-list">
              {activities.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', padding: '16px 0', textAlign: 'center' }}>
                  {loaded ? '暂无后台执行动态' : '正在获取后台执行动态…'}
                </div>
              ) : (
                activities.map((act, idx) => (
                  <FeedActivityRow key={act.id || `act-${idx}`} act={act} onOpen={handleOpenActivity} />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
