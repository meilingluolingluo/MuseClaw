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
        <span className="memory-budget-badge is-critical">
          <AlertTriangle size={13} /> 记忆快满了 ({stats.usagePercent}%) · 建议整理
        </span>
      );
    }
    if (stats.status === 'warning') {
      return (
        <span className="memory-budget-badge is-warning">
          <Clock size={13} /> 容量偏高 ({stats.usagePercent}%) · 建议关注
        </span>
      );
    }
    return (
      <span className="memory-budget-badge is-healthy">
        <ShieldCheck size={13} /> 存储健康 ({stats.usagePercent}%)
      </span>
    );
  }, [stats]);

  return (
    <section className="view-stage memory-stage" aria-label="受控长期记忆库">
      {/* 顶部标题与多 Bot 切换栏 */}
      <div className="view-header memory-header-wrap">
        <div>
          <div className="view-heading memory-heading">
            <Brain size={20} className="memory-heading-icon" />
            <span>受控长期记忆库</span>
          </div>
          <div className="view-sub memory-sub">
            为每位员工保存长期记忆，按类别整理与检索；重要内容可设为受保护，不会被自动整理或删除。
          </div>
        </div>

        {/* 顶部操作快捷栏 */}
        <div className="memory-header-actions">
          <button
            type="button"
            className="btn-secondary memory-hdr-btn"
            onClick={() => loadMemory(selectedBotId)}
            disabled={isLoading}
            title="刷新记忆事实"
          >
            <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            type="button"
            className="btn-secondary memory-hdr-btn"
            onClick={() => {
              setMarkdownBuffer(content);
              setIsMarkdownModalOpen(true);
            }}
          >
            <Code size={13} />
            <span>编辑记忆全文</span>
          </button>
          <button
            type="button"
            className="btn-secondary memory-hdr-btn"
            onClick={handleStartDryRun}
            disabled={isConsolidating || items.length < 2}
            title={items.length < 2 ? '记忆少于 2 条，暂时不需要整理' : '检查重复和过时的内容，预览整理建议'}
          >
            <Sparkles size={13} className={isConsolidating ? 'spin' : ''} />
            <span>预览整理</span>
          </button>
          <button
            type="button"
            className="btn-secondary memory-hdr-btn"
            onClick={handleUndo}
            disabled={reports.length === 0}
            title={reports.length === 0 ? '还没有整理记录' : '还原到上次整理前的内容'}
          >
            <Undo2 size={13} />
            <span>撤销上次整理</span>
          </button>
        </div>
      </div>

      {/* 记忆库配额与容量健康仪表盘 */}
      {stats && (
        <div className="memory-stats-card">
          <div className="memory-stats-top-row">
            <div className="memory-quota-title-wrap">
              <span className="memory-quota-title">记忆容量</span>
              <span className="memory-quota-sub">
                上限 24KB / 200 行，超出时提示整理
              </span>
            </div>
            {budgetStatusBadge}
          </div>

          {/* 进度条 */}
          <div className="memory-progress-track">
            <div
              className={`memory-progress-bar ${
                stats.usagePercent >= 85
                  ? 'is-critical'
                  : stats.usagePercent >= 60
                  ? 'is-warning'
                  : 'is-healthy'
              }`}
              style={{ width: `${Math.min(100, stats.usagePercent)}%` }}
            />
          </div>

          {/* 三列关键指标 */}
          <div className="memory-stats-3col">
            <div className="memory-stat-box">
              <div className="memory-stat-box-label">已用空间</div>
              <div className="memory-stat-box-val">
                {stats.totalBytes} <span className="memory-stat-unit">/ {stats.maxBytes} 字节</span>
              </div>
            </div>

            <div className="memory-stat-box">
              <div className="memory-stat-box-label">事实行数</div>
              <div className="memory-stat-box-val">
                {stats.lineCount} <span className="memory-stat-unit">/ {stats.maxLines} 行</span>
              </div>
            </div>

            <div className="memory-stat-box">
              <div className="memory-stat-box-label">来源分布</div>
              <div className="memory-stat-source-dist">
                <span title="用户核心声明，受保护不可被大模型自动删除" className="memory-source-user-tag">
                  🛡️ {stats.userAnchorCount} 用户声明
                </span>
                <span className="memory-source-divider">|</span>
                <span title="智能体自主沉淀的事实" className="memory-source-agent-tag">
                  🤖 {stats.agentItemCount} 自动沉淀
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 快速沉淀新记忆事实输入卡片 */}
      <div className="memory-create-card">
        <div className="memory-create-title">
          <Plus size={15} className="memory-icon-accent" />
          <span>记录一条记忆</span>
        </div>
        <form onSubmit={handleAddItem} className="memory-create-form">
          <div className="memory-input-row">
            <input
              type="text"
              ref={newContentInputRef}
              aria-label="记忆事实内容"
              className="form-control memory-input-field"
              placeholder={`告诉 ${currentBot?.name || '当前员工'} 记住一条事实，例如：我习惯用中文沟通，项目文档统一用 Markdown`}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
            />
          </div>

          <div className="memory-create-meta-row">
            <div className="memory-create-meta-left">
              <div className="memory-category-select-wrap">
                <span className="memory-meta-label">归属分类:</span>
                <select
                  className="form-control memory-cat-select"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                >
                  {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key}>
                      {cfg.label}
                    </option>
                  ))}
                </select>
              </div>

              <label
                className={`memory-protected-checkbox-label ${isUserAnchor ? 'is-checked' : ''}`}
                title="受保护的内容不会被自动整理或删除"
              >
                <input
                  type="checkbox"
                  checked={isUserAnchor}
                  onChange={(e) => setIsUserAnchor(e.target.checked)}
                  className="memory-protect-checkbox"
                />
                <span>🛡️ 受保护（不会被自动删除）</span>
              </label>
            </div>

            <button
              type="submit"
              className="btn-primary memory-submit-btn"
              disabled={isAdding || !newContent.trim()}
            >
              {isAdding ? '沉淀中...' : '记录事实'}
            </button>
          </div>
        </form>
      </div>

      {/* 搜索过滤与分类筛选栏 */}
      <div className="memory-toolbar">
        {/* 数量固定在最前且占位恒定，切换分类时分类行不位移 */}
        <span className="memory-count" aria-live="polite">
          {selectedCategoryTab !== 'all' || searchQuery.trim()
            ? `匹配 ${filteredItems.length} / ${items.length} 条`
            : `共 ${items.length} 条`}
        </span>
        {/* 分类 Tab 栏 */}
        <div className="memory-filters">
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
                <span>{cfg.label}</span>
                <span className="cat-pill-count">({count})</span>
              </button>
            );
          })}
        </div>

        {/* 关键字搜索框 */}
        <div className="skills-search memory-search-box">
          <Search size={14} className="memory-search-icon" />
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
      <div className="memory-list-container">
        {isLoading && items.length === 0 ? (
          <div className="chat-loading memory-loading-indicator" role="status">
            <span className="chat-loading-dot" />
            正在加载记忆…
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="memory-empty-state">
            <div className="memory-empty-text">
              {searchQuery
                ? `没有找到与 “${searchQuery}” 相关的内容`
                : '这个分类还没有记忆，在上方输入框记录一条即可'}
            </div>
            {(searchQuery || selectedCategoryTab !== 'all') && (
              <button
                type="button"
                className="om-btn-subtle memory-empty-clear-btn"
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
                className="memory-item-card"
                title={`条目 ID: ${item.id}`}
              >
                {/* 顶部标签行 */}
                <div className="memory-item-top-row">
                  <div className="memory-item-badges">
                    {/* 分类标签 */}
                    <span
                      className="memory-cat-badge"
                      style={{
                        color: cfg.color,
                        background: cfg.bg,
                        borderColor: cfg.border
                      }}
                    >
                      {cfg.icon}
                      <span>{cfg.label}</span>
                    </span>

                    {/* 来源保护标签 */}
                    {item.source === 'user' ? (
                      <span
                        title="这条记忆受保护，不会被自动整理或删除"
                        className="memory-protect-badge is-protected"
                      >
                        <ShieldCheck size={12} />
                        <span>受保护</span>
                      </span>
                    ) : (
                      <span
                        title="智能员工在对话与任务中自主沉淀"
                        className="memory-protect-badge is-auto"
                      >
                        <span>自动沉淀</span>
                      </span>
                    )}
                  </div>

                  {/* 右上角操作按钮 */}
                  {!isEditing && (
                    <div className="memory-item-actions">
                      <button
                        type="button"
                        onClick={() => handleCopyText(item.id, item.content)}
                        className="btn-secondary memory-action-btn"
                        title="复制事实内容"
                      >
                        {isCopied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                        <span>{isCopied ? '已复制' : '复制'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingItemId(item.id);
                          setEditContentBuffer(item.content);
                          setEditCategoryBuffer(item.category);
                        }}
                        className="btn-secondary memory-action-btn"
                        title="编辑此条事实"
                      >
                        <Edit3 size={11} />
                        <span>编辑</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item.id, item.content)}
                        className="btn-secondary memory-action-btn is-danger"
                        title="从记忆库中遗忘/删除此条"
                      >
                        <Trash2 size={11} />
                        <span>删除</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 事实正文展示 / 行内编辑 */}
                {isEditing ? (
                  <div className="memory-edit-box">
                    <textarea
                      className="form-control memory-edit-textarea"
                      rows={3}
                      value={editContentBuffer}
                      onChange={(e) => setEditContentBuffer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelItemEdit(item);
                        }
                      }}
                    />
                    <div className="memory-edit-footer">
                      <div className="memory-edit-cat-selector">
                        <span className="memory-edit-cat-label">修改分类:</span>
                        <select
                          className="form-control memory-edit-cat-select"
                          value={editCategoryBuffer}
                          onChange={(e) => setEditCategoryBuffer(e.target.value as MemoryCategory)}
                        >
                          {Object.entries(CATEGORY_CONFIG).map(([key, c]) => (
                            <option key={key} value={key}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="memory-edit-btn-group">
                        <button
                          type="button"
                          className="btn-secondary memory-edit-btn"
                          onClick={() => cancelItemEdit(item)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="btn-primary memory-edit-btn"
                          onClick={() => handleSaveItemEdit(item.id)}
                        >
                          保存修改
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="memory-item-content">
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
        <div className="memory-reports-card">
          <div className="memory-reports-header">
            <Clock size={14} className="memory-reports-icon" />
            <span className="memory-reports-title">整理记录</span>
            {reports.length > 5 && (
              <span className="memory-reports-count">
                （共 {reports.length} 条，显示最近 5 条）
              </span>
            )}
          </div>
          <div className="memory-reports-list">
            {reports.slice(0, 5).map((rep, idx) => (
              <div key={idx} className="memory-report-item">
                <div className="memory-report-text">
                  <span className="memory-report-timestamp">
                    {rep.timestamp && !isNaN(new Date(rep.timestamp).getTime())
                      ? new Date(rep.timestamp).toLocaleString()
                      : '时间未知'}
                  </span>
                  <span className="memory-report-sep">·</span>
                  <span className="memory-report-summary">{rep.summary}</span>
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
          <div className="modal-actions-bar w-full">
            <div className="memory-markdown-meta">
              字符数：{markdownBuffer.length} · 建议保留分类标题
            </div>
            <div className="modal-actions-right">
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
        <div className="memory-markdown-body">
          <div className="memory-markdown-hint">
            按分类标题组织内容即可；标记为受保护的内容不会被自动整理或删除。
          </div>
          <textarea
            className="form-control memory-markdown-textarea"
            rows={18}
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
          <div className="modal-actions-bar w-full">
            <div className="memory-dry-run-guarantee">
              <ShieldCheck size={14} /> <span>受保护的内容不会被删除</span>
            </div>
            <div className="modal-actions-right">
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
        <div className="memory-dry-run-body">
          {dryRunReport && (
            <div className="memory-dry-run-content">
              <div className="memory-dry-run-summary-box">
                <div className="memory-dry-run-summary-title">
                  {dryRunReport.summary}
                </div>
                <div className="memory-dry-run-summary-sub">
                  整理只会合并重复内容和清理过时信息，不会改动受保护的内容。
                </div>
              </div>

              {dryRunReport.changed === 0 ? (
                <div className="memory-dry-run-clean">
                  当前记忆很整齐，没有需要整理的内容。
                </div>
              ) : (
                <>
                  {/* 合并提案 */}
                  {dryRunReport.merged.length > 0 && (
                    <div className="memory-dry-run-section">
                      <div className="memory-dry-run-section-title is-merged">
                        建议合并的内容 ({dryRunReport.merged.length} 组)
                      </div>
                      <div className="memory-dry-run-group-list">
                        {dryRunReport.merged.map((m, idx) => (
                          <div key={idx} className="memory-dry-run-card is-merged">
                            <div className="memory-dry-run-before-label">
                              合并前 ({m.before.length} 项):
                            </div>
                            <ul className="memory-dry-run-before-list">
                              {m.before.map((b, bIdx) => (
                                <li key={bIdx}>{b}</li>
                              ))}
                            </ul>
                            <div className="memory-dry-run-after-text">
                              合并后: “{m.after}”
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 删除精简提案 */}
                  {dryRunReport.dropped.length > 0 && (
                    <div className="memory-dry-run-section">
                      <div className="memory-dry-run-section-title is-dropped">
                        建议删除的内容 ({dryRunReport.dropped.length} 条)
                      </div>
                      <div className="memory-dry-run-dropped-list">
                        {dryRunReport.dropped.map((d, idx) => (
                          <div key={idx} className="memory-dry-run-card is-dropped">
                            <span className="memory-dry-run-dropped-text">
                              {d.before[0]}
                            </span>
                            <span className="memory-dry-run-dropped-reason">
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
