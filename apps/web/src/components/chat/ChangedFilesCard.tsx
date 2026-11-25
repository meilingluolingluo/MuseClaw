import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, FileDiff, FilePlus2, FileX2 } from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';
import type { ToolTraceItem } from './ToolTrace';

interface ChangedFileEntry {
  path: string;
  action: 'created' | 'modified' | 'deleted';
}

const FILE_WRITE_TOOLS: Record<string, ChangedFileEntry['action']> = {
  write_file: 'created',
  create_file: 'created',
  save_skill_file: 'modified',
  edit_file: 'modified',
  patch_file: 'modified',
  update_file: 'modified',
  delete_file: 'deleted',
  remove_file: 'deleted',
};

export function extractChangedFiles(toolCalls?: ToolTraceItem[]): ChangedFileEntry[] {
  if (!toolCalls || toolCalls.length === 0) return [];
  const map = new Map<string, ChangedFileEntry['action']>();

  for (const tc of toolCalls) {
    if (tc.ok === false || tc.status === 'failed' || tc.status === 'rejected' || tc.status === 'running') {
      continue;
    }
    const action = FILE_WRITE_TOOLS[String(tc.tool || '').toLowerCase()];
    if (!action) continue;
    const params = (tc.params && typeof tc.params === 'object' ? tc.params : {}) as Record<string, any>;
    const rawPath = params.path || params.file_path || params.filePath || params.filename || params.target;
    if (typeof rawPath !== 'string' || !rawPath.trim()) continue;
    const cleanPath = rawPath.trim();
    const prev = map.get(cleanPath);
    if (!prev || action === 'deleted' || (prev === 'created' && action === 'modified')) {
      map.set(cleanPath, action === 'modified' && prev === 'created' ? 'created' : action);
    }
  }

  return Array.from(map.entries()).map(([path, action]) => ({ path, action }));
}

export const ChangedFilesCard: React.FC<{ toolCalls?: ToolTraceItem[] }> = ({ toolCalls }) => {
  const files = useMemo(() => extractChangedFiles(toolCalls), [toolCalls]);
  const [open, setOpen] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  if (files.length === 0) return null;

  const handleCopyPath = async (p: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(p);
    if (ok) {
      setCopiedPath(p);
      setTimeout(() => setCopiedPath(null), 1500);
    }
  };

  return (
    <div className="changed-files-card">
      <button
        type="button"
        className="changed-files-summary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <FileDiff size={14} className="changed-files-icon" />
        <span className="changed-files-title">本次变更文件 ({files.length})</span>
        <span className="changed-files-preview">
          {files.slice(0, 2).map((f) => f.path.split(/[\\/]/).pop()).join('、')}
          {files.length > 2 ? ` 等 ${files.length} 个` : ''}
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>

      {open && (
        <ul className="changed-files-list">
          {files.map((file) => {
            const Icon = file.action === 'created' ? FilePlus2 : file.action === 'deleted' ? FileX2 : FileDiff;
            const badge = file.action === 'created' ? '新增' : file.action === 'deleted' ? '删除' : '修改';
            return (
              <li key={file.path} className={`changed-file-row is-${file.action}`}>
                <Icon size={13} className="changed-file-row-icon" />
                <span className="changed-file-badge">{badge}</span>
                <span className="changed-file-path" title={file.path}>{file.path}</span>
                <button
                  type="button"
                  className="changed-file-copy"
                  onClick={(e) => handleCopyPath(file.path, e)}
                  title="复制文件路径"
                >
                  {copiedPath === file.path ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
