import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Cpu,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Upload
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  Bot,
  McpServer,
  SandboxStatus,
  Skill,
  SkillCategory
} from '../../types';
import { useApp } from '../../context/AppContext';
import { CATEGORY_META, launchSkillInChat } from './skillsMeta';
import { SkillCard } from './SkillCard';
import { SkillWorkbenchDrawer, type WorkbenchTab } from './SkillWorkbenchDrawer';
import { SkillCreateImportModal } from './SkillCreateImportModal';

type SummaryQuickFilter = 'all' | 'enabled' | 'ready' | 'missing_deps' | 'workshop' | 'archived';

export const SkillsView: React.FC = () => {
  const { showToast, setTab } = useApp();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpTotalTools, setMcpTotalTools] = useState(0);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 筛选状态
  const [quickFilter, setQuickFilter] = useState<SummaryQuickFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<'all' | SkillCategory>('all');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedBotId, setSelectedBotId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 右侧工作台与创建/导入弹窗
  const [drawerSkillName, setDrawerSkillName] = useState<string | null>(null);
  const [drawerInitialTab, setDrawerInitialTab] = useState<WorkbenchTab>('overview');
  const [modalMode, setModalMode] = useState<'create' | 'import' | null>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [skillsRes, sbRes, mcpRes, botsRes] = await Promise.all([
        api.getSkills({ includeArchived: true }).catch((err) => {
          setLoadError(err?.message || '无法拉取技能列表');
          return { skills: [], total: 0 };
        }),
        api.getSandboxStatus().catch(() => null),
        api.getMcpServers().catch(() => ({ servers: [], totalTools: 0 })),
        api.getBots().catch(() => [])
      ]);
      setSkills(skillsRes.skills || []);
      setSandbox(sbRes);
      setMcpServers(mcpRes.servers || []);
      setMcpTotalTools(mcpRes.totalTools || 0);
      setBots(Array.isArray(botsRes) ? botsRes : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleRefreshReadiness = async () => {
    setProbing(true);
    try {
      await api.refreshSkillsReadiness();
      await loadData();
      showToast('已重新探测本地命令与环境变量就绪度', 'success');
    } catch (err: any) {
      showToast(err?.message || '探测失败', 'error');
    } finally {
      setProbing(false);
    }
  };

  const activeSkills = useMemo(
    () => skills.filter((s) => s.usage?.lifecycleState !== 'archived'),
    [skills]
  );

  const stats = useMemo(() => {
    const enabledCount = activeSkills.filter((s) => s.enabled).length;
    const readyCount = activeSkills.filter((s) => s.readiness?.ready !== false).length;
    const missingDepsCount = activeSkills.filter((s) => s.readiness?.ready === false).length;
    const workshopCount = activeSkills.filter((s) => s.source !== 'builtin').length;
    const archivedCount = skills.length - activeSkills.length;

    const catCounts: Record<string, number> = {};
    for (const s of activeSkills) {
      const cat = s.category || 'utility';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }

    return {
      total: activeSkills.length,
      enabledCount,
      readyCount,
      missingDepsCount,
      workshopCount,
      archivedCount,
      catCounts
    };
  }, [skills, activeSkills]);

  const filteredSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return skills.filter((s) => {
      const isArchived = s.usage?.lifecycleState === 'archived';
      if (quickFilter === 'archived') {
        if (!isArchived) return false;
      } else {
        if (isArchived) return false;
      }

      if (quickFilter === 'enabled' && !s.enabled) return false;
      if (quickFilter === 'ready' && s.readiness?.ready === false) return false;
      if (quickFilter === 'missing_deps' && s.readiness?.ready !== false) return false;
      if (quickFilter === 'workshop' && s.source === 'builtin') return false;

      if (selectedCategory !== 'all' && s.category !== selectedCategory) return false;
      if (selectedSource !== 'all' && s.source !== selectedSource) return false;

      if (selectedBotId !== 'all') {
        const matchBot = s.everyBot || (s.assignedBots || []).includes(selectedBotId);
        if (!matchBot) return false;
      }

      if (q) {
        const hitName = s.name.toLowerCase().includes(q);
        const hitDesc = s.description.toLowerCase().includes(q);
        const hitBins = (s.requires?.bins || []).some((b) => b.toLowerCase().includes(q));
        const hitEnv = (s.requires?.env || []).some((e) => e.toLowerCase().includes(q));
        if (!hitName && !hitDesc && !hitBins && !hitEnv) return false;
      }

      return true;
    });
  }, [skills, quickFilter, selectedCategory, selectedSource, selectedBotId, searchQuery]);

  const activeDrawerSkill = useMemo(
    () => (drawerSkillName ? skills.find((s) => s.name === drawerSkillName) || null : null),
    [skills, drawerSkillName]
  );

  const handleToggleEnabled = async (skill: Skill) => {
    try {
      const res = await api.patchSkill(skill.name, { enabled: !skill.enabled });
      setSkills((prev) => prev.map((s) => (s.name === skill.name ? res.skill : s)));
      showToast(`技能 /${skill.name} 已${res.skill.enabled ? '启用' : '禁用'}`, 'success');
    } catch (err: any) {
      showToast(err?.message || '操作失败', 'error');
    }
  };

  const handleTogglePin = async (skill: Skill) => {
    try {
      const res = await api.patchSkill(skill.name, { pinned: !skill.usage?.pinned });
      setSkills((prev) => prev.map((s) => (s.name === skill.name ? res.skill : s)));
      showToast(res.skill.usage?.pinned ? '已置顶该技能' : '已取消置顶', 'success');
    } catch (err: any) {
      showToast(err?.message || '置顶操作失败', 'error');
    }
  };

  const handleUseInChat = (skill: Skill) => {
    launchSkillInChat(skill.name, setTab);
  };

  const hasFilter =
    quickFilter !== 'all' ||
    selectedCategory !== 'all' ||
    selectedSource !== 'all' ||
    selectedBotId !== 'all' ||
    Boolean(searchQuery);

  const resetFilters = () => {
    setQuickFilter('all');
    setSelectedCategory('all');
    setSelectedSource('all');
    setSelectedBotId('all');
    setSearchQuery('');
  };

  return (
    <div className="skills-page">
      {/* 紧凑单行页头 + 运行环境 */}
      <div className="skills-header">
        <div className="skills-header-main">
          <div className="skills-title-row">
            <h1 className="skills-title">技能规程库</h1>
            <span className="skills-count">{stats.total} 个可用</span>
            <span className={`env-chip ${sandbox?.available ? 'is-ok' : 'is-warn'}`}>
              <span className="env-dot" />
              <Box size={12} />
              {sandbox?.available ? `微沙箱 · ${sandbox.engine}` : '受控子进程'}
            </span>
            <span className="env-chip">
              <Cpu size={12} />
              MCP {mcpServers.length} · {mcpTotalTools} 工具
            </span>
          </div>
          <p className="skills-sub">
            标准化任务规程、配套沙箱脚本与自学习能力沉淀，支持就地密钥配置、质量体检与真实 Loop 试运行。
          </p>
        </div>

        <div className="skills-actions">
          <button type="button" className="om-btn-subtle" onClick={handleRefreshReadiness} disabled={probing || loading}>
            <RefreshCw size={14} className={probing || loading ? 'spin' : ''} />
            重新探测环境
          </button>
          <button type="button" className="om-btn-subtle" onClick={() => setModalMode('import')}>
            <Upload size={14} />
            导入技能
          </button>
          <button type="button" className="om-btn-primary" onClick={() => setModalMode('create')}>
            <Plus size={15} />
            新建技能
          </button>
        </div>
      </div>

      {loadError && (
        <div className="view-load-error is-spaced" role="alert">
          <AlertTriangle size={14} />
          <span>技能规程加载失败：{loadError}</span>
          <button type="button" onClick={loadData} disabled={loading}>重试</button>
        </div>
      )}

      {/* 紧凑可点击摘要条（替代大占屏卡片） */}
      <div className="skills-summary-bar" role="group" aria-label="状态快速筛选">
        <button
          type="button"
          className={`summary-pill${quickFilter === 'all' ? ' is-active' : ''}`}
          onClick={() => setQuickFilter('all')}
        >
          <span>全部规程</span>
          <strong>{stats.total}</strong>
        </button>
        <button
          type="button"
          className={`summary-pill${quickFilter === 'enabled' ? ' is-active' : ''}`}
          onClick={() => setQuickFilter(quickFilter === 'enabled' ? 'all' : 'enabled')}
        >
          <span>已启用</span>
          <strong>{stats.enabledCount}</strong>
        </button>
        <button
          type="button"
          className={`summary-pill is-ok${quickFilter === 'ready' ? ' is-active' : ''}`}
          onClick={() => setQuickFilter(quickFilter === 'ready' ? 'all' : 'ready')}
        >
          <span>环境就绪</span>
          <strong>{stats.readyCount}</strong>
        </button>
        <button
          type="button"
          className={`summary-pill is-warn${quickFilter === 'missing_deps' ? ' is-active' : ''}`}
          onClick={() => setQuickFilter(quickFilter === 'missing_deps' ? 'all' : 'missing_deps')}
        >
          <span>待配置依赖</span>
          <strong>{stats.missingDepsCount}</strong>
        </button>
        <button
          type="button"
          className={`summary-pill is-violet${quickFilter === 'workshop' ? ' is-active' : ''}`}
          onClick={() => setQuickFilter(quickFilter === 'workshop' ? 'all' : 'workshop')}
        >
          <span>自建与工坊</span>
          <strong>{stats.workshopCount}</strong>
        </button>
        {stats.archivedCount > 0 && (
          <button
            type="button"
            className={`summary-pill${quickFilter === 'archived' ? ' is-active' : ''}`}
            onClick={() => setQuickFilter(quickFilter === 'archived' ? 'all' : 'archived')}
          >
            <span>已归档</span>
            <strong>{stats.archivedCount}</strong>
          </button>
        )}
      </div>

      {/* 分类与筛选工具栏 */}
      <div className="skills-toolbar">
        <div className="skills-cats">
          <button
            type="button"
            className={`cat-pill${selectedCategory === 'all' ? ' is-active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            全部分类
          </button>
          {(Object.keys(CATEGORY_META) as SkillCategory[]).map((catKey) => {
            const meta = CATEGORY_META[catKey];
            return (
              <button
                key={catKey}
                type="button"
                className={`cat-pill ${meta.className}${selectedCategory === catKey ? ' is-active' : ''}`}
                onClick={() => setSelectedCategory(selectedCategory === catKey ? 'all' : catKey)}
              >
                {meta.icon}
                {meta.label} ({stats.catCounts[catKey] || 0})
              </button>
            );
          })}
          <button
            type="button"
            className={`cat-pill cat-learned${selectedSource === 'learned' ? ' is-active' : ''}`}
            onClick={() => setSelectedSource(selectedSource === 'learned' ? 'all' : 'learned')}
          >
            <Sparkles size={13} />
            工坊自学 ({activeSkills.filter((s) => s.source === 'learned').length})
          </button>
        </div>

        <div className="skills-filters">
          <div className="skills-search">
            <Search size={14} />
            <input
              type="text"
              aria-label="搜索技能"
              placeholder="搜索技能名称、触发描述、命令 (bash/python) 或环境变量…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" aria-label="清空搜索" className="search-clear" onClick={() => setSearchQuery('')}>
                ✕
              </button>
            )}
          </div>

          <select
            className="skills-select"
            aria-label="来源筛选"
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
          >
            <option value="all">全部来源</option>
            <option value="builtin">内置基座</option>
            <option value="custom">用户自建</option>
            <option value="imported">外部导入</option>
            <option value="learned">工坊自学</option>
          </select>

          {bots.length > 0 && (
            <select
              className="skills-select"
              aria-label="数字员工筛选"
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
            >
              <option value="all">全部数字员工</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {hasFilter && (
            <button type="button" className="om-btn-subtle skills-clear" onClick={resetFilters}>
              重置筛选
            </button>
          )}
        </div>
      </div>

      {/* 技能卡片网格 */}
      {loading && skills.length === 0 ? (
        <div className="skills-loading" aria-label="加载中">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="sk-card" />
          ))}
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="skill-empty">
          <Box size={30} />
          <div className="skill-empty-title">暂无匹配的技能规程</div>
          <div className="skill-empty-sub">
            可以调整上方的筛选条件，或者点击右上角新建、导入外部技能包。
          </div>
        </div>
      ) : (
        <div className="skills-grid">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.name}
              skill={skill}
              onToggleEnabled={handleToggleEnabled}
              onTogglePin={handleTogglePin}
              onUseInChat={handleUseInChat}
              onOpenWorkbench={(target, tab = 'overview') => {
                setDrawerSkillName(target.name);
                setDrawerInitialTab(tab);
              }}
            />
          ))}
        </div>
      )}

      {/* 右侧滑出式技能工作台 */}
      <SkillWorkbenchDrawer
        skill={activeDrawerSkill}
        initialTab={drawerInitialTab}
        bots={bots}
        onClose={() => setDrawerSkillName(null)}
        onSkillUpdated={(updated) => {
          setSkills((prev) => prev.map((s) => (s.name === updated.name ? updated : s)));
        }}
        onSkillDeleted={(deletedName) => {
          setSkills((prev) => prev.filter((s) => s.name !== deletedName));
          setDrawerSkillName(null);
        }}
        onRefreshAll={loadData}
        onUseInChat={handleUseInChat}
      />

      {/* 新建 / 多渠道导入弹窗 */}
      <SkillCreateImportModal
        mode={modalMode}
        onClose={() => setModalMode(null)}
        onCompleted={async (createdSkill) => {
          setModalMode(null);
          await loadData();
          setDrawerSkillName(createdSkill.name);
          setDrawerInitialTab('overview');
        }}
      />
    </div>
  );
};
