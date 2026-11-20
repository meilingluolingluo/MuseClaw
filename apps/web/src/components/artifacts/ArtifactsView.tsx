import React, { useState, useEffect, useRef } from 'react';
import { Package, RefreshCw, Download, FileText, ExternalLink } from 'lucide-react';
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
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);

  const loadArtifacts = async () => {
    setLoading(true);
    try {
      const data = await api.getArtifacts();
      setArtifacts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load artifacts:', err);
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
    <section className="view-stage">
      <div className="view-header">
        <div>
          <div className="view-heading">
            <Package size={18} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }} />
            交付工件与产出物 (Artifacts)
          </div>
          <div className="view-sub">Agent 运行产生的正式交付物（巡检报告、配置导出、数据总结、代码快照）</div>
        </div>
        <button type="button" className="btn-secondary" onClick={loadArtifacts} disabled={loading} style={{ whiteSpace: 'nowrap' }}>
          <RefreshCw size={14} /> 刷新工件列表
        </button>
      </div>

      <div className="artifacts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {artifacts.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 16px', color: 'var(--text-dim)' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📦</div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-muted)' }}>暂无交付工件</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>
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
                style={{
                  background: 'var(--om-surface)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      background: 'var(--om-surface-2)',
                      color: 'var(--om-accent)',
                      flexShrink: 0,
                    }}
                  >
                    <FileText size={18} />
                  </span>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontWeight: 600, fontSize: '13.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={displayName}>
                      {displayName}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
                      {formatFileSize(size)} · {formatTime(time)}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
                    onClick={() => openPreview(art)}
                  >
                    <ExternalLink size={12} /> 预览
                  </button>
                  {downloadUrl && downloadUrl !== '#' && (
                    user ? (
                      <a
                        href={downloadUrl}
                        download
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                      >
                        <Download size={12} /> 下载
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                        onClick={() => setIsAuthModalOpen(true)}
                      >
                        <Download size={12} /> 登录后下载
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
          <div style={{ fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.6 }}>
            <div style={{ marginBottom: '10px', color: 'var(--text-muted)' }}>
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
