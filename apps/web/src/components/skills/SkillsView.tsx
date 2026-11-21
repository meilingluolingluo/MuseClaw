import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Layers,
  Box,
  RefreshCw,
  Search,
  Plus,
  Upload,
  Play,
  Trash2,
  Edit3,
  Bot as BotIcon,
  Code,
  Terminal,
  Globe,
  FileText,
  FileCode,
  Archive,
  Folder,
  FilePlus,
  Save,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  BookOpen,
  Cpu
} from 'lucide-react';
import { api } from '../../services/api';
import type { SandboxStatus, McpServer, Skill, Bot, SkillCategory, SkillSource, SkillFileEntry } from '../../types';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { renderMarkdown } from '../../utils/markdown';
import { ToolTrace } from '../chat/ToolTrace';

const CATEGORY_CONFIG: Record<
  SkillCategory,
  { label: string; color: string; icon: React.ReactNode }
> = {
  devops: { label: '系统运维', color: '#0284c7', icon: <Terminal size={13} /> },
  productivity: { label: '办公协作', color: '#10b981', icon: <FileText size={13} /> },
  research: { label: '深度研究', color: '#8b5cf6', icon: <Globe size={13} /> },
  integration: { label: '生态集成', color: '#f59e0b', icon: <Box size={13} /> },
  utility: { label: '实用工具', color: '#06b6d4', icon: <Code size={13} /> },
  custom: { label: '自定义/工坊', color: '#ec4899', icon: <Layers size={13} /> }
};

