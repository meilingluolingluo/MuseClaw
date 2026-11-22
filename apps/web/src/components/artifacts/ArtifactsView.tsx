import React, { useState, useEffect, useRef } from 'react';
import { Package, RefreshCw, Download, FileText, ExternalLink, AlertTriangle } from 'lucide-react';
import type { Artifact } from '../../types';
import { api } from '../../services/api';
import { formatFileSize, formatTime } from '../../utils/format';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { renderMarkdown } from '../../utils/markdown';

export const ArtifactsView: React.FC = () => {
  const { user, setIsAuthModalOpen } = useApp();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [preview, setPreview] = useState<
    | { loading: true }
    | { html: string }
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

  const loadArtifacts = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getArtifacts();
      setArtifacts(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Failed to load artifacts:', err);
      setLoadError(err.message || '工件列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadArtifacts();
  }, []);

  const getArtifactName = (art: any) => {
    if (art.title) return art.title;
    if (art.name) return art.name;
    if (art.filename) return art.filename;
    if (typeof art.path === 'string' && art.path.length > 0) {
      return art.path.split('/').pop() || art.path;
    }
    return '未命名工件';
  };

  const getDownloadUrl = (art: any) => {
    return art.previewUrl || art.url || (art.filename ? `/api/artifacts/${encodeURIComponent(art.filename)}` : '#');
  };

  const closePreview = () => {
    setSelectedArtifact(null);
    setPreview(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const openPreview = async (art: any) => {
    const name = getArtifactName(art);
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
      if (type.startsWith('image/')) {
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setPreview({ imageUrl: objectUrl });
      } else if (type.includes('text/') || type.includes('json')) {
        const text = await res.text();
        setPreview(/\.(md|markdown)$/i.test(name) ? { html: renderMarkdown(text) } : { text });
      } else {
        setPreview({ binary: true, url });
      }
    } catch (err: any) {
      setPreview({ error: err?.message || '预览失败' });
    }
  };

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  return (
    <section className="view-stage artifacts-stage" aria-label="交付工件与产出物">
      <div className="view-header artifacts-header-wrap">
        <div>
          <div className="view-heading artifacts-heading">
            <Package size={20} className="artifacts-heading-icon" />
            <span>交付工件与产出物</span>
          </div>
          <div className="view-sub artifacts-sub">
            Agent 运行产生的正式交付物（巡检报告、配置导出、数据总结、代码快照）。
          </div>
        </div>
        <div className="artifacts-header-actions">
          <button type="button" className="btn-secondary artifacts-refresh-btn" onClick={loadArtifacts} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>刷新工件列表</span>
          </button>
        </div>
      </div>

      {loadError && (
        <div className="view-load-error is-spaced" role="alert">
          <AlertTriangle size={14} />
          <span>工件列表加载失败：{loadError}</span>
          <button type="button" onClick={loadArtifacts} disabled={loading}>重试</button>
        </div>
      )}

      <div className="artifacts-grid">
        {artifacts.length === 0 ? (
          <div className="artifacts-empty-panel">
            <div className="artifacts-empty-icon">📦</div>
            <div className="artifacts-empty-title">暂无交付工件</div>
            <div className="artifacts-empty-sub">
              当智能体执行指令并产出报表、文档或代码时，将自动归档至此处。
            </div>
          </div>
        ) : (
          artifacts.map((art: any, index) => {
            const displayName = getArtifactName(art);
            const downloadUrl = getDownloadUrl(art);
            const size = art.size || art.sizeBytes || 0;
            const time = art.createdAt || art.updatedAt || Date.now();

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
                        download
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
          maxWidth="700px"
        >
          <div className="artifact-modal-body">
            <div className="artifact-path-line">
              文件路径: <code>{selectedArtifact.path || selectedArtifact.previewUrl || selectedArtifact.title}</code>
            </div>
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
