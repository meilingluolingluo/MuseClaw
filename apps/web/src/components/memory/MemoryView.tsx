import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Brain,
  Edit3,
  Trash2,
  Copy,
  Check,
  Undo2,
  Sparkles,
  Plus,
  Search,
  Sliders,
  ShieldCheck,
  ShieldAlert,
  User,
  Users,
  Clock,
  FileText,
  Code,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import type { MemoryItem, MemoryReport, MemoryCategory, MemoryStats } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';

const CATEGORY_CONFIG: Record<
  MemoryCategory,
  { label: string; icon: React.ReactNode; color: string; bg: string; border: string; description: string }
> = {
  profile: {
    label: '用户画像与身份',
    icon: <User size={14} />,
    color: '#0284c7',
    bg: 'rgba(2, 132, 199, 0.08)',
    border: 'rgba(2, 132, 199, 0.25)',
    description: '核心职业、角色定位、技术背景与专长'
  },
  preference: {
    label: '偏好与习惯',
    icon: <Sliders size={14} />,
    color: '#8b5cf6',
    bg: 'rgba(139, 92, 246, 0.08)',
    border: 'rgba(139, 92, 246, 0.25)',
    description: '技术偏好、代码规范、沟通风格与工具习惯'
  },
  people: {
    label: '关键人物与协作',
    icon: <Users size={14} />,
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.08)',
    border: 'rgba(16, 185, 129, 0.25)',
    description: '核心利益相关方、团队成员与角色分工'
  },
  routine: {
    label: '例行约定与流程',
    icon: <Clock size={14} />,
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.08)',
    border: 'rgba(245, 158, 11, 0.25)',
    description: '周期性任务、例会时间点与规范工作流程'
  },
  constraint: {
    label: '业务约束与红线',
    icon: <ShieldAlert size={14} />,
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.08)',
    border: 'rgba(239, 68, 68, 0.25)',
    description: '安全准则、权限边界与绝对禁止操作'
  },
  general: {
    label: '通用沉淀知识',
    icon: <FileText size={14} />,
    color: '#64748b',
    bg: 'rgba(100, 116, 139, 0.08)',
    border: 'rgba(100, 116, 139, 0.25)',
    description: '环境配置、服务地址、系统固定参数'
  }
};

/** 剪贴板 API 不可用时的降级复制 */
function fallbackCopy(text: string, done: () => void): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch {
    console.warn('clipboard copy failed');
  }
}

