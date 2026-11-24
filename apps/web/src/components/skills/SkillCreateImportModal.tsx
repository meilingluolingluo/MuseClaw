import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCode,
  FileText,
  Link2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload
} from 'lucide-react';
import type { Skill, SkillCategory, SkillImportPreview } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { SKILL_STARTER_TEMPLATES } from './skillsMeta';

type ModalMode = 'create' | 'import';
type ImportChannel = 'zip' | 'markdown' | 'url';

interface SkillCreateImportModalProps {
  mode: ModalMode | null;
  onClose: () => void;
  onCompleted: (skill: Skill) => Promise<void> | void;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const SkillCreateImportModal: React.FC<SkillCreateImportModalProps> = ({
  mode,
  onClose,
  onCompleted
}) => {
  const { showToast } = useApp();

  // 新建表单状态
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    category: 'custom' as SkillCategory,
    requiresBins: '',
    requiresEnv: '',
    instructions: ''
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // 导入状态
  const [importChannel, setImportChannel] = useState<ImportChannel>('zip');
  const [importZipFile, setImportZipFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importMdText, setImportMdText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [preview, setPreview] = useState<SkillImportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [forceImport, setForceImport] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!mode) return null;

  const applyTemplate = (presetId: string) => {
    const preset = SKILL_STARTER_TEMPLATES.find((t) => t.id === presetId);
    if (!preset) return;
    setCreateError('');
    setCreateForm({
      name: preset.name,
      description: preset.description,
      category: preset.category,
      requiresBins: preset.requiresBins,
      requiresEnv: preset.requiresEnv,
      instructions: preset.instructions
    });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = createForm.name.trim().toLowerCase();
    if (!NAME_PATTERN.test(cleanName)) {
      setCreateError('技能标识只支持小写字母、数字和横线（2~64位）');
      return;
    }
    if (!createForm.description.trim()) {
      setCreateError('请填写一句话触发说明');
      return;
    }

    setCreating(true);
    setCreateError('');
    try {
      const bins = createForm.requiresBins
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const env = createForm.requiresEnv
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await api.createSkill({
        name: cleanName,
        description: createForm.description.trim(),
        category: createForm.category,
        requires: bins.length || env.length ? { bins, env } : undefined,
        body: createForm.instructions.trim() || undefined
      });
      showToast(`已创建技能 /${cleanName}`, 'success');
      await onCompleted(res.skill);
    } catch (err: any) {
      setCreateError(err?.message || '创建技能失败');
    } finally {
      setCreating(false);
    }
  };

  const acceptZipFile = (file?: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setImportError('仅支持导入 .zip 格式的技能压缩包');
      return;
    }
    setImportError('');
    setImportZipFile(file);
  };

