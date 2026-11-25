import React, { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, Download, Maximize2, Search, X } from 'lucide-react';
import { renderInlineMarkdown } from '../../utils/markdown';
import { copyToClipboard } from '../../utils/clipboard';

interface InteractiveTableProps {
  headers: string[];
  alignments: Array<'left' | 'center' | 'right' | null>;
  rows: string[][];
}

const SEARCH_THRESHOLD = 8;
const MIN_COL_PX = 56;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const NUMERIC_RE = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/;

function toNumberIfNumeric(raw: string): number | null {
  const cleaned = raw.trim().replace(/^[$€£¥]/, '');
  if (!NUMERIC_RE.test(cleaned)) return null;
  const num = Number(cleaned.replace(/[,%]/g, ''));
  return Number.isFinite(num) ? num : null;
}

function escapeCsvCell(val: string): string {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\r\n');
}

function buildMarkdownTable(headers: string[], rows: string[][]): string {
  const esc = (s: string) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${headers.map(esc).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(esc).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

const TableView: React.FC<{
  headers: string[];
  alignments: Array<'left' | 'center' | 'right' | null>;
  rows: string[][];
  isModal?: boolean;
  onExpand?: () => void;
  onCloseModal?: () => void;
}> = ({ headers, alignments, rows, isModal = false, onExpand, onCloseModal }) => {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [sortState, setSortState] = useState<{ column: number; direction: 'ascending' | 'descending' } | null>(null);
  const [copyMode, setCopyMode] = useState<'idle' | 'csv' | 'md'>('idle');
  const [colWidths, setColWidths] = useState<number[] | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const statusId = useId();
  const regionLabelId = useId();

  const numericColumns = useMemo(() => {
    return headers.map((_, colIdx) => {
      const nonEmpty = rows.map((r) => (r[colIdx] || '').trim()).filter(Boolean);
      return nonEmpty.length > 0 && nonEmpty.every((v) => toNumberIfNumeric(v) !== null);
    });
  }, [headers, rows]);

  const filteredAndSortedRows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const matched = q
      ? rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(q)))
      : rows;

    if (!sortState) return matched;
    const { column, direction } = sortState;
    const factor = direction === 'ascending' ? 1 : -1;
    const isNum = numericColumns[column];

    return [...matched].sort((a, b) => {
      const va = (a[column] || '').trim();
      const vb = (b[column] || '').trim();
      if (isNum) {
        const na = toNumberIfNumeric(va);
        const nb = toNumberIfNumeric(vb);
        if (na !== null && nb !== null) return factor * (na - nb);
      }
      return factor * collator.compare(va, vb);
    });
  }, [deferredQuery, numericColumns, rows, sortState]);

  const toggleSort = (colIdx: number) => {
    setSortState((prev) => {
      if (!prev || prev.column !== colIdx) {
        return { column: colIdx, direction: 'ascending' };
      }
      if (prev.direction === 'ascending') {
        return { column: colIdx, direction: 'descending' };
      }
      return null;
    });
  };

  const handleCopyCsv = async () => {
    const ok = await copyToClipboard(buildCsv(headers, filteredAndSortedRows));
    if (ok) {
      setCopyMode('csv');
      setTimeout(() => setCopyMode('idle'), 1800);
    }
  };

  const handleCopyMarkdown = async () => {
    const ok = await copyToClipboard(buildMarkdownTable(headers, filteredAndSortedRows));
    if (ok) {
      setCopyMode('md');
      setTimeout(() => setCopyMode('idle'), 1800);
    }
  };

  const handleDownloadCsv = () => {
    const csv = '\uFEFF' + buildCsv(headers, filteredAndSortedRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table-${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleResizeStart = useCallback(
    (colIdx: number, e: React.PointerEvent<HTMLSpanElement>) => {
      const table = tableRef.current;
      if (!table || e.button !== 0 || colIdx >= headers.length - 1) return;
      const thCells = Array.from(table.tHead?.rows[0]?.cells || []);
      const tableWidth = table.getBoundingClientRect().width;
      if (thCells.length !== headers.length || tableWidth <= 0) return;

      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);

      const startWidths = thCells.map((cell) => (cell.getBoundingClientRect().width / tableWidth) * 100);
      const pairSum = startWidths[colIdx] + startWidths[colIdx + 1];
      const minPct = Math.min((MIN_COL_PX / tableWidth) * 100, pairSum / 2);
      const startX = e.clientX;

      const onMove = (moveEvent: PointerEvent) => {
        const deltaPct = ((moveEvent.clientX - startX) / tableWidth) * 100;
        const leftPct = Math.min(Math.max(startWidths[colIdx] + deltaPct, minPct), pairSum - minPct);
        const next = startWidths.map((w, idx) =>
          idx === colIdx ? leftPct : idx === colIdx + 1 ? pairSum - leftPct : w
        );
        setColWidths(next);
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [headers.length]
  );

  const showSearch = isModal || rows.length > SEARCH_THRESHOLD;
  const sortAnnouncement = sortState
    ? `已按「${headers[sortState.column]}」${sortState.direction === 'ascending' ? '升序' : '降序'}排列，共 ${filteredAndSortedRows.length} 行`
    : '';

  return (
    <div className={`rich-table-card${isModal ? ' is-in-modal' : ''}`}>
      <div className="rich-table-toolbar">
        <div className="rich-table-toolbar-left">
          {showSearch ? (
            <label className="rich-table-search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="筛选表格内容…"
                aria-label="筛选表格内容"
              />
            </label>
          ) : (
            <span id={regionLabelId} className="rich-table-meta">
              {rows.length} 行 × {headers.length} 列
            </span>
          )}
          {showSearch && (
            <span id={regionLabelId} className="rich-table-meta">
              {filteredAndSortedRows.length} / {rows.length} 行
            </span>
          )}
        </div>

        <div className="rich-table-actions">
          <button type="button" className="rich-table-btn" onClick={handleCopyCsv} title="复制为 CSV">
            {copyMode === 'csv' ? <Check size={12} /> : <Copy size={12} />}
            <span>{copyMode === 'csv' ? '已复制' : 'CSV'}</span>
          </button>
          <button type="button" className="rich-table-btn" onClick={handleCopyMarkdown} title="复制 Markdown 表格">
            {copyMode === 'md' ? <Check size={12} /> : <Copy size={12} />}
            <span>{copyMode === 'md' ? '已复制' : 'MD'}</span>
          </button>
          <button type="button" className="rich-table-btn" onClick={handleDownloadCsv} title="导出 CSV 文件">
            <Download size={12} />
            <span>导出</span>
          </button>
          {!isModal && onExpand && (
            <button type="button" className="rich-table-btn" onClick={onExpand} title="全屏查看表格">
              <Maximize2 size={12} />
              <span>放大</span>
            </button>
          )}
          {isModal && onCloseModal && (
            <button type="button" className="rich-table-btn" onClick={onCloseModal} title="关闭全屏">
              <X size={13} />
              <span>关闭</span>
            </button>
          )}
        </div>
      </div>

      <div id={statusId} role="status" className="sr-only">
        {sortAnnouncement}
      </div>

      <div className="rich-table-scroll" role="region" aria-labelledby={regionLabelId} tabIndex={0}>
        <table
          ref={tableRef}
          className={`rich-table${colWidths ? ' is-fixed-layout' : ''}`}
        >
          {colWidths && (
            <colgroup>
              {colWidths.map((w, idx) => (
                <col key={idx} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              {headers.map((header, idx) => {
                const isSorted = sortState?.column === idx;
                const ariaSort = isSorted ? sortState.direction : undefined;
                const align = alignments[idx];
                const isShort = header.length <= 16 && !header.includes('\n');
                return (
                  <th
                    key={idx}
                    scope="col"
                    aria-sort={ariaSort}
                    className={`${isShort ? 'cell-nowrap' : ''}${align ? ` align-${align}` : ''}`}
                  >
                    <button
                      type="button"
                      className="rich-table-sort-btn"
                      onClick={() => toggleSort(idx)}
                    >
                      <span
                        className="rich-table-th-label"
                        dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(header) }}
                      />
                      <span className="rich-table-sort-icon" aria-hidden="true">
                        {isSorted ? (
                          sortState.direction === 'ascending' ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          )
                        ) : (
                          <ArrowUpDown size={11} />
                        )}
                      </span>
                    </button>
                    {idx < headers.length - 1 && (
                      <span
                        className="rich-table-resize-handle"
                        aria-hidden="true"
                        onPointerDown={(e) => handleResizeStart(idx, e)}
                        onDoubleClick={() => setColWidths(null)}
                        title="拖动调整列宽，双击还原"
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedRows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="rich-table-empty">
                  未匹配到符合条件的数据行
                </td>
              </tr>
            ) : (
              filteredAndSortedRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {headers.map((_, cIdx) => {
                    const cellText = row[cIdx] ?? '';
                    const align = alignments[cIdx];
                    const isShort = cellText.length > 0 && cellText.length <= 16 && !cellText.includes('\n');
                    return (
                      <td
                        key={cIdx}
                        className={`${isShort ? 'cell-nowrap' : ''}${align ? ` align-${align}` : ''}`}
                        dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(cellText) }}
                      />
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const InteractiveTableInner: React.FC<InteractiveTableProps> = ({ headers, alignments, rows }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (modalOpen && !dialog.open) {
      dialog.showModal();
    } else if (!modalOpen && dialog.open) {
      dialog.close();
    }
  }, [modalOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || ('closedBy' in HTMLDialogElement.prototype)) return;
    const handleBackdrop = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = shellRef.current?.getBoundingClientRect() || dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) {
        dialog.close();
      }
    };
    dialog.addEventListener('click', handleBackdrop);
    return () => dialog.removeEventListener('click', handleBackdrop);
  }, []);

  return (
    <>
      <TableView
        headers={headers}
        alignments={alignments}
        rows={rows}
        onExpand={() => setModalOpen(true)}
      />
      <dialog
        ref={dialogRef}
        className="rich-table-dialog"
        aria-label="表格全屏查看"
        onClose={() => setModalOpen(false)}
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        {modalOpen && (
          <div ref={shellRef} className="rich-table-dialog-shell">
            <TableView
              headers={headers}
              alignments={alignments}
              rows={rows}
              isModal
              onCloseModal={() => dialogRef.current?.close()}
            />
          </div>
        )}
      </dialog>
    </>
  );
};

export const InteractiveTable = React.memo(InteractiveTableInner);