export const MemoryView: React.FC = () => {
  const { bots, activeBot, showToast } = useApp();

  // 当前选中的 Bot
  const selectedBotId = activeBot?.id || 'muse';
  const currentBot = useMemo(() => bots.find((b) => b.id === selectedBotId) || activeBot, [bots, selectedBotId, activeBot]);

  const [content, setContent] = useState('');
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [reports, setReports] = useState<MemoryReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // 搜索与分类过滤
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<MemoryCategory | 'all'>('all');

  // 新增记忆条目表单状态
  const [newContent, setNewContent] = useState('');
  const newContentInputRef = useRef<HTMLInputElement>(null);
  const [newCategory, setNewCategory] = useState<MemoryCategory>('preference');
  const [isUserAnchor, setIsUserAnchor] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  // 单条编辑模式
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editContentBuffer, setEditContentBuffer] = useState('');
  const [editCategoryBuffer, setEditCategoryBuffer] = useState<MemoryCategory>('general');

  // Markdown 全文编辑模态框
  const [isMarkdownModalOpen, setIsMarkdownModalOpen] = useState(false);
  const [markdownBuffer, setMarkdownBuffer] = useState('');

  // 整理预览弹窗
  const [isDryRunModalOpen, setIsDryRunModalOpen] = useState(false);
  const [dryRunReport, setDryRunReport] = useState<MemoryReport | null>(null);
  const [isConsolidating, setIsConsolidating] = useState(false);

  // 复制反馈状态 (itemId -> boolean)
  const [copiedId, setCopiedId] = useState<string | null>(null);


  const memLoadSeq = useRef(0);
  const loadMemory = async (botId: string) => {
    const seq = ++memLoadSeq.current;
    setIsLoading(true);
    try {
      const data = await api.getMemory(botId);
      if (seq !== memLoadSeq.current) return;
      setContent(data.content || '');
      setItems(Array.isArray(data.items) ? data.items : []);
      setStats(data.stats || null);
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (err: any) {
      if (seq !== memLoadSeq.current) return;
      console.error('Failed to load memory:', err);
      showToast(`加载记忆失败: ${err.message}`, 'error');
    } finally {
      if (seq === memLoadSeq.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBotId) {
      loadMemory(selectedBotId);
    }
  }, [selectedBotId]);

  // 新增单条事实
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) {
      showToast('请输入要记录的内容', 'error');
      return;
    }
    setIsAdding(true);
    try {
      const res = await api.addMemoryItem(selectedBotId, newContent.trim(), newCategory, isUserAnchor);
      if (res.success) {
        showToast('已记录这条记忆', 'success');
        if (res.warning) {
          showToast(res.warning, 'info');
        }
        setNewContent('');
        if (selectedCategoryTab !== 'all' && selectedCategoryTab !== newCategory) {
          setSelectedCategoryTab('all');
          setSearchQuery('');
        }
        newContentInputRef.current?.focus();
        loadMemory(selectedBotId);
      } else {
        showToast(res.error || '添加失败', 'error');
      }
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      setIsAdding(false);
    }
  };

  // 取消行内编辑（有改动时确认，避免误触丢稿）
  const cancelItemEdit = (item: MemoryItem) => {
    if (editContentBuffer !== item.content || editCategoryBuffer !== item.category) {
      if (!confirm('有未保存的修改，确定放弃吗？')) return;
    }
    setEditingItemId(null);
  };

  // 保存单条编辑
  const handleSaveItemEdit = async (itemId: string) => {
    if (!editContentBuffer.trim()) {
      showToast('内容不能为空', 'error');
      return;
    }
    try {
      const res = await api.updateMemoryItem(selectedBotId, itemId, editContentBuffer.trim(), editCategoryBuffer);
      if (res.success) {
        showToast('条目已更新', 'success');
        setEditingItemId(null);
        if (selectedCategoryTab !== 'all' && selectedCategoryTab !== editCategoryBuffer) {
          setSelectedCategoryTab('all');
          setSearchQuery('');
        }
        loadMemory(selectedBotId);
      } else {
        showToast(res.error || '更新失败', 'error');
      }
    } catch (err: any) {
      showToast(`更新失败: ${err.message}`, 'error');
    }
  };

  // 删除单条事实
  const handleDeleteItem = async (itemId: string, contentSnippet: string) => {
    const snippet = contentSnippet.length > 80 ? `${contentSnippet.slice(0, 80)}…` : contentSnippet;
    if (!confirm(`确定删除这条记忆吗？\n\n“${snippet}”`)) {
      return;
    }
    try {
      const res = await api.deleteMemoryItem(selectedBotId, itemId);
      if (res.success) {
        showToast('条目已删除这条记忆', 'success');
        loadMemory(selectedBotId);
      } else {
        showToast(res.error || '删除失败', 'error');
      }
    } catch (err: any) {
      showToast(`删除失败: ${err.message}`, 'error');
    }
  };

  // 复制事实文本（非安全上下文降级为 execCommand）
  const handleCopyText = (id: string, text: string) => {
    const done = () => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  };

  // 全文 Markdown 保存
  const handleSaveMarkdown = async () => {
    try {
      await api.updateMemory(selectedBotId, markdownBuffer);
      setIsMarkdownModalOpen(false);
      showToast('记忆全文已更新', 'success');
      loadMemory(selectedBotId);
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    }
  };

  // 启动自预览整理
  const handleStartDryRun = async () => {
    setIsConsolidating(true);
    showToast('正在检查记忆内容，生成整理建议…', 'info');
    try {
      const res = await api.consolidateMemory(selectedBotId, true);
      if (res.success && res.report) {
        setDryRunReport(res.report);
        setIsDryRunModalOpen(true);
      } else {
        showToast(res.error || '暂时没有整理建议', 'error');
      }
    } catch (err: any) {
      showToast(`预检失败: ${err.message}`, 'error');
    } finally {
      setIsConsolidating(false);
    }
  };

  // 正式执行整理
  const handleApplyConsolidation = async () => {
    setIsConsolidating(true);
    try {
      const res = await api.consolidateMemory(selectedBotId, false);
      if (res.success) {
        setIsDryRunModalOpen(false);
        showToast(res.summary || '已完成受控长期记忆整理并落盘', 'success');
        loadMemory(selectedBotId);
      } else {
        showToast(res.error || '整理失败', 'error');
      }
    } catch (err: any) {
      showToast(`整理异常: ${err.message}`, 'error');
    } finally {
      setIsConsolidating(false);
    }
  };

  // 撤销上次整理
  const handleUndo = async () => {
    if (!confirm('确定撤销上一次整理，恢复到整理前的内容吗？')) return;
    try {
      const res = await api.undoMemory(selectedBotId);
      if (res.success) {
        showToast(res.message || '已成功还原历史记忆快照', 'success');
        loadMemory(selectedBotId);
      } else {
        showToast(res.error || '撤销失败', 'error');
      }
    } catch (err: any) {
      showToast(`撤销失败: ${err.message}`, 'error');
    }
  };

  // 过滤后的条目清单
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory = selectedCategoryTab === 'all' || item.category === selectedCategoryTab;
      const matchesSearch =
        !searchQuery.trim() ||
        item.content.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.trim().toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [items, selectedCategoryTab, searchQuery]);

  // 按分类分组的条目计数
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    for (const key of Object.keys(CATEGORY_CONFIG)) {
      counts[key] = 0;
    }
    for (const it of items) {
      counts[it.category] = (counts[it.category] || 0) + 1;
    }
    return counts;
  }, [items]);

  // 预算健康状态颜色
  const budgetStatusBadge = useMemo(() => {
    if (!stats) return null;
    if (stats.status === 'critical') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            borderRadius: '999px',
            fontSize: '11.5px',
            fontWeight: 600,
            color: '#ef4444',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)'
          }}
        >
          <AlertTriangle size={13} /> 记忆快满了 ({stats.usagePercent}%) · 建议整理
        </span>
      );
    }
    if (stats.status === 'warning') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            borderRadius: '999px',
            fontSize: '11.5px',
            fontWeight: 600,
            color: '#f59e0b',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)'
          }}
        >
          <Clock size={13} /> 容量偏高 ({stats.usagePercent}%) · 建议关注
        </span>
      );
    }
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 8px',
          borderRadius: '999px',
          fontSize: '11.5px',
          fontWeight: 600,
          color: '#10b981',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)'
        }}
      >
        <ShieldCheck size={13} /> 存储健康 ({stats.usagePercent}%)
      </span>
    );
  }, [stats]);

  return (
    <section className="view-stage">
      {/* 顶部标题与多 Bot 切换栏 */}
      <div className="view-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="view-heading" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Brain size={20} style={{ color: 'var(--om-accent)' }} />
            受控长期记忆库 (Memory System)

          </div>
          <div className="view-sub" style={{ marginTop: '4px' }}>
            为每位员工保存长期记忆，按类别整理与检索；重要内容可设为受保护，不会被自动整理或删除。
          </div>
        </div>

        {/* 顶部操作快捷栏 */}
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => loadMemory(selectedBotId)}
            disabled={isLoading}
            title="刷新记忆事实"
            style={{ padding: '6px 12px' }}
          >
            <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
            刷新
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setMarkdownBuffer(content);
              setIsMarkdownModalOpen(true);
            }}
            style={{ padding: '6px 12px' }}
          >
            <Code size={13} />
            编辑记忆全文
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleStartDryRun}
            disabled={isConsolidating || items.length < 2}
            title={items.length < 2 ? '记忆少于 2 条，暂时不需要整理' : '检查重复和过时的内容，预览整理建议'}
            style={{ padding: '6px 12px' }}
          >
            <Sparkles size={13} className={isConsolidating ? 'spin' : ''} />
            预览整理
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleUndo}
            disabled={reports.length === 0}
            title={reports.length === 0 ? '还没有整理记录' : '还原到上次整理前的内容'}
            style={{ padding: '6px 12px' }}
          >
            <Undo2 size={13} />
            撤销上次整理
          </button>
        </div>
      </div>

      {/* 记忆库配额与容量健康仪表盘 */}
      {stats && (
        <div
          style={{
            background: 'var(--om-surface)',
            border: '1px solid var(--om-border)',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '16px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>记忆容量</span>
              <span style={{ fontSize: '12px', color: 'var(--text-dim)', fontWeight: 400 }}>
                上限 24KB / 200 行，超出时提示整理
              </span>
            </div>
            {budgetStatusBadge}
          </div>

          {/* 进度条 */}
          <div
            style={{
              width: '100%',
              height: '7px',
              borderRadius: '999px',
              background: 'var(--om-border)',
              overflow: 'hidden',
              marginBottom: '12px'
            }}
          >
            <div
              style={{
                width: `${Math.min(100, stats.usagePercent)}%`,
                height: '100%',
                borderRadius: '999px',
                background:
                  stats.usagePercent >= 85
                    ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                    : stats.usagePercent >= 60
                    ? 'linear-gradient(90deg, #10b981, #f59e0b)'
                    : 'linear-gradient(90deg, #0284c7, #10b981)',
                transition: 'width 0.3s ease'
              }}
            />
          </div>

          {/* 三列关键指标 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: '12px', fontSize: '12px' }}>
            <div style={{ background: 'var(--om-bg)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--om-border)' }}>
              <div style={{ color: 'var(--text-dim)', marginBottom: '4px' }}>已用空间</div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)' }}>
                {stats.totalBytes} <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>/ {stats.maxBytes} 字节</span>
              </div>
            </div>

            <div style={{ background: 'var(--om-bg)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--om-border)' }}>
              <div style={{ color: 'var(--text-dim)', marginBottom: '4px' }}>事实行数</div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)' }}>
                {stats.lineCount} <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>/ {stats.maxLines} 行</span>
              </div>
            </div>

            <div style={{ background: 'var(--om-bg)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--om-border)' }}>
              <div style={{ color: 'var(--text-dim)', marginBottom: '4px' }}>来源分布</div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)', display: 'flex', gap: '8px' }}>
                <span title="用户核心声明，受保护不可被大模型自动删除" style={{ color: '#10b981' }}>
                  🛡️ {stats.userAnchorCount} 用户声明
                </span>
                <span style={{ color: 'var(--text-dim)' }}>|</span>
                <span title="智能体自主沉淀的事实" style={{ color: '#0284c7' }}>
                  🤖 {stats.agentItemCount} 自动沉淀
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 快速沉淀新记忆事实输入卡片 */}
      <div
        style={{
          background: 'var(--om-surface)',
          border: '1px solid var(--om-border)',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '20px'
        }}
      >
        <div style={{ fontSize: '13.5px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Plus size={15} style={{ color: 'var(--om-accent)' }} />
          记录一条记忆
        </div>
        <form onSubmit={handleAddItem}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <input
              type="text"
              ref={newContentInputRef}
              aria-label="记忆事实内容"
              className="form-control"
              placeholder={`告诉 ${currentBot?.name || '当前员工'} 记住一条事实，例如：我习惯用中文沟通，项目文档统一用 Markdown`}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              style={{ flex: 1, fontSize: '13px', padding: '8px 12px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}>
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>归属分类:</span>
                <select
                  className="form-control"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                  style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
                >
                  {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key}>
                      {cfg.label}
                    </option>
                  ))}
                </select>
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  cursor: 'pointer',
                  color: isUserAnchor ? '#10b981' : 'var(--text-muted)',
                  fontWeight: isUserAnchor ? 600 : 400
                }}
                title="受保护的内容不会被自动整理或删除"

              >
                <input
                  type="checkbox"
                  checked={isUserAnchor}
                  onChange={(e) => setIsUserAnchor(e.target.checked)}
                  style={{ accentColor: '#10b981' }}
                />
                🛡️ 受保护（不会被自动删除）
              </label>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={isAdding || !newContent.trim()}
              style={{ padding: '6px 16px', fontSize: '13px' }}
            >
              {isAdding ? '沉淀中...' : '记录事实'}
            </button>
          </div>
        </form>
      </div>

      {/* 搜索过滤与分类筛选栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        {/* 数量固定在最前且占位恒定，切换分类时分类行不位移 */}
        <span className="memory-count" aria-live="polite">
          {selectedCategoryTab !== 'all' || searchQuery.trim()
            ? `匹配 ${filteredItems.length} / ${items.length} 条`
            : `共 ${items.length} 条`}
        </span>
        {/* 分类 Tab 栏 */}
        <div className="memory-filters" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`cat-pill${selectedCategoryTab === 'all' ? ' is-active' : ''}`}
            style={{ ['--cat-color' as any]: 'var(--om-accent)' }}
            aria-pressed={selectedCategoryTab === 'all'}
            onClick={() => setSelectedCategoryTab('all')}
          >
            全部 ({categoryCounts.all || 0})
          </button>
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
            const count = categoryCounts[key] || 0;
            const isSelected = selectedCategoryTab === key;
            return (
              <button
                key={key}
                type="button"
                className={`cat-pill${isSelected ? ' is-active' : ''}`}
                data-empty={count === 0}
                style={{ ['--cat-color' as any]: cfg.color }}
                aria-pressed={isSelected}
                onClick={() => setSelectedCategoryTab(key as MemoryCategory)}
              >
                {cfg.icon}
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        {/* 关键字搜索框 */}
        <div className="skills-search" style={{ flex: 1, minWidth: 'min(240px, 100%)', maxWidth: '320px' }}>
          <Search size={14} />
          <input
            type="text"
            aria-label="搜索记忆事实"
            placeholder="搜索记忆事实..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="清空搜索"
              className="search-clear"
              onClick={() => setSearchQuery('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 事实卡片列表展示区 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {isLoading && items.length === 0 ? (
          <div className="chat-loading" role="status">
            <span className="chat-loading-dot" />
            正在加载记忆…
          </div>
        ) : filteredItems.length === 0 ? (
          <div
            style={{
              background: 'var(--om-surface)',
              border: '1px dashed var(--om-border)',
              borderRadius: '12px',
              padding: '40px 20px',
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontSize: '13px'
            }}
          >
            {searchQuery
              ? `没有找到与 “${searchQuery}” 相关的内容`
              : '这个分类还没有记忆，在上方输入框记录一条即可'}
            {(searchQuery || selectedCategoryTab !== 'all') && (
              <button
                type="button"
                className="om-btn-subtle"
                style={{ marginTop: '12px' }}
                onClick={() => {
                  setSelectedCategoryTab('all');
                  setSearchQuery('');
                }}
              >
                清空筛选条件
              </button>
            )}
          </div>
        ) : (
          filteredItems.map((item) => {
            const cfg = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.general;
            const isEditing = editingItemId === item.id;
            const isCopied = copiedId === item.id;

            return (
              <div
                key={item.id}
                style={{
                  background: 'var(--om-surface)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  transition: 'border-color 0.2s ease',
                  position: 'relative'
                }}
                title={`条目 ID: ${item.id}`}
              >
                {/* 顶部标签行 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* 分类标签 */}
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: cfg.color,
                        background: cfg.bg,
                        border: `1px solid ${cfg.border}`
                      }}
                    >
                      {cfg.icon}
                      {cfg.label}
                    </span>

                    {/* 来源保护标签 */}
                    {item.source === 'user' ? (
                      <span
                        title="这条记忆受保护，不会被自动整理或删除"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '2px 7px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#10b981',
                          background: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.25)'
                        }}
                      >
                        <ShieldCheck size={12} />
                        受保护
                      </span>
                    ) : (
                      <span
                        title="智能员工在对话与任务中自主沉淀"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '2px 7px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          color: '#0284c7',
                          background: 'rgba(2, 132, 199, 0.08)',
                          border: '1px solid rgba(2, 132, 199, 0.25)'
                        }}
                      >
                        自动沉淀
                      </span>
                    )}

                  </div>

                  {/* 右上角操作按钮 */}
                  {!isEditing && (
                    <div className="memory-item-actions" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => handleCopyText(item.id, item.content)}
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px', height: '24px' }}
                        title="复制事实内容"
                      >
                        {isCopied ? <Check size={11} style={{ color: '#10b981' }} /> : <Copy size={11} />}
                        {isCopied ? '已复制' : '复制'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingItemId(item.id);
                          setEditContentBuffer(item.content);
                          setEditCategoryBuffer(item.category);
                        }}
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px', height: '24px' }}
                        title="编辑此条事实"
                      >
                        <Edit3 size={11} />
                        编辑
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item.id, item.content)}
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px', height: '24px', color: '#ef4444' }}
                        title="从记忆库中遗忘/删除此条"
                      >
                        <Trash2 size={11} />
                        删除
                      </button>
                    </div>
                  )}
                </div>

                {/* 事实正文展示 / 行内编辑 */}
                {isEditing ? (
                  <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={editContentBuffer}
                      onChange={(e) => setEditContentBuffer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelItemEdit(item);
                        }
                      }}
                      style={{ width: '100%', fontSize: '13px', lineHeight: 1.5 }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>修改分类:</span>
                        <select
                          className="form-control"
                          value={editCategoryBuffer}
                          onChange={(e) => setEditCategoryBuffer(e.target.value as MemoryCategory)}
                          style={{ fontSize: '12px', padding: '3px 6px' }}
                        >
                          {Object.entries(CATEGORY_CONFIG).map(([key, c]) => (
                            <option key={key} value={key}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => cancelItemEdit(item)}
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleSaveItemEdit(item.id)}
                          style={{ padding: '4px 12px', fontSize: '12px' }}
                        >
                          保存修改
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-main)', wordBreak: 'break-word' }}>
                    {item.content}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 历史整理审计记录折叠展示 */}
      {reports.length > 0 && (
        <div
          style={{
            marginTop: '24px',
            background: 'var(--om-surface)',
            border: '1px solid var(--om-border)',
            borderRadius: '12px',
            padding: '16px 20px'
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={14} style={{ color: 'var(--text-dim)' }} />
            整理记录
            {reports.length > 5 && (
              <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 400 }}>
                （共 {reports.length} 条，显示最近 5 条）
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {reports.slice(0, 5).map((rep, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: '12px',
                  padding: '8px 12px',
                  background: 'var(--om-bg)',
                  borderRadius: '6px',
                  border: '1px solid var(--om-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                    {rep.timestamp && !isNaN(new Date(rep.timestamp).getTime())
                      ? new Date(rep.timestamp).toLocaleString()
                      : '时间未知'}
                  </span>
                  <span style={{ margin: '0 6px', color: 'var(--text-dim)' }}>·</span>
                  <span style={{ color: 'var(--text-muted)' }}>{rep.summary}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 模态框 1: 记忆全文编辑 */}
      <Modal
        isOpen={isMarkdownModalOpen}
        onClose={() => setIsMarkdownModalOpen(false)}
        title="编辑记忆全文"
        icon={<Code size={18} />}
        maxWidth="760px"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
              字符数：{markdownBuffer.length} · 建议保留分类标题
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn-secondary" onClick={() => setIsMarkdownModalOpen(false)}>
                取消
              </button>
              <button type="button" className="btn-primary" onClick={handleSaveMarkdown}>
                保存并生效
              </button>
            </div>
          </div>
        }
      >
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '8px' }}>
            按分类标题组织内容即可；标记为受保护的内容不会被自动整理或删除。
          </div>
          <textarea
            className="form-control"
            rows={18}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '12.5px', lineHeight: 1.6 }}
            value={markdownBuffer}
            onChange={(e) => setMarkdownBuffer(e.target.value)}
          />
        </div>
      </Modal>

      {/* 模态框 2: 整理预览 */}
      <Modal
        isOpen={isDryRunModalOpen}
        onClose={() => setIsDryRunModalOpen(false)}
        title="预览整理结果"
        icon={<Sparkles size={18} />}
        maxWidth="720px"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ShieldCheck size={14} /> 受保护的内容不会被删除
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn-secondary" onClick={() => setIsDryRunModalOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleApplyConsolidation}
                disabled={isConsolidating || !dryRunReport || dryRunReport.changed === 0}
              >
                {isConsolidating ? '正在应用...' : '确认整理'}
              </button>
            </div>
          </div>
        }
      >
        <div>
          {dryRunReport && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                style={{
                  background: 'var(--om-bg)',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--om-border)',
                  fontSize: '13px'
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  {dryRunReport.summary}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                  整理只会合并重复内容和清理过时信息，不会改动受保护的内容。
                </div>
              </div>

              {dryRunReport.changed === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px 0', fontSize: '13px' }}>
                  当前记忆很整齐，没有需要整理的内容。
                </div>
              ) : (
                <>
                  {/* 合并提案 */}
                  {dryRunReport.merged.length > 0 && (
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#8b5cf6', marginBottom: '6px' }}>
                        建议合并的内容 ({dryRunReport.merged.length} 组)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {dryRunReport.merged.map((m, idx) => (
                          <div
                            key={idx}
                            style={{
                              background: 'rgba(139, 92, 246, 0.05)',
                              border: '1px solid rgba(139, 92, 246, 0.2)',
                              borderRadius: '6px',
                              padding: '8px 12px',
                              fontSize: '12px'
                            }}
                          >
                            <div style={{ color: 'var(--text-dim)', marginBottom: '4px' }}>
                              合并前 ({m.before.length} 项):
                            </div>
                            <ul style={{ margin: '0 0 6px 16px', padding: 0, color: 'var(--text-muted)' }}>
                              {m.before.map((b, bIdx) => (
                                <li key={bIdx}>{b}</li>
                              ))}
                            </ul>
                            <div style={{ color: '#8b5cf6', fontWeight: 600 }}>
                              合并后: “{m.after}”
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 删除精简提案 */}
                  {dryRunReport.dropped.length > 0 && (
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#ef4444', marginBottom: '6px' }}>
                        建议删除的内容 ({dryRunReport.dropped.length} 条)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {dryRunReport.dropped.map((d, idx) => (
                          <div
                            key={idx}
                            style={{
                              background: 'rgba(239, 68, 68, 0.05)',
                              border: '1px solid rgba(239, 68, 68, 0.2)',
                              borderRadius: '6px',
                              padding: '8px 12px',
                              fontSize: '12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                          >
                            <span style={{ color: 'var(--text-main)', textDecoration: 'line-through' }}>
                              {d.before[0]}
                            </span>
                            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
                              原因: {d.reason || '过时碎片'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Modal>
    </section>
  );
};