  const handleRunPreview = async () => {
    setPreviewLoading(true);
    setPreview(null);
    setImportError('');
    try {
      const payload =
        importChannel === 'markdown' ? { text: importMdText.trim() } : { url: importUrl.trim() };
      const res = await api.previewImportSkill(payload);
      setPreview(res);
      if (!res.valid && res.error) {
        setImportError(res.error);
      }
    } catch (err: any) {
      setImportError(err?.message || '预检解析失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    setImportError('');
    try {
      if (importChannel === 'zip') {
        if (!importZipFile) return;
        const res = await api.uploadSkillZip(importZipFile, forceImport);
        showToast(`已导入技能包 /${res.skill.name}`, 'success');
        await onCompleted(res.skill);
      } else if (importChannel === 'markdown') {
        const res = await api.importSkill(preview?.content || importMdText.trim(), forceImport);
        showToast(`已导入技能 /${res.skill.name}`, 'success');
        await onCompleted(res.skill);
      } else {
        const res = await api.importSkillFromUrl(importUrl.trim(), forceImport);
        showToast(`已从链接导入技能 /${res.skill.name}`, 'success');
        await onCompleted(res.skill);
      }
    } catch (err: any) {
      setImportError(err?.message || '导入技能失败');
    } finally {
      setImporting(false);
    }
  };

  const renderPreviewCard = () => {
    if (!preview || !preview.valid) return null;
    const verdict = preview.security?.verdict || 'safe';
    const isBlocked = preview.security?.policyAction === 'block' || preview.conflict === 'builtin';

    return (
      <div className="import-preview-card">
        <div className="import-preview-head">
          <div>
            <strong>/{preview.name}</strong>
            <span className="import-preview-desc">{preview.description}</span>
          </div>
          <span className={`sec-verdict-pill is-${verdict}`}>
            {verdict === 'safe' ? (
              <><ShieldCheck size={12} /> 安全通过</>
            ) : (
              <><ShieldAlert size={12} /> {verdict === 'dangerous' ? '高风险项' : '需确认风险'}</>
            )}
          </span>
        </div>

        <div className="import-preview-metrics">
          <span>质量评分 {preview.lint?.score ?? 100}/100</span>
          <span>预估 ~{preview.lint?.estimatedTokens ?? 0} tokens</span>
          <span>
            {preview.readiness?.ready ? (
              <><CheckCircle2 size={11} /> 依赖就绪</>
            ) : (
              <><AlertTriangle size={11} /> {preview.readiness?.details || '需配置依赖'}</>
            )}
          </span>
        </div>

        {preview.conflict === 'builtin' && (
          <div className="form-error">与系统内置技能重名，无法导入覆盖。</div>
        )}
        {preview.conflict === 'existing_custom' && (
          <div className="audit-finding is-warn">
            <AlertTriangle size={13} />
            <div>本地已存在同名自定义技能，继续导入将更新其规程内容。</div>
          </div>
        )}

        {preview.security && preview.security.findings.length > 0 && (
          <div className="audit-findings-list">
            {preview.security.findings.map((f, idx) => (
              <div key={idx} className="audit-finding is-danger">
                <ShieldAlert size={13} />
                <div>{f.message}</div>
              </div>
            ))}
          </div>
        )}

        {isBlocked && preview.conflict !== 'builtin' && (
          <label className="assign-row">
            <input
              type="checkbox"
              checked={forceImport}
              onChange={(e) => setForceImport(e.target.checked)}
            />
            我已审计来源与风险提示，强制放行本次导入
          </label>
        )}
      </div>
    );
  };

  if (mode === 'create') {
    return (
      <Modal isOpen={true} onClose={onClose} maxWidth="660px" title="新建 Agent 技能规程包">
        <form onSubmit={handleCreateSubmit} className="form-col">
          <div className="template-bar">
            <span className="template-bar-label">
              <Sparkles size={12} /> 快捷模板:
            </span>
            {SKILL_STARTER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="om-btn-subtle template-pill"
                onClick={() => applyTemplate(tpl.id)}
              >
                {tpl.label}
              </button>
            ))}
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="skill-create-name">技能标识 *</label>
              <input
                id="skill-create-name"
                type="text"
                className="form-input"
                placeholder="如 git-review, host-cleaner"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
              />
            </div>

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
          </div>

          <div className="form-row">
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

            <div className="form-field">
              <label className="form-label" htmlFor="skill-create-env">所需环境变量 (env)</label>
              <input
                id="skill-create-env"
                type="text"
                className="form-input"
                placeholder="如 GITHUB_TOKEN, SERVICE_KEY"
                value={createForm.requiresEnv}
                onChange={(e) => setCreateForm({ ...createForm, requiresEnv: e.target.value })}
              />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="skill-create-desc">一句话触发说明 (≤200 字) *</label>
            <input
              id="skill-create-desc"
              type="text"
              className="form-input"
              placeholder="简述该技能的能力与适用场景"
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
              placeholder="## 何时使用&#10;...&#10;&#10;## 执行步骤&#10;1. ..."
              value={createForm.instructions}
              onChange={(e) => setCreateForm({ ...createForm, instructions: e.target.value })}
              rows={7}
            />
          </div>

          {createError && <div className="form-error" role="alert">{createError}</div>}

          <div className="form-actions">
            <button type="button" className="om-btn-subtle" onClick={onClose}>取消</button>
            <button type="submit" className="om-btn-primary" disabled={creating}>
              {creating ? '保存中…' : '创建并保存'}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  return (
    <Modal isOpen={true} onClose={onClose} maxWidth="660px" title="导入外部技能规程包">
      <div className="form-col">
        <div className="import-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={importChannel === 'zip'}
            className={`tab-btn${importChannel === 'zip' ? ' is-active' : ''}`}
            onClick={() => {
              setImportChannel('zip');
              setPreview(null);
              setImportError('');
            }}
          >
            <Upload size={13} /> 上传 ZIP 包
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={importChannel === 'markdown'}
            className={`tab-btn${importChannel === 'markdown' ? ' is-active' : ''}`}
            onClick={() => {
              setImportChannel('markdown');
              setPreview(null);
              setImportError('');
            }}
          >
            <FileText size={13} /> 粘贴 SKILL.md
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={importChannel === 'url'}
            className={`tab-btn${importChannel === 'url' ? ' is-active' : ''}`}
            onClick={() => {
              setImportChannel('url');
              setPreview(null);
              setImportError('');
            }}
          >
            <Link2 size={13} /> 从 URL 拉取
          </button>
        </div>

        {importChannel === 'zip' && (
          <>
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
              <div className="import-drop-sub">支持包含 SKILL.md、scripts/ 脚本与 references/ 参考资料</div>
              <input
                type="file"
                accept=".zip,application/zip"
                aria-label="选择技能 ZIP 包"
                ref={fileInputRef}
                className="hidden-file-input"
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
                  onClick={() => {
                    setImportZipFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  ✕
                </button>
              </div>
            )}
          </>
        )}

        {importChannel === 'markdown' && (
          <div className="form-field">
            <label className="form-label" htmlFor="import-md-textarea">标准 SKILL.md 文本</label>
            <textarea
              id="import-md-textarea"
              className="form-input code-textarea"
              rows={8}
              placeholder="---&#10;name: example-skill&#10;description: 一句话说明&#10;---&#10;&#10;## 何时使用&#10;..."
              value={importMdText}
              onChange={(e) => {
                setImportMdText(e.target.value);
                setPreview(null);
                setForceImport(false);
              }}
            />
          </div>
        )}

        {importChannel === 'url' && (
          <div className="form-field">
            <label className="form-label" htmlFor="import-url-input">SKILL.md 远程地址（支持 GitHub 文件链接）</label>
            <input
              id="import-url-input"
              type="url"
              className="form-input"
              placeholder="https://raw.githubusercontent.com/.../SKILL.md"
              value={importUrl}
              onChange={(e) => {
                setImportUrl(e.target.value);
                setPreview(null);
                setForceImport(false);
              }}
            />
          </div>
        )}

        {renderPreviewCard()}

        {importError && <div className="form-error" role="alert">{importError}</div>}

        <div className="form-actions">
          <button type="button" className="om-btn-subtle" onClick={onClose}>取消</button>
          {importChannel !== 'zip' && (
            <button
              type="button"
              className="om-btn-subtle"
              disabled={
                previewLoading ||
                (importChannel === 'markdown' ? !importMdText.trim() : !importUrl.trim())
              }
              onClick={handleRunPreview}
            >
              {previewLoading ? '预检中…' : '预检与安全扫描'}
            </button>
          )}
          <button
            type="button"
            className="om-btn-primary"
            disabled={
              importing ||
              (importChannel === 'zip' && !importZipFile) ||
              (importChannel === 'markdown' && !importMdText.trim()) ||
              (importChannel === 'url' && !importUrl.trim()) ||
              Boolean(preview?.conflict === 'builtin') ||
              Boolean(preview?.security?.policyAction === 'block' && !forceImport)
            }
            onClick={handleConfirmImport}
          >
            {importing ? '导入中…' : '确认导入'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
