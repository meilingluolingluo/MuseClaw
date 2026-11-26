import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Package, RefreshCw, Download, FileText, ExternalLink, AlertTriangle, Target } from 'lucide-react';
import type { Artifact } from '../../types';
import { api } from '../../services/api';
import { formatFileSize, formatTime } from '../../utils/format';
import { Modal } from '../common/Modal';
import { WidgetCard } from '../chat/WidgetCard';
import { useApp } from '../../context/AppContext';
import { renderMarkdown } from '../../utils/markdown';

type ArtifactScope = 'all' | 'goals' | 'other';

export const ArtifactsView: React.FC = () => {
  const { user, setIsAuthModalOpen, setTab } = useApp();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [scopeFilter, setScopeFilter] = useState<ArtifactScope>('all');
  const [selectedGoalId, setSelectedGoalId] = useState<string>('');
  const [preview, setPreview] = useState<
    | { loading: true }
    | { html: string }
    | { widgetHtml: string; title: string; kind: 'html' | 'svg' }
    | { text: string }
    | { imageUrl: string }
    | { binary: true; url: string }
    | { error: string }
    | null
  >(null);
  const objectUrlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);

  const getArtifactName = (art: Artifact) => {
    if (art.title) return art.title;
    if (art.name) return art.name;
    if (art.filename) return art.filename;
    if (typeof art.path === 'string' && art.path.length > 0) {
      return art.path.split('/').pop() || art.path;
    }
    return '未命名工件';
  };

  const getDownloadUrl = (art: Artifact) => {
    return art.previewUrl || art.url || (art.filename ? `/api/artifacts/${encodeURIComponent(art.filename)}` : '#');
  };

  const openPreview = useCallback(async (art: Artifact) => {
    const name = getArtifactName(art);
    const extSource = art.filename || art.name || name;
    const url = getDownloadUrl(art);
    setSelectedArtifact({ ...art, title: name, previewUrl: url });
    setPreview({ loading: true });
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? '登录后可以预览与下载这个工件。' : `预览失败（HTTP ${res.status}）`
        );
      }
      const type = res.headers.get('content-type') || '';
      const isHtmlOrSvg = /\.(html?|svg)$/i.test(extSource);
      if (type.startsWith('image/') && !isHtmlOrSvg) {
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setPreview({ imageUrl: objectUrl });
      } else if (type.includes('text/') || type.includes('json') || isHtmlOrSvg) {
        const text = await res.text();
        if (/\.svg$/i.test(extSource)) {
          setPreview({ widgetHtml: text, title: name, kind: 'svg' });
        } else if (/\.(html?)$/i.test(extSource)) {
          setPreview({ widgetHtml: text, title: name, kind: 'html' });
        } else {
          setPreview(/\.(md|markdown)$/i.test(extSource) ? { html: renderMarkdown(text) } : { text });
        }
      } else {
        setPreview({ binary: true, url });
      }
    } catch (err: any) {
      setPreview({ error: err?.message || '预览失败' });
    }
  }, []);

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getArtifacts();
      const list = Array.isArray(data) ? data : [];
      setArtifacts(list);

      const rawFocus = sessionStorage.getItem('museclaw_artifact_focus');
      if (rawFocus) {
        sessionStorage.removeItem('museclaw_artifact_focus');
        try {
          const focus = JSON.parse(rawFocus) as { goalId?: string; filename?: string };
          if (focus.goalId) {
            setScopeFilter('goals');
            setSelectedGoalId(focus.goalId);
          }
          if (focus.filename) {
            const matched = list.find(
              (item) => item.filename === focus.filename || item.name === focus.filename
            );
            if (matched) {
              void openPreview(matched);
            }
          }
        } catch {
          // 忽略格式异常的跳转缓存
        }
      }
    } catch (err: any) {
      console.error('Failed to load artifacts:', err);
      setLoadError(err.message || '工件列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [openPreview]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  const closePreview = () => {
    setSelectedArtifact(null);
    setPreview(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const goalOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const art of artifacts) {
      if (art.goalId && art.goalTitle) {
        map.set(art.goalId, art.goalTitle);
      }
    }
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [artifacts]);

  const goalArtifactsCount = useMemo(
    () => artifacts.filter((a) => Boolean(a.goalId)).length,
    [artifacts]
  );

  const filteredArtifacts = useMemo(() => {
    return artifacts.filter((art) => {
      if (scopeFilter === 'goals' && !art.goalId) return false;
      if (scopeFilter === 'other' && Boolean(art.goalId)) return false;
      if (selectedGoalId && art.goalId !== selectedGoalId) return false;
      return true;
    });
  }, [artifacts, scopeFilter, selectedGoalId]);

  return (
    <section className="view-stage artifacts-stage" aria-label="交付工件与产出物">
      <div className="view-header artifacts-header-wrap">
        <div>
          <div className="view-heading artifacts-heading">
            <Package size={20} className="artifacts-heading-icon" />
            <span>交付工件与产出物</span>
          </div>
          <div className="view-sub artifacts-sub">
            集中管理数字员工运行及目标推进产出的正式交付物（阶段报告、调研文档、巡检记录、导出文件）。
          </div>
        </div>
        <div className="artifacts-header-actions">
          <button type="button" className="btn-secondary artifacts-refresh-btn" onClick={loadArtifacts} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>刷新工件列表</span>
          </button>
        </div>
      </div>

      {/* 归属筛选工具栏 */}
      <div className="artifacts-filter-bar">
        <div className="artifacts-scope-tabs">
          {[
            { id: 'all', label: '全部工件', count: artifacts.length },
            { id: 'goals', label: '目标产出', count: goalArtifactsCount },
            { id: 'other', label: '其他工件', count: artifacts.length - goalArtifactsCount }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={`goal-status-tab-btn ${scopeFilter === item.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                const next = item.id as ArtifactScope;
                setScopeFilter(next);
                if (next !== 'goals') setSelectedGoalId('');
              }}
            >
              <span>{item.label}</span>
              <span className="goal-status-tab-count">{item.count}</span>
            </button>
          ))}
        </div>

        {goalOptions.length > 0 && (
          <select
            aria-label="按目标筛选工件"
            className="goal-form-select artifacts-goal-select"
            value={selectedGoalId}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedGoalId(val);
              if (val) setScopeFilter('goals');
            }}
          >
            <option value="">全部关联目标 ({goalOptions.length})</option>
            {goalOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                目标：{opt.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {loadError && (
        <div className="view-load-error is-spaced" role="alert">
          <AlertTriangle size={14} />
          <span>工件列表加载失败：{loadError}</span>
          <button type="button" onClick={loadArtifacts} disabled={loading}>重试</button>
        </div>
      )}

      <div className="artifacts-grid">
        {filteredArtifacts.length === 0 ? (
          <div className="artifacts-empty-panel">
            <div className="artifacts-empty-icon">
              <Package size={30} />
            </div>
            <div className="artifacts-empty-title">
              {artifacts.length === 0 ? '暂无交付工件' : '当前筛选下暂无工件'}
            </div>
            <div className="artifacts-empty-sub">
              当目标推进产生阶段成果或智能体输出报表、文档与代码时，将自动归档至此处。
            </div>
          </div>
        ) : (
          filteredArtifacts.map((art, index) => {
            const displayName = getArtifactName(art);
            const downloadUrl = getDownloadUrl(art);
            const size = art.size || (art as any).sizeBytes || 0;
            const time = art.updatedAt || art.createdAt || Date.now();

            return (
              <div
                key={art.id || art.filename || art.name || index}
                className="artifact-card"
              >
                <div className="artifact-card-top">
                  <span className="artifact-icon-wrap">
                    <FileText size={18} />
                  </span>
                  <div className="artifact-meta-wrap">
                    <div className="artifact-title" title={displayName}>
                      {displayName}
                    </div>
                    <div className="artifact-meta-info">
                      {formatFileSize(size)} · {formatTime(time)}
                    </div>
                  </div>
                </div>

                {art.goalTitle && (
                  <div className="artifact-goal-row">
                    <button
                      type="button"
                      className="artifact-goal-badge"
                      title="跳转到所属目标"
                      onClick={() => setTab('goals')}
                    >
                      <Target size={11} />
                      <span>{art.goalTitle}</span>
                    </button>
                    {art.kind && <span className="artifact-kind-badge">{art.kind}</span>}
                  </div>
                )}

                {art.summary && (
                  <div className="artifact-summary-text">{art.summary}</div>
                )}

                <div className="artifact-card-actions">
                  <button
                    type="button"
                    className="btn-secondary artifact-action-btn"
                    onClick={() => openPreview(art)}
                  >
                    <ExternalLink size={12} /> <span>预览</span>
                  </button>
                  {downloadUrl && downloadUrl !== '#' && (
                    user ? (
                      <a
                        href={downloadUrl}
                        download={art.filename || displayName}
                        className="btn-secondary artifact-action-btn"
                      >
                        <Download size={12} /> <span>下载</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary artifact-action-btn"
                        onClick={() => setIsAuthModalOpen(true)}
                      >
                        <Download size={12} /> <span>登录后下载</span>
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedArtifact && (
        <Modal
          isOpen={Boolean(selectedArtifact)}
          onClose={closePreview}
          title={selectedArtifact.title}
          icon={<Package size={18} />}
          maxWidth={preview && 'widgetHtml' in preview ? '860px' : '700px'}
        >
          <div className="artifact-modal-body">
            <div className="artifact-path-line">
              文件路径: <code>{selectedArtifact.filename || selectedArtifact.path || selectedArtifact.previewUrl || selectedArtifact.title}</code>
            </div>
            {selectedArtifact.goalTitle && (
              <div className="artifact-path-line">
                所属目标: <span>{selectedArtifact.goalTitle}</span>
              </div>
            )}
            {preview && 'loading' in preview && <div className="chat-loading"><span className="chat-loading-dot" />正在读取文件…</div>}
            {preview && 'error' in preview && (
              <div className="artifact-error">
                <p>{preview.error}</p>
                {!user && (
                  <button type="button" className="btn-primary" onClick={() => { closePreview(); setIsAuthModalOpen(true); }}>
                    去登录
                  </button>
                )}
              </div>
            )}
            {preview && 'html' in preview && (
              <div className="artifact-preview markdown-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
            )}
            {preview && 'widgetHtml' in preview && (
              <WidgetCard
                inModal
                widget={{
                  id: `artifact_${selectedArtifact.id || preview.title}`,
                  title: preview.title,
                  html: preview.widgetHtml,
                  kind: preview.kind
                }}
              />
            )}
            {preview && 'text' in preview && <pre className="artifact-preview">{preview.text}</pre>}
            {preview && 'imageUrl' in preview && <img className="artifact-preview-image" src={preview.imageUrl} alt={selectedArtifact.title} />}
            {preview && 'binary' in preview && (
              <p>
                这个文件不适合内嵌预览。
                <a href={preview.url} target="_blank" rel="noopener noreferrer">在新窗口打开</a>
              </p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
};
