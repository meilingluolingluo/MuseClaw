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
  Check,
  X,
  AlertTriangle,
  Heart,
  ExternalLink,
  SlidersHorizontal,
  BellRing,
  ThumbsDown,
} from 'lucide-react';
import type { FeedPost, FeedActivity, ProactiveStatus } from '../../types';
import { api } from '../../services/api';
import { renderMarkdown } from '../../utils/markdown';
import { formatRelativeTime } from '../../utils/format';
import { Modal } from '../common/Modal';

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
  isConfirmingDelete?: boolean;
  onDelete: (postId: string) => void;
  onDiscuss: (post: FeedPost) => void;
  onLike: (postId: string) => void;
  onDismiss: (postId: string) => void;
}>(({ post, html, isConfirmingDelete, onDelete, onDiscuss, onLike, onDismiss }) => {
  const area = AREA_CONFIG[post.area || ''] || { emoji: '📝', label: '工作动态' };
  const postDate = formatRelativeTime(post.ts || post.date);
  const sourceLabel = useMemo(() => {
    if (post.sourceName) return post.sourceName;
    if (!post.sourceUrl) return '';
    try {
      return new URL(post.sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      return '参考链接';
    }
  }, [post.sourceName, post.sourceUrl]);

  return (
    <article className="feed-card feed-post-card">
      <div className="feed-post-top">
        <div className="feed-area-badge" title={area.label}>
          {area.emoji}
        </div>
        <div className="feed-post-content">
          <div className="feed-post-header">
            <div className="feed-post-title-wrap">
              <h3 className="feed-post-title">
                {post.title}
              </h3>
              <span className="pill-badge pill-blue feed-post-area-pill">
                {area.label}
              </span>
              {post.kind === 'intel' && (
                <span className="feed-kind-pill">联网情报</span>
              )}
            </div>
            <div className="feed-post-meta">
              <span className="feed-post-date">{postDate}</span>
              <button
                type="button"
                className={`btn-icon feed-post-delete-btn ${isConfirmingDelete ? 'is-confirming' : ''}`}
                title={isConfirmingDelete ? '再次点击确认删除' : '删除此动态'}
                aria-label={`删除动态 ${post.title}`}
                onClick={() => onDelete(post.id)}
              >
                <Trash2 size={13} />
                {isConfirmingDelete && <span className="inline-confirm-text">确认？</span>}
              </button>
            </div>
          </div>

          {(post.sourceUrl || post.publishedAt) && (
            <div className="feed-post-source-row">
              {post.sourceUrl && (
                <a
                  href={post.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="feed-post-source-link"
                  title={post.sourceUrl}
                >
                  <ExternalLink size={12} />
                  <span>{sourceLabel}</span>
                </a>
              )}
              {post.publishedAt && (
                <span className="feed-post-published-date">
                  发布于 {post.publishedAt.slice(0, 10)}
                </span>
              )}
            </div>
          )}

          <div className="feed-post-body markdown-body" dangerouslySetInnerHTML={{ __html: html }} />

          {post.imageUrl && (
            <div className="feed-post-image-wrap">
              <img
                src={post.imageUrl}
                alt={post.title}
                loading="lazy"
                className="feed-post-cover"
              />
            </div>
          )}

          {post.tags && post.tags.length > 0 && (
            <div className="feed-post-tags">
              {post.tags.map((tag, idx) => (
                <span key={idx} className="pill-badge pill-blue feed-tag-pill">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="feed-post-actions feed-post-footer-bar">
            <button
              type="button"
              className={`feed-feedback-btn ${post.liked ? 'is-liked' : ''}`}
              onClick={() => onLike(post.id)}
              title="点赞后将提高此类兴趣话题权重"
            >
              <Heart size={14} className={post.liked ? 'feed-heart-filled' : ''} />
              <span>{post.liked ? '已赞' : '喜欢'}</span>
            </button>

            <button
              type="button"
              className="feed-action-btn"
              onClick={() => onDiscuss(post)}
              title="一键就此条目进入对话深入探讨"
            >
              <MessageSquare size={14} /> 讨论
            </button>

            <button
              type="button"
              className="feed-feedback-btn is-dismiss"
              onClick={() => onDismiss(post.id)}
              title="减少此类话题推送"
            >
              <ThumbsDown size={13} />
              <span>不感兴趣</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
});

FeedPostCard.displayName = 'FeedPostCard';

/** 单条后台执行动态（memo） */
const FeedActivityRow = React.memo<{
  act: FeedActivity;
  onOpen: (act: FeedActivity) => void;
  onDecision?: (act: FeedActivity, approved: boolean) => void;
}>(({ act, onOpen, onDecision }) => {
  const kindCfg = KIND_CONFIG[act.kind || act.type || 'chat'] || {
    icon: <Sparkles size={15} />,
    label: act.botName || '智能体',
  };
  const titleText = act.title || act.sessionTitle || act.summary || '动态记录';
  const textSnippet = (act.text || act.summary || '').replace(/[\r\n]+/g, ' ').trim();
  const timeText = formatRelativeTime(act.ts || act.timestamp);
  const clickable = Boolean(act.sessionId);
  const isApproval = act.kind === 'approval' || act.type === 'approval';

  return (
    <div
      className={`feed-activity-row ${clickable ? 'is-clickable' : ''}`}
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
          <div className="feed-act-title-group">
            <span className="feed-activity-title">
              {titleText}
            </span>
            <span className="pill-badge pill-blue feed-act-badge">
              {kindCfg.label}
            </span>
          </div>
          <div className="feed-act-time-group">
            <span className="feed-activity-time">{timeText}</span>
            {act.sessionId && <ArrowRight size={12} className="feed-act-arrow" />}
          </div>
        </div>
        {textSnippet && (
          <div className="feed-activity-text" title={textSnippet}>
            {textSnippet}
          </div>
        )}

        {/* 门禁审批内联操作条 */}
        {isApproval && (
          <div
            className="feed-act-approval-bar"
            onClick={(e) => e.stopPropagation()}
          >
            {act.status === 'approved' ? (
              <span className="pill-badge pill-green feed-act-pill-approved">
                <Check size={12} /> 已批准执行
              </span>
            ) : act.status === 'rejected' ? (
              <span className="pill-badge pill-red feed-act-pill-rejected">
                <X size={12} /> 已驳回
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-reject feed-act-btn-reject"
                  onClick={() => onDecision?.(act, false)}
                >
                  <X size={12} /> 驳回
                </button>
                <button
                  type="button"
                  className="btn-approve feed-act-btn-approve"
                  onClick={() => onDecision?.(act, true)}
                >
                  <Check size={12} /> 授权批准
                </button>
              </>
            )}
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const deletePostTimerRef = useRef<any>(null);
  const loadSeq = useRef(0);

  // 动态版块说明 & 主动聊天设置弹窗
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [feedInstructions, setFeedInstructions] = useState('');
  const [feedDaily, setFeedDaily] = useState(true);
  const [feedTime, setFeedTime] = useState('08:00');
  const [proactiveCfg, setProactiveCfg] = useState<ProactiveStatus>({
    enabled: true,
    quietStart: '23:00',
    quietEnd: '07:30',
    lastActiveAt: 0,
    lastBriefAt: 0,
    lastBriefDay: ''
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [checkingBrief, setCheckingBrief] = useState(false);

  const loadFeed = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [feedData, actData, proStatus] = await Promise.all([
        api.getFeed(),
        api.getFeedActivities(),
        api.getProactiveStatus().catch(() => null)
      ]);
      if (seq !== loadSeq.current) return;
      setPosts(Array.isArray(feedData?.posts) ? feedData.posts : []);
      setActivities(Array.isArray(actData) ? actData : []);
      if (feedData?.settings) {
        setFeedInstructions(feedData.settings.instructions || '');
        setFeedDaily(feedData.settings.daily !== false);
        setFeedTime(feedData.settings.time || '08:00');
      }
      if (proStatus) {
        setProactiveCfg(proStatus);
      }
    } catch (err: any) {
      if (seq !== loadSeq.current) return;
      console.error('Failed to load feed:', err);
      setLoadError(err.message || '获取动态数据异常');
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
      if (deletingPostId !== postId) {
        setDeletingPostId(postId);
        if (deletePostTimerRef.current) clearTimeout(deletePostTimerRef.current);
        deletePostTimerRef.current = setTimeout(() => setDeletingPostId(null), 3500);
        return;
      }
      if (deletePostTimerRef.current) clearTimeout(deletePostTimerRef.current);
      setDeletingPostId(null);

      try {
        await api.deleteFeedPost(postId);
        setPosts((prev) => prev.filter((p) => p.id !== postId));
        showToast('动态条目已删除', 'success');
      } catch (err: any) {
        showToast(`删除失败: ${err.message}`, 'error');
      }
    },
    [deletingPostId, showToast]
  );

  const handleDiscuss = useCallback(
    (post: FeedPost) => {
      api.discussFeedPost(post.id).catch(() => {});
      const sourceNote = post.sourceUrl ? `\n参考链接：${post.sourceUrl}` : '';
      const prompt =
        post.prompt ||
        `关于动态【${post.title}】：请结合我的当前工作与关注领域进一步分析，并给出具体落地建议。${sourceNote}`;
      sessionStorage.setItem('museclaw_chat_draft', prompt);
      window.dispatchEvent(new CustomEvent('museclaw:chat_draft', { detail: prompt }));
      if (post.sessionId) {
        selectSession(post.sessionId);
      }
      setTab('chat');
      showToast(`已就「${post.title}」进入对话并记录兴趣偏好`, 'info');
    },
    [selectSession, setTab, showToast]
  );

  const handleLikePost = useCallback(
    async (postId: string) => {
      try {
        const res = await api.likeFeedPost(postId);
        if (res.success && res.post) {
          setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, liked: res.post?.liked } : p)));
          if (res.post.liked) {
            showToast('已点赞，同类感兴趣主题权重已提升', 'success');
          }
        }
      } catch (err: any) {
        showToast(`操作失败: ${err.message}`, 'error');
      }
    },
    [showToast]
  );

  const handleDismissPost = useCallback(
    async (postId: string) => {
      try {
        await api.dismissFeedPost(postId);
        setPosts((prev) => prev.filter((p) => p.id !== postId));
        showToast('已标记不感兴趣，后续将减少同类主题', 'info');
      } catch (err: any) {
        showToast(`操作失败: ${err.message}`, 'error');
      }
    },
    [showToast]
  );

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await Promise.all([
        api.saveFeedSettings({
          instructions: feedInstructions,
          daily: feedDaily,
          time: feedTime
        }),
        api.saveProactiveSettings({
          enabled: proactiveCfg.enabled,
          quietStart: proactiveCfg.quietStart,
          quietEnd: proactiveCfg.quietEnd
        })
      ]);
      setIsSettingsOpen(false);
      showToast('动态版块说明与主动简报设置已保存', 'success');
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCheckProactiveBrief = async () => {
    setCheckingBrief(true);
    try {
      const res = await api.triggerProactiveCheck(true);
      if (res.emitted) {
        showToast(`已生成主动简报（含 ${res.signalCount || 1} 项信号）并推送至主聊`, 'success');
        if (res.sessionId) {
          selectSession(res.sessionId);
          setTab('chat');
        }
      } else {
        showToast('当前暂无到期提醒或新信号，保持静默', 'info');
      }
    } catch (err: any) {
      showToast(`检查简报失败: ${err.message}`, 'error');
    } finally {
      setCheckingBrief(false);
    }
  };

  const handleDecision = useCallback(
    async (act: FeedActivity, approved: boolean) => {
      const actionId = act.approvalId || act.id;
      try {
        await api.sendDecision(act.sessionId || '', actionId, approved ? 'APPROVE' : 'REJECT');
        setActivities((prev) =>
          prev.map((item) =>
            item.id === act.id ? { ...item, status: approved ? 'approved' : 'rejected' } : item
          )
        );
        showToast(approved ? '已批准该审批项' : '已驳回该审批项', 'success');
      } catch (err: any) {
        showToast(`审批处理失败: ${err.message}`, 'error');
      }
    },
    [showToast]
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
    <section className="view-stage feed-stage" aria-label="智能体动态简报">
      <div className="view-header">
        <div>
          <div className="view-heading">
            <Rss size={18} className="view-heading-icon" />
            <span>智能体动态</span>
          </div>
          <div className="view-sub">基于工作习惯、长期记忆、近期对话与目标自动提炼的态势简报</div>
        </div>
        <div className="view-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsSettingsOpen(true)}
            title="设置动态版块说明、每日时间与主动聊天免打扰"
          >
            <SlidersHorizontal size={14} /> 版块说明
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleCheckProactiveBrief}
            disabled={checkingBrief}
            title="立即检查到期事件、目标卡点与新动态，生成主动简报"
          >
            <BellRing size={14} /> {checkingBrief ? '检查中...' : '主动简报'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setTab('routines')} title="配置与管理定时任务">
            <Clock size={14} /> 定时任务
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleWriteNow}
            disabled={isWriting}
            title="立即触发智能体结合兴趣画像与联网搜索撰写新动态"
          >
            <Sparkles size={14} /> {isWriting ? '撰写中...' : '立即撰写'}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="view-load-error is-spaced" role="alert">
          <AlertTriangle size={14} />
          <span>动态数据加载失败：{loadError}</span>
          <button type="button" onClick={loadFeed} disabled={loading}>重试</button>
        </div>
      )}

      <div className="feed-layout">
        <div className="feed-main-col">
          {/* Feed Posts */}
          {!loaded && posts.length === 0 ? (
            <div className="feed-loading chat-loading" role="status" aria-live="polite">
              <span className="chat-loading-dot" />
              正在获取动态…
            </div>
          ) : posts.length === 0 ? (
            <div className="feed-empty-card">
              <div className="feed-empty-icon">
                <Rss size={28} />
              </div>
              <h3 className="feed-empty-title">暂无动态简报</h3>
              <p className="feed-empty-desc">
                点击右上角“立即撰写”，智能体将基于近期任务执行与目标推进自动总结生成动态。
              </p>
            </div>
          ) : (
            postsWithHtml.map(({ post, html }, idx) => (
              <FeedPostCard
                key={post.id || `post-${idx}`}
                post={post}
                html={html}
                isConfirmingDelete={deletingPostId === post.id}
                onDelete={handleDeletePost}
                onDiscuss={handleDiscuss}
                onLike={handleLikePost}
                onDismiss={handleDismissPost}
              />
            ))
          )}

          {/* While you were away (在你离开时) */}
          <div className="feed-activity-section">
            <div className="feed-section-header">
              <span className="feed-section-title">
                在你离开时
                {activities.length > 0 && (
                  <span className="feed-section-count">
                    ({activities.length})
                  </span>
                )}
              </span>
              <button
                type="button"
                className="btn-secondary feed-refresh-btn"
                onClick={loadFeed}
                disabled={loading}
              >
                <RefreshCw size={11} className={loading ? 'tool-spin' : ''} /> 刷新
              </button>
            </div>

            <div className="feed-activity-list">
              {activities.length === 0 ? (
                <div className="feed-activity-empty">
                  {loaded ? '暂无后台执行动态' : '正在获取后台执行动态…'}
                </div>
              ) : (
                activities.map((act, idx) => (
                  <FeedActivityRow
                    key={act.id || `act-${idx}`}
                    act={act}
                    onOpen={handleOpenActivity}
                    onDecision={handleDecision}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      <Modal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        title="动态版块说明与主动简报设置"
        icon={<SlidersHorizontal size={18} />}
        maxWidth="560px"
        footer={
          <div className="modal-actions-bar w-full">
            <div />
            <div className="modal-actions-right">
              <button type="button" className="btn-secondary" onClick={() => setIsSettingsOpen(false)}>
                取消
              </button>
              <button
                type="submit"
                form="feed-settings-form"
                className="btn-primary"
                disabled={savingSettings}
              >
                {savingSettings ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        }
      >
        <form id="feed-settings-form" onSubmit={handleSaveSettings} className="feed-settings-form">
          <p className="feed-settings-desc">
            你的动态版块由以下提示提供支持。你对此提示做出的任何编辑都将应用于今后的动态版块帖子。
          </p>
          <textarea
            className="form-control feed-settings-textarea"
            rows={5}
            value={feedInstructions}
            onChange={(e) => setFeedInstructions(e.target.value)}
            placeholder="例如：为我打造一个关于我兴趣的动态版块，保持内容简短直白，避免标题党，尽量给出真实来源，使用中文展示。"
          />

          <div className="feed-settings-grid">
            <label className="feed-settings-toggle">
              <input
                type="checkbox"
                checked={feedDaily}
                onChange={(e) => setFeedDaily(e.target.checked)}
              />
              <span>每日定时自动更新动态</span>
            </label>
            <div className="feed-settings-time-row">
              <span>每日生成时间</span>
              <input
                type="time"
                className="form-control feed-settings-time-input"
                value={feedTime}
                onChange={(e) => setFeedTime(e.target.value)}
              />
            </div>
          </div>

          <div className="feed-settings-divider" />

          <div className="feed-settings-proactive-block">
            <label className="feed-settings-toggle">
              <input
                type="checkbox"
                checked={proactiveCfg.enabled}
                onChange={(e) => setProactiveCfg((p) => ({ ...p, enabled: e.target.checked }))}
              />
              <span>允许根据记忆、到期日程与目标在主聊主动发简报（有事才开口）</span>
            </label>
            <div className="feed-settings-time-row">
              <span>免打扰时段</span>
              <div className="feed-quiet-range">
                <input
                  type="time"
                  className="form-control feed-settings-time-input"
                  value={proactiveCfg.quietStart}
                  onChange={(e) => setProactiveCfg((p) => ({ ...p, quietStart: e.target.value }))}
                />
                <span>至</span>
                <input
                  type="time"
                  className="form-control feed-settings-time-input"
                  value={proactiveCfg.quietEnd}
                  onChange={(e) => setProactiveCfg((p) => ({ ...p, quietEnd: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </form>
      </Modal>
    </section>
  );
};