const SOURCE_LABELS: Record<SkillSource, string> = {
  builtin: '内置基座',
  custom: '用户自建',
  imported: 'ZIP 导入',
  learned: '工坊自学'
};

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const SkillsView: React.FC = () => {
  const { showToast } = useApp();

  // 数据状态
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpTotalTools, setMcpTotalTools] = useState(0);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(false);

  // 筛选与搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedReadiness, setSelectedReadiness] = useState<string>('all');
  const [selectedBotId, setSelectedBotId] = useState<string>('all');

  // 技能包详情与文件浏览器状态
  const [inspectSkill, setInspectSkill] = useState<Skill | null>(null);
  const [inspectTab, setInspectTab] = useState<'files' | 'body'>('files');
  const [selectedFileRelPath, setSelectedFileRelPath] = useState<string>('SKILL.md');
  const [activeFileContent, setActiveFileContent] = useState<string>('');
  const [activeFileLoading, setActiveFileLoading] = useState(false);
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [fileEditBuffer, setFileEditBuffer] = useState('');
  const [savingFile, setSavingFile] = useState(false);
  const [newFileModalOpen, setNewFileModalOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [deletingSkillName, setDeletingSkillName] = useState<string | null>(null);
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null);
  const deleteSkillTimerRef = useRef<any>(null);
  const deleteFileTimerRef = useRef<any>(null);
  const fileLoadSeq = useRef(0);

  // 新建技能
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    category: 'devops' as SkillCategory,
    requiresBins: '',
    requiresEnv: '',
    allowedTools: '',
    instructions: ''
  });
  const [createError, setCreateError] = useState('');

  // 导入技能（仅 ZIP，支持拖拽）
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importZipFile, setImportZipFile] = useState<File | null>(null);
  const [uploadingZip, setUploadingZip] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 试运行技能
  const [testTarget, setTestTarget] = useState<Skill | null>(null);
  const [testBotId, setTestBotId] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{
    output: string;
    toolCalls?: Array<{ tool: string; params?: any; result?: any; status?: string; durationMs?: number; ok?: boolean }>;
  } | null>(null);

  // 分配 Bot
  const [assignTarget, setAssignTarget] = useState<Skill | null>(null);
  const [assignEveryBot, setAssignEveryBot] = useState(true);
  const [assignSelectedBots, setAssignSelectedBots] = useState<string[]>([]);

  // 加载数据
  const loadData = async () => {
    setLoading(true);
    try {
      const [skillsRes, sbRes, mcpRes, botsRes] = await Promise.all([
        api.getSkills(),
        api.getSandboxStatus().catch(() => null),
        api.getMcpServers().catch(() => ({ servers: [], totalTools: 0 })),
        api.getBots().catch(() => [])
      ]);
      setSkills(skillsRes.skills || []);
      setSandbox(sbRes);
      setMcpServers(mcpRes.servers || []);
      setMcpTotalTools(mcpRes.totalTools || 0);
      setBots(Array.isArray(botsRes) ? botsRes : []);
    } catch (err: any) {
      showToast(err.message || '加载技能规程库失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 统计指标计算
  const stats = useMemo(() => {
    const total = skills.length;
    const readyCount = skills.filter((s) => s.readiness?.ready).length;
    const missingDepsCount = total - readyCount;
    const workshopCount = skills.filter((s) => s.source === 'learned' || s.source === 'custom' || s.source === 'imported').length;
    const enabledCount = skills.filter((s) => s.enabled).length;

    const catCounts: Record<string, number> = {};
    for (const s of skills) {
      const c = s.category || 'utility';
      catCounts[c] = (catCounts[c] || 0) + 1;
    }

    return { total, readyCount, missingDepsCount, workshopCount, enabledCount, catCounts };
  }, [skills]);

  // 过滤后的技能列表
  const filteredSkills = useMemo(() => {
    return skills.filter((s) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inName = s.name.toLowerCase().includes(q);
        const inDesc = s.description.toLowerCase().includes(q);
        const inCat = (s.category || '').toLowerCase().includes(q);
        const inBins = (s.requires?.bins || []).some((b) => b.toLowerCase().includes(q));
        const inEnv = (s.requires?.env || []).some((e) => e.toLowerCase().includes(q));
        const inFiles = (s.files || []).some((f) => f.path.toLowerCase().includes(q));
        if (!inName && !inDesc && !inCat && !inBins && !inEnv && !inFiles) return false;
      }
      if (selectedCategory !== 'all') {
        if (selectedCategory === 'learned') {
          if (s.source !== 'learned') return false;
        } else if (s.category !== selectedCategory) {
          return false;
        }
      }
      if (selectedSource !== 'all' && s.source !== selectedSource) return false;
      if (selectedReadiness === 'ready' && !s.readiness?.ready) return false;
      if (selectedReadiness === 'missing_deps' && s.readiness?.ready) return false;
      if (selectedBotId !== 'all') {
        const matches = s.everyBot || (s.assignedBots || []).includes(selectedBotId);
        if (!matches) return false;
      }
      return true;
    });
  }, [skills, searchQuery, selectedCategory, selectedSource, selectedReadiness, selectedBotId]);

  // 切换启用状态
  const handleToggle = async (skill: Skill) => {
    try {
      const updated = await api.patchSkill(skill.name, { enabled: !skill.enabled });
      setSkills((prev) => prev.map((item) => (item.name === skill.name ? updated.skill : item)));
      showToast(`技能 "${skill.name}" 已${!skill.enabled ? '启用' : '禁用'}`, 'success');
    } catch (err: any) {
      showToast(err.message || '更新技能状态失败', 'error');
    }
  };

  // 打开包文件查看器
  const handleInspectPackage = async (skill: Skill, targetFile: string = 'SKILL.md') => {
    setInspectSkill(skill);
    setSelectedFileRelPath(targetFile);
    setIsEditingFile(false);
    setInspectTab('files');
    await loadFileContent(skill.name, targetFile);
  };

  // 读取包内文件内容（带序号，丢弃过期响应避免快速切换时串台）
  const loadFileContent = async (skillName: string, filePath: string) => {
    const seq = ++fileLoadSeq.current;
    setActiveFileLoading(true);
    try {
      const res = await api.getSkillFileContent(skillName, filePath);
      if (seq !== fileLoadSeq.current) return;
      if (res.success && res.content !== undefined) {
        setActiveFileContent(res.content);
        setFileEditBuffer(res.content);
      } else {
        setActiveFileContent(res.error || '无法读取文件内容');
        setFileEditBuffer('');
      }
    } catch (err: any) {
      if (seq !== fileLoadSeq.current) return;
      setActiveFileContent(`读取文件失败: ${err.message}`);
      setFileEditBuffer('');
    } finally {
      if (seq === fileLoadSeq.current) setActiveFileLoading(false);
    }
  };

  // 保存当前编辑的文件
  const handleSaveFileContent = async () => {
    if (!inspectSkill || savingFile) return;
    setSavingFile(true);
    try {
      const res = await api.saveSkillFile(inspectSkill.name, selectedFileRelPath, fileEditBuffer);
      if (res.success) {
        setActiveFileContent(fileEditBuffer);
        setIsEditingFile(false);
        showToast(`文件 "${selectedFileRelPath}" 保存成功`, 'success');
        const fresh = await api.getSkill(inspectSkill.name);
        setInspectSkill(fresh.skill);
        setSkills((prev) => prev.map((s) => (s.name === inspectSkill.name ? fresh.skill : s)));
      } else {
        showToast(res.error || '保存文件失败', 'error');
      }
    } catch (err: any) {
      showToast(err.message || '保存文件发生错误', 'error');
    } finally {
      setSavingFile(false);
    }
  };

  // 新建包内文件
  const handleCreateNewFile = async () => {
    if (!inspectSkill) return;
    const cleanPath = newFilePath.trim().replace(/^\/+/, '');
    try {
      const initialContent = cleanPath.endsWith('.sh') ? '#!/bin/bash\nset -euo pipefail\n\n' : cleanPath.endsWith('.py') ? '#!/usr/bin/env python3\n\n' : '';
      const res = await api.saveSkillFile(inspectSkill.name, cleanPath, initialContent);
      if (res.success) {
        showToast(`文件 "${cleanPath}" 创建成功`, 'success');
        setNewFileModalOpen(false);
        setNewFilePath('');
        const fresh = await api.getSkill(inspectSkill.name);
        setInspectSkill(fresh.skill);
        setSkills((prev) => prev.map((s) => (s.name === inspectSkill.name ? fresh.skill : s)));
        setSelectedFileRelPath(cleanPath);
        await loadFileContent(inspectSkill.name, cleanPath);
      } else {
        showToast(res.error || '创建文件失败', 'error');
      }
    } catch (err: any) {
      showToast(err.message || '创建文件发生错误', 'error');
    }
  };

  // 删除包内文件
  const handleDeleteFile = async (filePath: string) => {
    if (!inspectSkill) return;
    if (filePath === 'SKILL.md') {
      showToast('SKILL.md 是核心规程文件，不可删除', 'error');
      return;
    }
    if (deletingFileName !== filePath) {
      setDeletingFileName(filePath);
      if (deleteFileTimerRef.current) clearTimeout(deleteFileTimerRef.current);
      deleteFileTimerRef.current = setTimeout(() => setDeletingFileName(null), 3500);
      return;
    }
    if (deleteFileTimerRef.current) clearTimeout(deleteFileTimerRef.current);
    setDeletingFileName(null);

    try {
      const res = await api.deleteSkillFile(inspectSkill.name, filePath);
      if (res.success) {
        showToast(`已删除文件 "${filePath}"`, 'success');
        const fresh = await api.getSkill(inspectSkill.name);
        setInspectSkill(fresh.skill);
        setSkills((prev) => prev.map((s) => (s.name === inspectSkill.name ? fresh.skill : s)));
        setSelectedFileRelPath('SKILL.md');
        await loadFileContent(inspectSkill.name, 'SKILL.md');
      } else {
        showToast(res.error || '删除文件失败', 'error');
      }
    } catch (err: any) {
      showToast(err.message || '删除文件失败', 'error');
    }
  };

  // 删除整个技能
  const handleDeleteSkill = async (skill: Skill) => {
    if (skill.source === 'builtin') {
      showToast('内置基座核心技能受系统保护，不可删除', 'error');
      return;
    }
    if (deletingSkillName !== skill.name) {
      setDeletingSkillName(skill.name);
      if (deleteSkillTimerRef.current) clearTimeout(deleteSkillTimerRef.current);
      deleteSkillTimerRef.current = setTimeout(() => setDeletingSkillName(null), 3500);
      return;
    }
    if (deleteSkillTimerRef.current) clearTimeout(deleteSkillTimerRef.current);
    setDeletingSkillName(null);

    try {
      await api.deleteSkill(skill.name);
      setSkills((prev) => prev.filter((s) => s.name !== skill.name));
      if (inspectSkill?.name === skill.name) setInspectSkill(null);
      showToast(`技能 "${skill.name}" 已成功删除`, 'success');
    } catch (err: any) {
      showToast(err.message || '删除技能失败', 'error');
    }
  };

  // 创建新技能
  const handleCreateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createForm.name.trim();
    if (!name) {
      setCreateError('技能名称不能为空');
      return;
    }
    if (!NAME_PATTERN.test(name)) {
      setCreateError('名称仅限小写字母、数字和横线，需以字母或数字开头');
      return;
    }
    if (!createForm.description.trim()) {
      setCreateError('请填写一句话触发说明，Agent 依据它决定何时调用');
      return;
    }
    setCreateError('');

    const bins = createForm.requiresBins.split(',').map((s) => s.trim()).filter(Boolean);
    const env = createForm.requiresEnv.split(',').map((s) => s.trim()).filter(Boolean);
    const tools = createForm.allowedTools.split(',').map((s) => s.trim()).filter(Boolean);

    try {
      const res = await api.createSkill({
        name,
        description: createForm.description.trim(),
        category: createForm.category,
        requires: {
          bins: bins.length > 0 ? bins : undefined,
          env: env.length > 0 ? env : undefined
        },
        allowedTools: tools.length > 0 ? tools : undefined,
        body: createForm.instructions.trim() || undefined
      });
      setSkills((prev) => [res.skill, ...prev]);
      setIsCreateOpen(false);
      setCreateForm({
        name: '',
        description: '',
        category: 'devops',
        requiresBins: '',
        requiresEnv: '',
        allowedTools: '',
        instructions: ''
      });
      showToast(`技能 "${res.skill.name}" 创建成功`, 'success');
    } catch (err: any) {
      setCreateError(err.message || '创建技能失败');
    }
  };

  // 选择/拖入 ZIP 包
  const acceptZipFile = (file: File | null | undefined) => {
    if (!file) return;
    const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
    if (!isZip) {
      showToast('只支持 .zip 技能包文件', 'error');
      return;
    }
    setImportZipFile(file);
  };

  const handleImportSubmit = async () => {
    if (!importZipFile) {
      showToast('请选择要上传的 .zip 技能包文件', 'error');
      return;
    }
    setUploadingZip(true);
    try {
      const res = await api.uploadSkillZip(importZipFile);
      if (res.success && res.skill) {
        showToast(`成功导入技能包 "${res.skill.name}" (${res.skill.filesCount || 1} 个文件)`, 'success');
        setIsImportOpen(false);
        setImportZipFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        await loadData();
      } else {
        showToast('上传失败：服务端未返回有效技能', 'error');
      }
    } catch (err: any) {
      showToast(err.message || '上传解压技能包失败', 'error');
    } finally {
      setUploadingZip(false);
    }
  };

  // 运行评测
  const handleRunTest = async () => {
    if (!testTarget) return;
    setTestRunning(true);
    setTestResult(null);
    try {
      const res = await api.testSkill(testTarget.name, testInput, testBotId || undefined);
      setTestResult({
        output: res.output || '规程执行完成，未产生额外输出。',
        toolCalls: (res.toolCalls || []).map((tc: any) => ({
          tool: tc.tool || tc.name || tc.function?.name || 'tool',
          params: tc.params ?? tc.input ?? (tc.function?.arguments ? safeParseArgs(tc.function.arguments) : undefined),
          result: tc.result ?? tc.output,
          status: tc.status || 'done',
          durationMs: tc.durationMs
        }))
      });
      showToast('技能沙箱评测执行完毕', 'success');
    } catch (err: any) {
      setTestResult({ output: `评测执行异常: ${err.message}` });
      showToast(err.message || '评测失败', 'error');
    } finally {
      setTestRunning(false);
    }
  };

  // 保存分配 Bot
  const handleSaveAssign = async () => {
    if (!assignTarget) return;
    if (!assignEveryBot && assignSelectedBots.length === 0) {
      showToast('请至少勾选一个数字员工，或改回全员可用', 'warning');
      return;
    }
    try {
      const updated = await api.patchSkill(assignTarget.name, {
        everyBot: assignEveryBot,
        assignedBots: assignEveryBot ? [] : assignSelectedBots
      });
      setSkills((prev) => prev.map((s) => (s.name === assignTarget.name ? updated.skill : s)));
      setAssignTarget(null);
      showToast(`技能 "${assignTarget.name}" 数字员工可见性已更新`, 'success');
    } catch (err: any) {
      showToast(err.message || '分配数字员工失败', 'error');
    }
  };

  // 新建文件路径校验
  const pathError = (() => {
    const v = newFilePath.trim();
    if (!v) return '';
    if (v.includes('..') || v.startsWith('/') || v.includes('\\') || /\s/.test(v)) {
      return '路径需为相对路径，且不含 ".."、空白或反斜杠';
    }
    return '';
  })();

  const hasActiveFilter =
    selectedCategory !== 'all' ||
    selectedSource !== 'all' ||
    selectedReadiness !== 'all' ||
    selectedBotId !== 'all' ||
    Boolean(searchQuery);

  const resetFilters = () => {
    setSelectedCategory('all');
    setSelectedSource('all');
    setSelectedReadiness('all');
    setSelectedBotId('all');
    setSearchQuery('');
  };

  const fileIcon = (path: string, executable?: boolean) => {
    if (path.startsWith('scripts/') || executable) return <Terminal size={13} color="#0284c7" />;
    if (path.startsWith('assets/')) return <FileCode size={13} color="#10b981" />;
    if (path.startsWith('references/')) return <FileText size={13} color="#8b5cf6" />;
    return <FileText size={13} />;
  };

  return (
    <div className="skills-page">
      {/* 头部标题与操作 */}
      <div className="skills-header">
        <div>
          <div className="skills-title-row">
            <h1 className="skills-title">技能规程库 (Agent Skills)</h1>
            <span className="skills-count">{skills.length} 个规程包</span>
          </div>
          <p className="skills-sub">
            标准化工程规程包（含 SKILL.md、配套执行脚本、参考资料与资产模板），支持依赖探测、工坊自学沉淀与沙箱直调。
          </p>
        </div>

        <div className="skills-actions">
          <button type="button" className="om-btn-subtle" onClick={loadData} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            刷新
          </button>
          <button type="button" className="om-btn-subtle" onClick={() => setIsImportOpen(true)}>
            <Upload size={14} />
            导入 ZIP 包
          </button>
          <button type="button" className="om-btn-primary" onClick={() => { setCreateError(''); setIsCreateOpen(true); }}>
            <Plus size={15} />
            新建技能
          </button>
        </div>
      </div>

      {/* 运行环境概览 */}
      <div className="skills-env" role="status">
        <span className={`env-chip ${sandbox?.available ? 'is-ok' : 'is-warn'}`}>
          <span className="env-dot" />
          <Box size={13} />
          {sandbox?.available
            ? `微沙箱就绪 · ${sandbox.engine}${sandbox.version ? ` ${sandbox.version}` : ''}${sandbox.blocksNetwork ? ' · 网络隔离' : ''}`
            : '标准受控子进程模式'}
        </span>
        <span className="env-chip">
          <span className="env-dot" />
          <Cpu size={13} />
          MCP {mcpServers.length} 个服务 · {mcpTotalTools} 个工具
        </span>
      </div>

      {/* 顶部指标统计看板 */}
      <div className="skills-stats">
        <div className="stat-card">
          <div className="stat-label"><Box size={14} /> 技能规程总数</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-note">已启用 {stats.enabledCount} 个规程</div>
        </div>
        <div className="stat-card" data-tone="ok">
          <div className="stat-label"><CheckCircle2 size={14} /> 环境依赖就绪</div>
          <div className="stat-value">{stats.readyCount}</div>
          <div className="stat-note">系统命令与环境变量齐备</div>
        </div>
        <div className="stat-card" data-tone="warn">
          <div className="stat-label"><AlertCircle size={14} /> 待配置环境</div>
          <div className="stat-value">{stats.missingDepsCount}</div>
          <div className="stat-note">需配置 API Key 或安装系统工具</div>
        </div>
        <div className="stat-card" data-tone="violet">
          <div className="stat-label"><BookOpen size={14} /> 自建与工坊沉淀</div>
          <div className="stat-value">{stats.workshopCount}</div>
          <div className="stat-note">用户扩展包与 Agent 自学习经验</div>
        </div>
      </div>

      {/* 业务分类与筛选 */}
      <div className="skills-toolbar">
        <div className="skills-cats">
          <span className="skills-cats-label">业务分类</span>
          <button
            type="button"
            className={`cat-pill${selectedCategory === 'all' ? ' is-active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            全部 ({skills.length})
          </button>
          {(Object.keys(CATEGORY_CONFIG) as SkillCategory[]).map((catKey) => {
            const cat = CATEGORY_CONFIG[catKey];
            return (
              <button
                key={catKey}
                type="button"
                className={`cat-pill${selectedCategory === catKey ? ' is-active' : ''}`}
                style={{ ['--cat-color' as any]: cat.color }}
                onClick={() => setSelectedCategory(catKey)}
              >
                {cat.icon}
                {cat.label} ({stats.catCounts[catKey] || 0})
              </button>
            );
          })}
          <button
            type="button"
            className={`cat-pill${selectedCategory === 'learned' ? ' is-active' : ''}`}
            style={{ ['--cat-color' as any]: '#d97706' }}
            onClick={() => setSelectedCategory('learned')}
          >
            <Sparkles size={13} />
            工坊自学 ({skills.filter((s) => s.source === 'learned').length})
          </button>
        </div>

        <div className="skills-filters">
          <div className="skills-search">
            <Search size={14} />
            <input
              type="text"
              aria-label="搜索技能"
              placeholder="搜索名称、描述、所需命令 (bash/python) 或环境变量…"
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
            <option value="builtin">内置基座 (Builtin)</option>
            <option value="custom">用户自建 (Custom)</option>
            <option value="imported">ZIP 导入 (Imported)</option>
            <option value="learned">工坊自学 (Learned)</option>
          </select>

          <select
            className="skills-select"
            aria-label="就绪状态筛选"
            value={selectedReadiness}
            onChange={(e) => setSelectedReadiness(e.target.value)}
          >
            <option value="all">全部就绪状态</option>
            <option value="ready">仅看环境已就绪</option>
            <option value="missing_deps">仅看待配置依赖</option>
          </select>

          {bots.length > 0 && (
            <select
              className="skills-select"
              aria-label="数字员工筛选"
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
            >
              <option value="all">全部数字员工 (Bot)</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.id})
                </option>
              ))}
            </select>
          )}

          {hasActiveFilter && (
            <button type="button" className="om-btn-subtle skills-clear" onClick={resetFilters}>
              重置筛选
            </button>
          )}
        </div>
      </div>

      {/* 技能卡片网格列表 */}
      {loading && skills.length === 0 ? (
        <div className="skills-loading" aria-label="加载中">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="sk-card" />
          ))}
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="skill-empty">
          <Box size={32} />
          <div className="skill-empty-title">未匹配到任何技能规程</div>
          <div className="skill-empty-sub">
            尝试调整分类选择、就绪状态或搜索关键字，亦可通过顶部按钮新建技能。
          </div>
        </div>
      ) : (
        <div className="skills-grid">
          {filteredSkills.map((skill) => {
            const catCfg = CATEGORY_CONFIG[skill.category] || CATEGORY_CONFIG.utility;
            const isReady = skill.readiness?.ready;

            return (
              <div key={skill.name} className={`skill-card${skill.enabled ? '' : ' is-disabled'}`}>
                <div className="skill-card-main">
                  <div className="skill-head">
                    <div className="skill-badges">
                      <span className="badge badge-cat" style={{ ['--cat-color' as any]: catCfg.color }}>
                        {catCfg.icon}
                        {catCfg.label}
                      </span>
                      <span className="badge badge-src">{SOURCE_LABELS[skill.source] || skill.source}</span>
                      {skill.warnings?.length ? (
                        <span className="badge badge-warn" title={skill.warnings.join('\n')}>
                          {skill.warnings.length} 条提醒
                        </span>
                      ) : null}
                    </div>

                    <label className="skill-switch">
                      <input
                        type="checkbox"
                        checked={skill.enabled}
                        onChange={() => handleToggle(skill)}
                        aria-label={`启用或禁用技能 ${skill.name}`}
                      />
                      <span className={skill.enabled ? 'is-on' : 'is-off'}>{skill.enabled ? '启用' : '禁用'}</span>
                    </label>
                  </div>

                  <div className="skill-name-row">
                    <h3 className="skill-name">/{skill.name}</h3>
                    <span className="skill-ver">v{(skill.metadata as any)?.version || '1.0.0'}</span>
                  </div>

                  <p className="skill-desc">{skill.description}</p>

                  <div className="skill-ready">
                    {isReady ? (
                      <div className="skill-ready-pill is-ok">
                        <CheckCircle2 size={12} />
                        运行环境已就绪
                        {skill.requires?.bins && skill.requires.bins.length > 0 && (
                          <span className="skill-ready-bins">({skill.requires.bins.join(', ')})</span>
                        )}
                      </div>
                    ) : (
                      <div className="skill-ready-pill is-warn" title={skill.readiness?.details}>
                        <AlertCircle size={12} />
                        {skill.readiness?.details || '需要配置环境变量或工具'}
                      </div>
                    )}
                  </div>

                  <div className="skill-meta">
                    <button
                      type="button"
                      className="chip"
                      title="进入包管理浏览具体文件"
                      onClick={() => handleInspectPackage(skill)}
                    >
                      <Folder size={12} />
                      {skill.filesCount || 1} 个文件
                      {skill.scriptsCount ? ` (含 ${skill.scriptsCount} 个脚本)` : ''}
                    </button>

                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        setAssignTarget(skill);
                        setAssignEveryBot(skill.everyBot ?? true);
                        setAssignSelectedBots(skill.assignedBots || []);
                      }}
                    >
                      <BotIcon size={12} />
                      {skill.everyBot ? '全员 Bot 可用' : `${skill.assignedBots?.length || 0} 个 Bot`}
                    </button>
                  </div>
                </div>

                <div className="skill-actions">
                  <button
                    type="button"
                    className="om-btn-subtle skill-action"
                    onClick={() => handleInspectPackage(skill)}
                  >
                    <Folder size={13} />
                    包资源与代码
                  </button>

                  <a
                    href={api.exportSkillZipUrl(skill.name)}
                    download={`${skill.name}.zip`}
                    className="om-btn-subtle skill-action"
                    title="一键打包导出 ZIP"
                  >
                    <Archive size={13} />
                    ZIP
                  </a>

                  <button
                    type="button"
                    className="om-btn-subtle skill-action skill-action-icon"
                    onClick={() => {
                      setTestTarget(skill);
                      setTestInput('');
                      setTestResult(null);
                      setTestBotId('');
                    }}
                    title="沙箱试运行与模拟调用"
                  >
                    <Play size={13} />
                  </button>

                  {skill.source !== 'builtin' && (
                    <button
                      type="button"
                      className={`om-btn-subtle skill-action skill-action-icon is-danger ${deletingSkillName === skill.name ? 'is-confirming' : ''}`}
                      onClick={() => handleDeleteSkill(skill)}
                      title={deletingSkillName === skill.name ? '再次点击确认删除' : '删除此技能包'}
                    >
                      <Trash2 size={13} />
                      {deletingSkillName === skill.name && <span className="inline-confirm-text">确认？</span>}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 模态框 1: 技能工程包资源管理 */}
      {inspectSkill && (
        <Modal isOpen={true} maxWidth="920px" onClose={() => setInspectSkill(null)} title={`技能工程包: /${inspectSkill.name}`}>
          <div className="explorer-body">
            <div className="explorer-tabs">
              <button
                type="button"
                className={`tab-btn${inspectTab === 'files' ? ' is-active' : ''}`}
                onClick={() => setInspectTab('files')}
              >
                <Folder size={14} /> 包内文件 ({inspectSkill.filesCount || 1})
              </button>
              <button
                type="button"
                className={`tab-btn${inspectTab === 'body' ? ' is-active' : ''}`}
                onClick={() => setInspectTab('body')}
              >
                <FileText size={14} /> 规程指南预览
              </button>

              <a
                href={api.exportSkillZipUrl(inspectSkill.name)}
                download={`${inspectSkill.name}.zip`}
                className="om-btn-subtle explorer-export"
              >
                <Archive size={13} /> 导出 ZIP
              </a>
            </div>

            {inspectTab === 'files' && (
              <div className="explorer-split">
                <div className="file-tree">
                  <div className="tree-head">
                    <span>包文件目录</span>
                    <button type="button" onClick={() => setNewFileModalOpen(true)}>
                      <FilePlus size={13} /> 新建
                    </button>
                  </div>

                  <div className="tree-list">
                    {(inspectSkill.files || [{ path: 'SKILL.md', size: 0, isText: true } as SkillFileEntry]).map((f) => {
                      const isSelected = selectedFileRelPath === f.path;
                      return (
                        <div
                          key={f.path}
                          role="button"
                          tabIndex={0}
                          className={`file-item${isSelected ? ' is-active' : ''}`}
                          onClick={() => {
                            setSelectedFileRelPath(f.path);
                            setIsEditingFile(false);
                            loadFileContent(inspectSkill.name, f.path);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setSelectedFileRelPath(f.path);
                              setIsEditingFile(false);
                              loadFileContent(inspectSkill.name, f.path);
                            }
                          }}
                        >
                          <span className="file-name">
                            {fileIcon(f.path, f.executable)}
                            {f.path}
                          </span>
                          <span className="file-size">{f.size ? `${Math.round((f.size / 1024) * 10) / 10}k` : ''}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="tree-foot">
                    磁盘落盘位置
                    <div className="tree-path">{inspectSkill.dirPath || '系统托管存储区'}</div>
                  </div>
                </div>

                <div className="editor-pane">
                  <div className="editor-bar">
                    <div className="editor-title">
                      <FileText size={13} />
                      <span>{selectedFileRelPath}</span>
                      {selectedFileRelPath.startsWith('scripts/') && (
                        <span className="editor-badge">微沙箱可执行脚本</span>
                      )}
                    </div>

                    <div className="editor-actions">
                      {isEditingFile ? (
                        <>
                          <button
                            type="button"
                            className="om-btn-subtle"
                            onClick={() => {
                              setIsEditingFile(false);
                              setFileEditBuffer(activeFileContent);
                            }}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="om-btn-primary"
                            onClick={handleSaveFileContent}
                            disabled={savingFile}
                          >
                            <Save size={12} /> {savingFile ? '保存中…' : '保存更新'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="om-btn-subtle" onClick={() => setIsEditingFile(true)}>
                            <Edit3 size={12} /> 在线编辑
                          </button>
                          {selectedFileRelPath !== 'SKILL.md' && (
                            <button
                              type="button"
                              className={`om-btn-subtle editor-delete ${deletingFileName === selectedFileRelPath ? 'is-confirming' : ''}`}
                              onClick={() => handleDeleteFile(selectedFileRelPath)}
                            >
                              <Trash2 size={12} /> {deletingFileName === selectedFileRelPath ? '确认删除？' : '删除'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="editor-content">
                    {activeFileLoading ? (
                      <div className="editor-loading" role="status">加载文件中…</div>
                    ) : isEditingFile ? (
                      <textarea
                        className="code-edit"
                        value={fileEditBuffer}
                        onChange={(e) => setFileEditBuffer(e.target.value)}
                        aria-label={`编辑文件 ${selectedFileRelPath}`}
                      />
                    ) : (
                      <pre className="code-view">{activeFileContent}</pre>
                    )}
                  </div>
                </div>
              </div>
            )}

            {inspectTab === 'body' && (
              <div className="md-preview markdown-body">
                {(inspectSkill.body || inspectSkill.content) ? (
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(inspectSkill.body || inspectSkill.content) }} />
                ) : (
                  <p className="tool-row-hint">该技能暂无规程正文</p>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 模态框 2: 新建包内文件 */}
      {newFileModalOpen && inspectSkill && (
        <Modal isOpen={true} onClose={() => setNewFileModalOpen(false)} title={`新建文件到 /${inspectSkill.name}`}>
          <div className="form-col">
            <p className="skills-note">
              输入相对路径，如 <code>scripts/custom_check.sh</code> 或 <code>references/spec.md</code>。
            </p>
            <div className="form-field">
              <label className="form-label" htmlFor="skill-new-file-path">文件路径</label>
              <input
                id="skill-new-file-path"
                type="text"
                className="form-input"
                placeholder="scripts/my_helper.sh"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
              />
              {pathError && <span className="form-error">{pathError}</span>}
            </div>
            <div className="form-actions">
              <button type="button" className="om-btn-subtle" onClick={() => setNewFileModalOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="om-btn-primary"
                onClick={handleCreateNewFile}
                disabled={!newFilePath.trim() || Boolean(pathError)}
              >
                创建文件
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 模态框 3: 新建自定义技能包 */}
      {isCreateOpen && (
        <Modal isOpen={true} onClose={() => setIsCreateOpen(false)} title="新建 Agent 技能规程包">
          <form onSubmit={handleCreateSkill} className="form-col">
            <div className="form-field">
              <label className="form-label" htmlFor="skill-create-name">技能标识 (Name) *</label>
              <input
                id="skill-create-name"
                type="text"
                className="form-input"
                placeholder="如 git-review, host-cleaner"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
              />
              <span className="form-hint">仅限小写英文字母、数字和横线</span>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label className="form-label" htmlFor="skill-create-category">业务分类 *</label>
                <select
                  id="skill-create-category"
                  className="form-input"
                  value={createForm.category}
                  onChange={(e) => setCreateForm({ ...createForm, category: e.target.value as SkillCategory })}
                >
                  <option value="devops">系统运维 (DevOps)</option>
                  <option value="productivity">办公协作 (Productivity)</option>
                  <option value="research">深度研究 (Research)</option>
                  <option value="integration">生态集成 (Integration)</option>
                  <option value="utility">实用工具 (Utility)</option>
                  <option value="custom">自建/工坊 (Custom)</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="skill-create-bins">所需系统命令 (bins)</label>
                <input
                  id="skill-create-bins"
                  type="text"
                  className="form-input"
                  placeholder="如 bash, python3, curl"
                  value={createForm.requiresBins}
                  onChange={(e) => setCreateForm({ ...createForm, requiresBins: e.target.value })}
                />
              </div>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="skill-create-env">所需环境变量 (env)</label>
              <input
                id="skill-create-env"
                type="text"
                className="form-input"
                placeholder="如 GITHUB_TOKEN, OPENAI_API_KEY (逗号分隔)"
                value={createForm.requiresEnv}
                onChange={(e) => setCreateForm({ ...createForm, requiresEnv: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="skill-create-desc">一句话触发说明 (Description) *</label>
              <input
                id="skill-create-desc"
                type="text"
                className="form-input"
                placeholder="说明该技能的功能以及何时触发调用"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="skill-create-body">规程指令正文 (Markdown)</label>
              <textarea
                id="skill-create-body"
                className="form-input code-textarea"
                placeholder="# 技能指导步骤..."
                value={createForm.instructions}
                onChange={(e) => setCreateForm({ ...createForm, instructions: e.target.value })}
                rows={6}
              />
            </div>

            {createError && (
              <div className="form-error" role="alert">{createError}</div>
            )}

            <div className="form-actions">
              <button type="button" className="om-btn-subtle" onClick={() => setIsCreateOpen(false)}>取消</button>
              <button type="submit" className="om-btn-primary">创建并保存</button>
            </div>
          </form>
        </Modal>
      )}

      {/* 模态框 4: 导入 ZIP */}
      {isImportOpen && (
        <Modal isOpen={true} onClose={() => setIsImportOpen(false)} title="导入技能规程包">
          <div className="form-col">
            <div
              className={`import-drop${isDragOver ? ' is-dragover' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="拖拽或点击选择 ZIP 文件"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                acceptZipFile(e.dataTransfer.files?.[0]);
              }}
            >
              <Upload size={22} />
              <div className="import-drop-title">拖拽 .zip 技能包到此处</div>
              <div className="import-drop-sub">或点击选择文件 · 包含 SKILL.md、scripts/ 脚本与 assets/ 模板</div>
              <input
                type="file"
                accept=".zip,application/zip"
                aria-label="选择技能 ZIP 包"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={(e) => acceptZipFile(e.target.files?.[0])}
              />
            </div>

            {importZipFile && (
              <div className="import-file">
                <FileCode size={14} />
                <span className="import-file-name">{importZipFile.name}</span>
                <span className="import-file-size">{Math.max(1, Math.round(importZipFile.size / 1024))} KB</span>
                <button
                  type="button"
                  className="import-file-remove"
                  aria-label="移除文件"
                  onClick={(e) => {
                    e.stopPropagation();
                    setImportZipFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            <div className="form-actions">
              <button type="button" className="om-btn-subtle" onClick={() => setIsImportOpen(false)}>取消</button>
              <button type="button" className="om-btn-primary" onClick={handleImportSubmit} disabled={uploadingZip || !importZipFile}>
                {uploadingZip ? '解压校验中…' : '确认导入'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 模态框 5: 沙箱试运行 */}
      {testTarget && (
        <Modal isOpen={true} onClose={() => setTestTarget(null)} title={`沙箱试运行: /${testTarget.name}`}>
          <div className="form-col">
            <div className="test-meta">
              分类: {CATEGORY_CONFIG[testTarget.category]?.label} · 包含 {testTarget.filesCount || 1} 个包文件
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="skill-test-bot">执行数字员工</label>
              <select
                id="skill-test-bot"
                className="form-input"
                value={testBotId}
                onChange={(e) => setTestBotId(e.target.value)}
              >
                <option value="">默认 Bot</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
                ))}
              </select>
            </div>
            <textarea
              className="form-input"
              placeholder="输入用户模拟指令，如：帮我检查下系统根分区和内存剩余情况…"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              rows={3}
              aria-label="模拟指令"
            />
            <div className="form-actions">
              <button type="button" className="om-btn-subtle" onClick={() => setTestTarget(null)}>关闭</button>
              <button type="button" className="om-btn-primary" onClick={handleRunTest} disabled={testRunning}>
                {testRunning ? '沙箱执行中…' : '开始试运行'}
              </button>
            </div>

            {testResult && (
              <div className="test-out">
                <div className="test-out-title">执行输出</div>
                {testResult.toolCalls && testResult.toolCalls.length > 0 && (
                  <ToolTrace tools={testResult.toolCalls} />
                )}
                <pre>{testResult.output}</pre>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 模态框 6: 分配数字员工 */}
      {assignTarget && (
        <Modal isOpen={true} onClose={() => setAssignTarget(null)} title={`授权数字员工: /${assignTarget.name}`}>
          <div className="form-col">
            <label className="assign-every">
              <input
                type="checkbox"
                checked={assignEveryBot}
                onChange={(e) => setAssignEveryBot(e.target.checked)}
              />
              <span>面向所有数字员工全局可用 (EveryBot)</span>
            </label>

            {!assignEveryBot && (
              <div className="assign-list">
                {bots.map((b) => {
                  const checked = assignSelectedBots.includes(b.id);
                  return (
                    <label key={b.id} className="assign-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setAssignSelectedBots([...assignSelectedBots, b.id]);
                          else setAssignSelectedBots(assignSelectedBots.filter((x) => x !== b.id));
                        }}
                      />
                      {b.name} ({b.id})
                    </label>
                  );
                })}
              </div>
            )}

            <div className="form-actions">
              <button type="button" className="om-btn-subtle" onClick={() => setAssignTarget(null)}>取消</button>
              <button type="button" className="om-btn-primary" onClick={handleSaveAssign}>保存授权</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

function safeParseArgs(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
