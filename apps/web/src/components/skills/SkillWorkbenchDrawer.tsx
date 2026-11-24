import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  Bot as BotIcon,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  FilePlus,
  Folder,
  KeyRound,
  MessageSquare,
  Pin,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import type { Bot, Skill, SkillFileEntry } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { renderMarkdown } from '../../utils/markdown';
import { ToolTrace } from '../chat/ToolTrace';
import {
  CATEGORY_META,
  LIFECYCLE_LABELS,
  SOURCE_LABELS,
  renderSkillFileIcon
} from './skillsMeta';

export type WorkbenchTab = 'overview' | 'files' | 'test' | 'manage';

interface SkillWorkbenchDrawerProps {
  skill: Skill | null;
  initialTab?: WorkbenchTab;
  bots: Bot[];
  onClose: () => void;
  onSkillUpdated: (skill: Skill) => void;
  onSkillDeleted: (name: string) => void;
  onRefreshAll: () => Promise<void>;
  onUseInChat: (skill: Skill) => void;
}

export const SkillWorkbenchDrawer: React.FC<SkillWorkbenchDrawerProps> = ({
  skill,
  initialTab = 'overview',
  bots,
  onClose,
  onSkillUpdated,
  onSkillDeleted,
  onRefreshAll,
  onUseInChat
}) => {
  const { showToast } = useApp();
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(initialTab);

  // 环境与依赖配置
  const [envDrafts, setEnvDrafts] = useState<Record<string, string>>({});
  const [revealedEnv, setRevealedEnv] = useState<Record<string, boolean>>({});
  const [savingEnv, setSavingEnv] = useState(false);
  const [probingEnv, setProbingEnv] = useState(false);

  // 包文件浏览与在线编辑
  const [selectedFilePath, setSelectedFilePath] = useState('SKILL.md');
  const [fileContent, setFileContent] = useState('');
  const [fileEditBuffer, setFileEditBuffer] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [showNewFileRow, setShowNewFileRow] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [deletingFilePath, setDeletingFilePath] = useState<string | null>(null);
  const [resettingBuiltin, setResettingBuiltin] = useState(false);

  // 沙箱试运行
  const [testBotId, setTestBotId] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{
    output: string;
    toolCalls?: any[];
    steps?: number;
    durationMs?: number;
  } | null>(null);

  // Bot 授权与生命周期
  const [everyBot, setEveryBot] = useState(true);
  const [assignedBots, setAssignedBots] = useState<string[]>([]);
  const [savingAssign, setSavingAssign] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, skill?.name]);

  useEffect(() => {
    if (!skill) return;
    setEnvDrafts({});
    setRevealedEnv({});
    setSelectedFilePath('SKILL.md');
    setIsEditingFile(false);
    setShowNewFileRow(false);
    setNewFilePath('');
    setDeletingFilePath(null);
    setConfirmDelete(false);
    setTestResult(null);
    setTestInput('');
    setEveryBot(skill.everyBot ?? true);
    setAssignedBots(skill.assignedBots || []);
    void loadFile('SKILL.md', skill.name);
  }, [skill?.name]);

  useEffect(() => {
    if (!skill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skill, onClose]);

  const loadFile = async (relPath: string, targetName?: string) => {
    const skillName = targetName || skill?.name;
    if (!skillName) return;
    setFileLoading(true);
    try {
      const res = await api.getSkillFileContent(skillName, relPath);
      if (res.success && res.isText) {
        const text = res.content || '';
        setFileContent(text);
        setFileEditBuffer(text);
      } else {
        const msg = res.isText === false ? `[二进制资源 · ${res.size || 0} 字节]` : `[读取失败: ${res.error || '未知错误'}]`;
        setFileContent(msg);
        setFileEditBuffer(msg);
      }
    } catch (err: any) {
      setFileContent(`[加载错误: ${err?.message || '未知异常'}]`);
    } finally {
      setFileLoading(false);
    }
  };

  if (!skill) return null;

  const catMeta = CATEGORY_META[skill.category] || CATEGORY_META.utility;
  const isReady = skill.readiness?.ready !== false;
  const isPinned = Boolean(skill.usage?.pinned);
  const lifecycleState = skill.usage?.lifecycleState || 'active';
  const lint = skill.lint;
  const security = skill.security;
  const envItems = skill.readiness?.envStatus || [];
  const bins = skill.requires?.bins || [];
  const missingBinSet = new Set(skill.readiness?.missingBins || []);

  const newFileError = (() => {
    const trimmed = newFilePath.trim();
    if (!trimmed) return '';
    if (trimmed.includes('..') || trimmed.startsWith('/') || trimmed.includes('\\') || /\s/.test(trimmed)) {
      return '路径须为相对路径且不含 ..、反斜杠或空格';
    }
    return '';
  })();

  const handleToggleEnabled = async () => {
    try {
      const res = await api.patchSkill(skill.name, { enabled: !skill.enabled });
      onSkillUpdated(res.skill);
      showToast(`技能 /${skill.name} 已${res.skill.enabled ? '启用' : '禁用'}`, 'success');
    } catch (err: any) {
      showToast(err?.message || '切换开关失败', 'error');
    }
  };

  const handleTogglePin = async () => {
    try {
      const res = await api.patchSkill(skill.name, { pinned: !isPinned });
      onSkillUpdated(res.skill);
      showToast(res.skill.usage?.pinned ? '已置顶该技能' : '已取消置顶', 'success');
    } catch (err: any) {
      showToast(err?.message || '操作失败', 'error');
    }
  };

  const handleSaveEnv = async () => {
    const payload: Record<string, string | null> = {};
    for (const item of envItems) {
      const val = envDrafts[item.name];
      if (typeof val === 'string' && val.trim()) {
        payload[item.name] = val.trim();
      }
    }
    if (Object.keys(payload).length === 0) {
      showToast('请先输入至少一个需要保存的环境变量值', 'warning');
      return;
    }
    setSavingEnv(true);
    try {
      const res = await api.updateSkillsEnv(payload);
      const updated = res.skills.find((s) => s.name === skill.name);
      if (updated) onSkillUpdated(updated);
      setEnvDrafts({});
      await onRefreshAll();
      showToast('环境变量已安全保存并刷新就绪状态', 'success');
    } catch (err: any) {
      showToast(err?.message || '保存环境变量失败', 'error');
    } finally {
      setSavingEnv(false);
    }
  };

  const handleClearManagedEnv = async (envName: string) => {
    setSavingEnv(true);
    try {
      const res = await api.updateSkillsEnv({ [envName]: null });
      const updated = res.skills.find((s) => s.name === skill.name);
      if (updated) onSkillUpdated(updated);
      await onRefreshAll();
      showToast(`已清除托管变量 ${envName}`, 'info');
    } catch (err: any) {
      showToast(err?.message || '清除失败', 'error');
    } finally {
      setSavingEnv(false);
    }
  };

  const handleProbeEnv = async () => {
    setProbingEnv(true);
    try {
      const res = await api.refreshSkillsReadiness();
      const updated = res.skills.find((s) => s.name === skill.name);
      if (updated) onSkillUpdated(updated);
      await onRefreshAll();
      showToast('已完成系统命令与环境变量重新探测', 'success');
    } catch (err: any) {
      showToast(err?.message || '探测失败', 'error');
    } finally {
      setProbingEnv(false);
    }
  };

  const handleSaveFile = async () => {
    setSavingFile(true);
    try {
      const res = await api.saveSkillFile(skill.name, selectedFilePath, fileEditBuffer);
      if (!res.success) {
        showToast(res.error || '保存文件失败', 'error');
        return;
      }
      setFileContent(fileEditBuffer);
      setIsEditingFile(false);
      if (res.skill) onSkillUpdated(res.skill);
      else await onRefreshAll();
      showToast(`已保存 ${selectedFilePath}`, 'success');
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error');
    } finally {
      setSavingFile(false);
    }
  };

  const handleCreateFile = async () => {
    const clean = newFilePath.trim();
    if (!clean || newFileError) return;
    const starter = clean.endsWith('.sh')
      ? '#!/usr/bin/env bash\nset -euo pipefail\necho "running helper"\n'
      : clean.endsWith('.py')
      ? '#!/usr/bin/env python3\nimport json\nprint(json.dumps({"ok": True}))\n'
      : `# ${clean}\n\n在此补充参考说明或规则。\n`;
    try {
      const res = await api.saveSkillFile(skill.name, clean, starter);
      if (!res.success) {
        showToast(res.error || '新建文件失败', 'error');
        return;
      }
      setShowNewFileRow(false);
      setNewFilePath('');
      setSelectedFilePath(clean);
      setFileContent(starter);
      setFileEditBuffer(starter);
      setIsEditingFile(true);
      if (res.skill) onSkillUpdated(res.skill);
      else await onRefreshAll();
      showToast(`已创建 ${clean}`, 'success');
    } catch (err: any) {
      showToast(err?.message || '创建失败', 'error');
    }
  };

  const handleDeleteFile = async (relPath: string) => {
    if (deletingFilePath !== relPath) {
      setDeletingFilePath(relPath);
      setTimeout(() => setDeletingFilePath((cur) => (cur === relPath ? null : cur)), 3000);
      return;
    }
    setDeletingFilePath(null);
    try {
      const res = await api.deleteSkillFile(skill.name, relPath);
      if (!res.success) {
        showToast(res.error || '删除失败', 'error');
        return;
      }
      setSelectedFilePath('SKILL.md');
      await loadFile('SKILL.md');
      if (res.skill) onSkillUpdated(res.skill);
      else await onRefreshAll();
      showToast(`已删除 ${relPath}`, 'success');
    } catch (err: any) {
      showToast(err?.message || '删除失败', 'error');
    }
  };

  const handleResetBuiltin = async () => {
    setResettingBuiltin(true);
    try {
      const res = await api.resetBuiltinSkill(skill.name);
      onSkillUpdated(res.skill);
      setSelectedFilePath('SKILL.md');
      await loadFile('SKILL.md', res.skill.name);
      setIsEditingFile(false);
      await onRefreshAll();
      showToast(`已将 /${skill.name} 恢复为系统内置默认版本`, 'success');
    } catch (err: any) {
      showToast(err?.message || '恢复默认失败', 'error');
    } finally {
      setResettingBuiltin(false);
    }
  };

  const fillSuggestedPrompt = () => {
    if (skill.category === 'devops') {
      setTestInput(`请按 /${skill.name} 规程检查当前工作区环境状态并给出健康摘要。`);
    } else if (skill.category === 'research') {
      setTestInput(`请按 /${skill.name} 规程对本地组件或主题做一次简短分析演示。`);
    } else {
      setTestInput(`请按 /${skill.name} 规程执行核心能力自检并输出示例结果。`);
    }
  };

  const handleRunTest = async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      const res = await api.testSkill(skill.name, testInput, testBotId || undefined);
      setTestResult({
        output: res.output || '规程试运行完成。',
        steps: res.steps,
        durationMs: res.durationMs,
        toolCalls: (res.toolCalls || []).map((tc: any) => ({
          tool: tc.tool || tc.name || 'tool',
          params: tc.params ?? tc.input,
          result: tc.result ?? tc.output,
          status: tc.status || 'done',
          ok: tc.ok,
          durationMs: tc.durationMs
        }))
      });
      await onRefreshAll();
      showToast('沙箱试运行执行完成', 'success');
    } catch (err: any) {
      setTestResult({ output: `试运行异常: ${err?.message || '请检查模型与工具配置'}` });
      showToast(err?.message || '试运行失败', 'error');
    } finally {
      setTestRunning(false);
    }
  };

  const handleSaveAssign = async () => {
    if (!everyBot && assignedBots.length === 0) {
      showToast('请至少选择一个 Bot 或启用“全员 Bot 可用”', 'warning');
      return;
    }
    setSavingAssign(true);
    try {
      const res = await api.patchSkill(skill.name, {
        everyBot,
        assignedBots: everyBot ? [] : assignedBots
      });
      onSkillUpdated(res.skill);
      showToast('Bot 授权范围已保存', 'success');
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error');
    } finally {
      setSavingAssign(false);
    }
  };

  const handleToggleArchive = async () => {
    const next = lifecycleState === 'archived' ? 'active' : 'archived';
    try {
      const res = await api.patchSkill(skill.name, { lifecycleState: next });
      onSkillUpdated(res.skill);
      await onRefreshAll();
      showToast(next === 'archived' ? '技能已归档' : '技能已恢复为活跃状态', 'success');
    } catch (err: any) {
      showToast(err?.message || '状态更新失败', 'error');
    }
  };

  const handleDeleteSkill = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    try {
      await api.deleteSkill(skill.name);
      showToast(`技能 /${skill.name} 已永久删除`, 'info');
      onSkillDeleted(skill.name);
    } catch (err: any) {
      showToast(err?.message || '删除技能失败', 'error');
    }
  };

  return (
    <div className="skill-drawer-backdrop" onClick={onClose}>
      <aside
        className="skill-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`技能工作台 ${skill.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶栏 */}
        <div className="skill-drawer-head">
          <div className="skill-drawer-title-wrap">
            <div className="skill-drawer-badges">
              <span className={`badge badge-cat ${catMeta.className}`}>
                {catMeta.icon}
                {catMeta.label}
              </span>
              <span className="badge badge-src">{SOURCE_LABELS[skill.source] || skill.source}</span>
              {skill.hasBuiltinOverride && <span className="badge badge-override">已自定义覆写</span>}
            </div>
            <div className="skill-drawer-name-row">
              <h2>/{skill.name}</h2>
              <span className="skill-ver">v{(skill.metadata?.version as string) || '1.0.0'}</span>
            </div>
            <p className="skill-drawer-desc">{skill.description}</p>
          </div>

          <div className="skill-drawer-top-actions">
            <button
              type="button"
              className={`om-btn-subtle skill-drawer-icon-btn${isPinned ? ' is-pinned' : ''}`}
              title={isPinned ? '取消置顶' : '置顶'}
              onClick={handleTogglePin}
            >
              <Pin size={14} />
            </button>
            <label className="skill-switch">
              <input
                type="checkbox"
                checked={skill.enabled}
                onChange={handleToggleEnabled}
                aria-label="切换技能启用状态"
              />
              <span className={skill.enabled ? 'is-on' : 'is-off'}>{skill.enabled ? '启用' : '禁用'}</span>
            </label>
            <button
              type="button"
              className="om-btn-subtle"
              disabled={!skill.enabled || !isReady || lifecycleState === 'archived'}
              onClick={() => onUseInChat(skill)}
            >
              <MessageSquare size={13} />
              对话使用
            </button>
            <a href={api.exportSkillZipUrl(skill.name)} download={`${skill.name}.zip`} className="om-btn-subtle">
              <Archive size={13} />
              ZIP
            </a>
            <button type="button" className="skill-drawer-close" aria-label="关闭工作台" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 工作台标签页 */}
        <div className="skill-drawer-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            className={`tab-btn${activeTab === 'overview' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <Sparkles size={13} /> 概览与环境
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'files'}
            className={`tab-btn${activeTab === 'files' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            <Folder size={13} /> 文件与代码 ({skill.filesCount || 1})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'test'}
            className={`tab-btn${activeTab === 'test' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('test')}
          >
            <Play size={13} /> 沙箱试运行
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'manage'}
            className={`tab-btn${activeTab === 'manage' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('manage')}
          >
            <BotIcon size={13} /> 授权与生命周期
          </button>
        </div>

        {/* 内容区 */}
        <div className="skill-drawer-body">
          {activeTab === 'overview' && (
            <div className="drawer-stack">
              {/* 依赖与环境变量就地配置 */}
              <section className="drawer-card">
                <div className="drawer-card-head">
                  <div className="drawer-card-title">
                    {isReady ? <CheckCircle2 size={15} className="tone-ok" /> : <AlertCircle size={15} className="tone-warn" />}
                    <span>运行依赖与环境变量</span>
                  </div>
                  <button type="button" className="om-btn-subtle" onClick={handleProbeEnv} disabled={probingEnv}>
                    <RefreshCw size={12} className={probingEnv ? 'spin' : ''} />
                    重新探测环境
                  </button>
                </div>

                {bins.length === 0 && envItems.length === 0 ? (
                  <p className="drawer-muted">该技能为纯指令/内置工具规程，无需额外系统命令或外部密钥。</p>
                ) : (
                  <div className="drawer-stack-sm">
                    {bins.length > 0 && (
                      <div className="dep-bins-row">
                        <span className="dep-label">系统命令</span>
                        <div className="dep-chips">
                          {bins.map((bin) => {
                            const missing = missingBinSet.has(bin);
                            return (
                              <span key={bin} className={`dep-chip ${missing ? 'is-missing' : 'is-ok'}`}>
                                {missing ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />}
                                {bin}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {envItems.length > 0 && (
                      <div className="skill-env-panel">
                        <div className="dep-label">所需环境变量（保存在本地受控密钥文件并即时生效）</div>
                        {envItems.map((item) => {
                          const draft = envDrafts[item.name] ?? '';
                          const revealed = Boolean(revealedEnv[item.name]);
                          return (
                            <div key={item.name} className="skill-env-row">
                              <div className="skill-env-info">
                                <span className="skill-env-key">
                                  <KeyRound size={12} />
                                  {item.name}
                                </span>
                                <span className={`skill-env-badge ${item.configured ? 'is-ok' : 'is-warn'}`}>
                                  {item.configured
                                    ? `${item.source === 'managed' ? '托管' : '系统'} · ${item.maskedValue || '已配置'}`
                                    : '未配置'}
                                </span>
                              </div>
                              <div className="skill-env-input-row">
                                <input
                                  type={revealed ? 'text' : 'password'}
                                  className="form-input"
                                  placeholder={item.configured ? '输入新值以覆盖当前配置…' : `请输入 ${item.name}`}
                                  value={draft}
                                  onChange={(e) => setEnvDrafts((prev) => ({ ...prev, [item.name]: e.target.value }))}
                                />
                                <button
                                  type="button"
                                  className="om-btn-subtle"
                                  aria-label={revealed ? '隐藏值' : '显示值'}
                                  onClick={() => setRevealedEnv((prev) => ({ ...prev, [item.name]: !prev[item.name] }))}
                                >
                                  {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                                {item.configured && item.source === 'managed' && (
                                  <button
                                    type="button"
                                    className="om-btn-subtle"
                                    onClick={() => handleClearManagedEnv(item.name)}
                                    disabled={savingEnv}
                                  >
                                    清除
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <div className="form-actions">
                          <button type="button" className="om-btn-primary" onClick={handleSaveEnv} disabled={savingEnv}>
                            <Save size={13} />
                            {savingEnv ? '保存中…' : '保存环境变量并刷新'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* 质量 Linter 与分级安全体检 */}
              <section className="drawer-card">
                <div className="drawer-card-head">
                  <div className="drawer-card-title">
                    <ShieldCheck size={15} />
                    <span>质量体检与安全评估</span>
                  </div>
                  <div className="drawer-metric-pills">
                    {lint && (
                      <span
                        className={`lint-score-pill ${
                          lint.score >= 85 ? 'is-good' : lint.score >= 60 ? 'is-warn' : 'is-bad'
                        }`}
                      >
                        质量 {lint.score}/100 · ~{lint.estimatedTokens} tokens
                      </span>
                    )}
                    {security && (
                      <span className={`sec-verdict-pill is-${security.verdict}`}>
                        {security.verdict === 'safe'
                          ? '安全通过'
                          : security.verdict === 'caution'
                          ? '需关注'
                          : '存在高风险项'}
                      </span>
                    )}
                  </div>
                </div>

                {(!lint || lint.findings.length === 0) && (!security || security.findings.length === 0) ? (
                  <p className="drawer-muted">结构规范清晰，静态安全扫描未发现异常载荷或越权指令。</p>
                ) : (
                  <div className="audit-findings-list">
                    {security?.findings.map((f, idx) => (
                      <div key={`sec-${idx}`} className={`audit-finding is-${f.severity === 'critical' || f.severity === 'high' ? 'danger' : 'warn'}`}>
                        <ShieldAlert size={13} />
                        <div>
                          <strong>[{f.file}]</strong> {f.message}
                        </div>
                      </div>
                    ))}
                    {lint?.findings.map((f, idx) => (
                      <div key={`lint-${idx}`} className={`audit-finding is-${f.severity === 'error' ? 'danger' : 'info'}`}>
                        <AlertTriangle size={13} />
                        <div>{f.message}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 规程正文预览 */}
              <section className="drawer-card">
                <div className="drawer-card-head">
                  <div className="drawer-card-title">
                    <span>规程指令预览 (SKILL.md)</span>
                  </div>
                  <button
                    type="button"
                    className="om-btn-subtle"
                    onClick={() => {
                      setActiveTab('files');
                      setSelectedFilePath('SKILL.md');
                      setIsEditingFile(true);
                    }}
                  >
                    <Edit3 size={12} /> 编辑正文
                  </button>
                </div>
                <div
                  className="drawer-md-body markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(skill.body || skill.content) }}
                />
              </section>
            </div>
          )}

          {activeTab === 'files' && (
            <div className="drawer-files-wrap">
              <div className="explorer-split drawer-explorer">
                <div className="file-tree">
                  <div className="tree-head">
                    <span>包目录</span>
                    <button type="button" onClick={() => setShowNewFileRow((prev) => !prev)}>
                      <FilePlus size={13} /> {showNewFileRow ? '收起' : '新建'}
                    </button>
                  </div>

                  {showNewFileRow && (
                    <div className="inline-new-file">
                      <input
                        type="text"
                        className="form-input"
                        placeholder="scripts/helper.sh"
                        value={newFilePath}
                        onChange={(e) => setNewFilePath(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateFile();
                        }}
                      />
                      {newFileError && <div className="inline-new-file-err">{newFileError}</div>}
                      <button
                        type="button"
                        className="om-btn-primary"
                        disabled={!newFilePath.trim() || Boolean(newFileError)}
                        onClick={handleCreateFile}
                      >
                        创建
                      </button>
                    </div>
                  )}

                  <div className="tree-list">
                    {(skill.files || [{ path: 'SKILL.md', size: 0, isText: true } as SkillFileEntry]).map((f) => {
                      const isSelected = selectedFilePath === f.path;
                      return (
                        <div
                          key={f.path}
                          role="button"
                          tabIndex={0}
                          className={`file-item${isSelected ? ' is-active' : ''}`}
                          onClick={() => {
                            setSelectedFilePath(f.path);
                            setIsEditingFile(false);
                            void loadFile(f.path);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setSelectedFilePath(f.path);
                              setIsEditingFile(false);
                              void loadFile(f.path);
                            }
                          }}
                        >
                          <span className="file-name">
                            {renderSkillFileIcon(f.path, f.executable)}
                            {f.path}
                          </span>
                          <span className="file-size">{f.size ? `${Math.round((f.size / 1024) * 10) / 10}k` : ''}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="tree-foot">
                    存储位置
                    <div className="tree-path">{skill.dirPath || '系统托管目录'}</div>
                  </div>
                </div>

                <div className="editor-pane">
                  <div className="editor-bar">
                    <div className="editor-title">
                      <span>{selectedFilePath}</span>
                      {selectedFilePath.startsWith('scripts/') && (
                        <span className="editor-badge">沙箱脚本</span>
                      )}
                    </div>
                    <div className="editor-actions">
                      {skill.hasBuiltinOverride && (
                        <button
                          type="button"
                          className="om-btn-subtle"
                          onClick={handleResetBuiltin}
                          disabled={resettingBuiltin}
                        >
                          <RotateCcw size={12} /> 恢复内置默认
                        </button>
                      )}
                      {isEditingFile ? (
                        <>
                          <button
                            type="button"
                            className="om-btn-subtle"
                            onClick={() => {
                              setIsEditingFile(false);
                              setFileEditBuffer(fileContent);
                            }}
                          >
                            取消
                          </button>
                          <button type="button" className="om-btn-primary" onClick={handleSaveFile} disabled={savingFile}>
                            <Save size={12} /> {savingFile ? '保存中…' : '保存'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="om-btn-subtle" onClick={() => setIsEditingFile(true)}>
                            <Edit3 size={12} /> 编辑
                          </button>
                          {selectedFilePath !== 'SKILL.md' && (
                            <button
                              type="button"
                              className={`om-btn-subtle editor-delete ${deletingFilePath === selectedFilePath ? 'is-confirming' : ''}`}
                              onClick={() => handleDeleteFile(selectedFilePath)}
                            >
                              <Trash2 size={12} />
                              {deletingFilePath === selectedFilePath ? '确认删除？' : '删除'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="editor-content">
                    {fileLoading ? (
                      <div className="editor-loading" role="status">加载文件中…</div>
                    ) : isEditingFile ? (
                      <textarea
                        className="code-edit"
                        value={fileEditBuffer}
                        onChange={(e) => setFileEditBuffer(e.target.value)}
                        aria-label={`编辑文件 ${selectedFilePath}`}
                      />
                    ) : (
                      <pre className="code-view">{fileContent}</pre>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'test' && (
            <div className="drawer-stack">
              <section className="drawer-card">
                <div className="drawer-card-head">
                  <div className="drawer-card-title">
                    <Play size={15} />
                    <span>真实沙箱 Loop 试运行</span>
                  </div>
                  <button type="button" className="om-btn-subtle" onClick={fillSuggestedPrompt}>
                    填入示例指令
                  </button>
                </div>

                <div className="form-col">
                  <div className="form-field">
                    <label className="form-label" htmlFor="workbench-test-bot">执行数字员工</label>
                    <select
                      id="workbench-test-bot"
                      className="form-input"
                      value={testBotId}
                      onChange={(e) => setTestBotId(e.target.value)}
                    >
                      <option value="">默认协调员 Bot</option>
                      {bots.map((b) => (
                        <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label className="form-label" htmlFor="workbench-test-input">模拟任务指令</label>
                    <textarea
                      id="workbench-test-input"
                      className="form-input"
                      rows={3}
                      placeholder={`例如：请按 /${skill.name} 规程执行一次实测检查…`}
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                    />
                  </div>

                  <div className="form-actions">
                    <button type="button" className="om-btn-primary" onClick={handleRunTest} disabled={testRunning}>
                      <Play size={13} />
                      {testRunning ? '沙箱执行中…' : '开始真实试运行'}
                    </button>
                  </div>
                </div>
              </section>

              {testResult && (
                <section className="drawer-card">
                  <div className="drawer-card-head">
                    <div className="drawer-card-title">
                      <Activity size={15} />
                      <span>试运行输出</span>
                    </div>
                    <div className="drawer-metric-pills">
                      {typeof testResult.steps === 'number' && (
                        <span className="badge badge-src">{testResult.steps} 次工具步</span>
                      )}
                      {typeof testResult.durationMs === 'number' && (
                        <span className="badge badge-src">{testResult.durationMs} ms</span>
                      )}
                    </div>
                  </div>
                  {testResult.toolCalls && testResult.toolCalls.length > 0 && (
                    <ToolTrace tools={testResult.toolCalls} />
                  )}
                  <div
                    className="drawer-md-body markdown-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(testResult.output) }}
                  />
                </section>
              )}
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="drawer-stack">
              <section className="drawer-card">
                <div className="drawer-card-head">
                  <div className="drawer-card-title">
                    <BotIcon size={15} />
                    <span>数字员工授权可见性</span>
                  </div>
                </div>

                <div className="form-col">
                  <label className="assign-every">
                    <input
                      type="checkbox"
                      checked={everyBot}
                      onChange={(e) => setEveryBot(e.target.checked)}
                    />
                    <span>面向所有数字员工全局可用 (EveryBot)</span>
                  </label>

                  {!everyBot && (
                    <div className="assign-list">
                      {bots.map((b) => {
                        const checked = assignedBots.includes(b.id);
                        return (
                          <label key={b.id} className="assign-row">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) setAssignedBots((prev) => [...prev, b.id]);
                                else setAssignedBots((prev) => prev.filter((id) => id !== b.id));
                              }}
                            />
                            {b.name} ({b.id})
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div className="form-actions">
                    <button type="button" className="om-btn-primary" onClick={handleSaveAssign} disabled={savingAssign}>
                      {savingAssign ? '保存中…' : '保存授权配置'}
                    </button>
                  </div>
                </div>
              </section>

              <section className="drawer-card">
                <div className="drawer-card-head">
                  <div className="drawer-card-title">
                    <Activity size={15} />
                    <span>使用遥测与生命周期</span>
                  </div>
                  <span className={`badge badge-lifecycle is-${lifecycleState}`}>
                    {LIFECYCLE_LABELS[lifecycleState]}
                  </span>
                </div>

                <div className="telemetry-grid">
                  <div className="telemetry-cell">
                    <span className="telemetry-label">触发调用</span>
                    <strong className="telemetry-val">{skill.usage?.useCount || 0} 次</strong>
                  </div>
                  <div className="telemetry-cell">
                    <span className="telemetry-label">沙箱试运行</span>
                    <strong className="telemetry-val">{skill.usage?.viewCount || 0} 次</strong>
                  </div>
                  <div className="telemetry-cell">
                    <span className="telemetry-label">增量修订</span>
                    <strong className="telemetry-val">{skill.usage?.patchCount || 0} 次</strong>
                  </div>
                  <div className="telemetry-cell">
                    <span className="telemetry-label">最近调用</span>
                    <strong className="telemetry-val">
                      {skill.usage?.lastUsedAt
                        ? new Date(skill.usage.lastUsedAt).toLocaleDateString('zh-CN')
                        : '尚无记录'}
                    </strong>
                  </div>
                </div>

                {skill.source !== 'builtin' && (
                  <div className="lifecycle-actions-row">
                    <button type="button" className="om-btn-subtle" onClick={handleToggleArchive}>
                      <Archive size={13} />
                      {lifecycleState === 'archived' ? '取消归档并恢复使用' : '归档此低频技能'}
                    </button>

                    <button
                      type="button"
                      className={`om-btn-subtle skill-action is-danger${confirmDelete ? ' is-confirming' : ''}`}
                      onClick={handleDeleteSkill}
                    >
                      <Trash2 size={13} />
                      {confirmDelete ? '再次点击确认永久删除' : '删除技能包'}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
