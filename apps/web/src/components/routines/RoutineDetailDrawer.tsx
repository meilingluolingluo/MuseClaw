import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Edit3,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Square,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type { Bot, DeliverTarget, Routine, RoutineRun, RoutineRunStatus } from '../../types';
import { BotAvatar } from '../common/BotAvatar';
import { ToolTrace } from '../chat/ToolTrace';
import { formatTime } from '../../utils/format';
import { formatCronZh, formatNextRunFriendly, previewNextRuns } from '../../utils/cronHelper';
import { renderMarkdown } from '../../utils/markdown';
import { copyToClipboard } from '../../utils/clipboard';

interface RoutineDetailDrawerProps {
  routine: Routine | null;
  bot: Bot | null;
  runs: RoutineRun[];
  loadingRuns: boolean;
  isTriggering: boolean;
  isCancelling: boolean;
  nowTick: number;
  onClose: () => void;
  onToggleEnable: (routine: Routine, forceEnable?: boolean) => void;
  onRunNow: (routine: Routine) => void;
  onCancelRun: (routineId: string, runId?: string) => void;
  onEdit: (routine: Routine) => void;
  onDelete: (id: string) => void;
  onRefreshRuns: (routineId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onDebugInChat: (routine: Routine) => void;
  onNotify: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

const DELIVER_SHORT_LABELS: Record<DeliverTarget, string> = {
  feed: '动态流',
  silent: '仅记录',
  im_webhook: '外部 IM',
  all: '全渠道',
};

const STATUS_LABELS: Record<RoutineRunStatus, string> = {
  running: '执行中',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  cancelled: '已中止',
  interrupted: '重启中断',
};

const TRIGGER_LABELS: Record<string, string> = {
  schedule: '定时',
  webhook: 'Webhook',
  manual: '手动',
};

export const RoutineDetailDrawer: React.FC<RoutineDetailDrawerProps> = ({
  routine,
  bot,
  runs,
  loadingRuns,
  isTriggering,
  isCancelling,
  nowTick,
  onClose,
  onToggleEnable,
  onRunNow,
  onCancelRun,
  onEdit,
  onDelete,
  onRefreshRuns,
  onOpenSession,
  onDebugInChat,
  onNotify,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [runFilter, setRunFilter] = useState<'all' | 'abnormal'>('all');
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 控制原生 <dialog> 的模态开关，完全依托浏览器的 Top Layer、Esc 与焦点管理
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (routine) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [routine]);

  // 同步原生关闭事件与不支持 closedby="any" 浏览器的外部点击关闭
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      onCloseRef.current();
    };
    dialog.addEventListener('close', handleClose);

    let cleanupOutside: (() => void) | null = null;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e) && dialog.open) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
      cleanupOutside = () => {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupOutside?.();
    };
  }, []);

  // 切换查看的任务时重置局部展开态
  useEffect(() => {
    setExpandedRunIds(new Set());
    setRunFilter('all');
    setIsPromptExpanded(false);
    setConfirmDelete(false);
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
  }, [routine?.id]);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const filteredRuns = useMemo(() => {
    if (runFilter === 'abnormal') {
      return runs.filter(
        (run) => run.status === 'failed' || run.status === 'timeout' || run.status === 'interrupted'
      );
    }
    return runs;
  }, [runs, runFilter]);

  const activeRunningRun = useMemo(
    () => runs.find((run) => run.status === 'running') || null,
    [runs]
  );

  const previewNext = useMemo(() => {
    if (!routine) return [];
    return previewNextRuns(routine.cronExpr, 3, routine.timezone);
  }, [routine]);

  const handleCopy = async (key: string, text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      onNotify(`已复制${label}`, 'success');
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 2000);
    } else {
      onNotify('复制失败，请手动复制', 'error');
    }
  };

  const handleDeleteClick = () => {
    if (!routine) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setConfirmDelete(false), 3500);
      return;
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    setConfirmDelete(false);
    onDelete(routine.id);
  };

  const toggleRunExpand = (runId: string) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const isRunningNow = Boolean(routine && (routine.status === 'running' || activeRunningRun));
  const deliverKey: DeliverTarget = routine?.deliverTo || (routine?.feedPublish === false ? 'silent' : 'feed');

  return (
    <dialog
      ref={dialogRef}
      className="rt-drawer-dialog"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as any)}
    >
      {routine && (
        <div className="rt-drawer-shell">
          <header className="rt-drawer-head">
            <div className="rt-drawer-head-left">
              <BotAvatar bot={bot} size={36} still />
              <div className="rt-drawer-title-wrap">
                <div className="rt-drawer-title-row">
                  <h1 id={titleId} className="rt-drawer-title">
                    {routine.name}
                  </h1>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={routine.enabled}
                    aria-label={routine.enabled ? '暂停调度' : '开启调度'}
                    title={routine.enabled ? '已启用自动调度，点击暂停' : '已暂停，点击启用'}
                    className={`rt-switch ${routine.enabled ? 'is-on' : ''}`}
                    onClick={() => onToggleEnable(routine)}
                  >
                    <span className="rt-switch-thumb" />
                  </button>
                  {isRunningNow && <span className="rt-status-pill is-running">执行中</span>}
                  {routine.hasQueuedRun && <span className="rt-status-pill is-queued">已排队</span>}
                </div>
                <div className="rt-drawer-sub">
                  <span>{bot?.name || routine.agentId}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    title={
                      previewNext.length > 0
                        ? `${routine.cronExpr}\n未来 3 次：\n${previewNext.join('\n')}`
                        : routine.cronExpr
                    }
                  >
                    {routine.scheduleHumanZh || formatCronZh(routine.cronExpr)}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="rt-drawer-close"
              onClick={onClose}
              aria-label="关闭详情"
              title="关闭 (Esc)"
            >
              <X size={16} />
            </button>
          </header>

          <div className="rt-drawer-body">
            {routine.circuitBrokenAt && (
              <div className="rt-breaker-banner" role="alert">
                <div className="rt-breaker-info">
                  <AlertTriangle size={15} />
                  <span>
                    连续失败 {routine.consecutiveFailures || 0} 次，任务已自动暂停。
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-secondary rt-breaker-btn"
                  onClick={() => onToggleEnable(routine, true)}
                >
                  恢复调度
                </button>
              </div>
            )}

            <div className="rt-drawer-actions">
              {isRunningNow ? (
                <button
                  type="button"
                  className="btn-secondary rt-btn-danger"
                  onClick={() => onCancelRun(routine.id, activeRunningRun?.id)}
                  disabled={isCancelling}
                >
                  <Square size={12} fill="currentColor" />
                  <span>{isCancelling ? '停止中...' : '停止执行'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="om-btn-primary rt-action-btn"
                  onClick={() => onRunNow(routine)}
                  disabled={isTriggering}
                >
                  {isTriggering ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                  <span>{isTriggering ? '启动中...' : '立即运行'}</span>
                </button>
              )}

              <button
                type="button"
                className="btn-secondary rt-action-btn"
                onClick={() => onEdit(routine)}
              >
                <Edit3 size={14} />
                <span>编辑</span>
              </button>

              <button
                type="button"
                className="btn-secondary rt-action-btn"
                onClick={() => onDebugInChat(routine)}
              >
                <MessageSquare size={14} />
                <span>在对话中调试</span>
              </button>

              <div className="rt-drawer-actions-spacer" />

              <button
                type="button"
                className={`btn-secondary rt-btn-icon ${confirmDelete ? 'is-confirming' : ''}`}
                onClick={handleDeleteClick}
                title={confirmDelete ? '再次点击确认删除' : '删除任务'}
                aria-label={confirmDelete ? '确认删除任务' : '删除任务'}
              >
                <Trash2 size={14} />
                {confirmDelete && <span>确认删除</span>}
              </button>
            </div>

            <dl className="rt-meta-strip">
              <div className="rt-meta-cell">
                <dt>下次触发</dt>
                <dd>
                  {!routine.enabled
                    ? '已暂停'
                    : routine.nextRunAt
                    ? formatNextRunFriendly(routine.nextRunAt)
                    : '按周期调度'}
                </dd>
              </div>
              <div className="rt-meta-cell">
                <dt>通知方式</dt>
                <dd>{DELIVER_SHORT_LABELS[deliverKey] || '动态流'}</dd>
              </div>
              <div className="rt-meta-cell">
                <dt>调度规则</dt>
                <dd className="rt-mono-val">{routine.cronExpr}</dd>
              </div>
              {routine.modelOverride && (
                <div className="rt-meta-cell">
                  <dt>专属模型</dt>
                  <dd>{routine.modelOverride}</dd>
                </div>
              )}
            </dl>

            <section className="rt-drawer-section">
              <div className="rt-section-head">
                <h2 className="rt-section-title">执行指令</h2>
                <button
                  type="button"
                  className="rt-text-btn"
                  onClick={() => handleCopy('prompt', routine.instructions || '', '执行指令')}
                >
                  {copiedKey === 'prompt' ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedKey === 'prompt' ? '已复制' : '复制指令'}</span>
                </button>
              </div>

              <div className={`rt-prompt-block ${isPromptExpanded ? 'is-expanded' : ''}`}>
                {routine.instructions}
              </div>

              {(routine.instructions || '').length > 160 && (
                <button
                  type="button"
                  className="rt-text-btn rt-expand-link"
                  onClick={() => setIsPromptExpanded((prev) => !prev)}
                >
                  {isPromptExpanded ? '收起' : '展开全文'}
                </button>
              )}
            </section>

            <section className="rt-drawer-section">
              <div className="rt-section-head">
                <div className="rt-section-title-group">
                  <h2 className="rt-section-title">执行记录</h2>
                  <span className="rt-section-count">{filteredRuns.length}</span>
                </div>

                <div className="rt-runs-controls">
                  <div className="rt-segmented" role="group" aria-label="记录状态筛选">
                    <button
                      type="button"
                      className={`rt-seg-btn ${runFilter === 'all' ? 'is-active' : ''}`}
                      onClick={() => setRunFilter('all')}
                    >
                      全部
                    </button>
                    <button
                      type="button"
                      className={`rt-seg-btn ${runFilter === 'abnormal' ? 'is-active' : ''}`}
                      onClick={() => setRunFilter('abnormal')}
                    >
                      仅异常
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRefreshRuns(routine.id)}
                    disabled={loadingRuns}
                    className="rt-icon-refresh"
                    title="刷新执行记录"
                    aria-label="刷新执行记录"
                  >
                    <RefreshCw size={13} className={loadingRuns ? 'spin' : ''} />
                  </button>
                </div>
              </div>

              {filteredRuns.length === 0 ? (
                <div className="rt-runs-empty">
                  {runs.length === 0
                    ? '暂无执行记录，可点击上方「立即运行」试跑一次。'
                    : '当前筛选下无异常执行记录。'}
                </div>
              ) : (
                <div className="rt-runs-table">
                  {filteredRuns.map((run) => {
                    const isExpanded = expandedRunIds.has(run.id);
                    const hasToolCalls = Boolean(run.toolCalls && run.toolCalls.length > 0);
                    const isRunning = run.status === 'running';
                    const isErrorState =
                      run.status === 'failed' ||
                      run.status === 'timeout' ||
                      run.status === 'interrupted';
                    const elapsedSeconds = isRunning
                      ? Math.max(0, Math.round((nowTick - run.startedAt) / 1000))
                      : null;
                    const reportContent = run.output || run.error || '';
                    const triggerLabel = TRIGGER_LABELS[run.triggerSource || 'manual'] || '手动';

                    return (
                      <div key={run.id} className={`rt-run-row ${isRunning ? 'is-running' : ''}`}>
                        <div
                          className="rt-run-row-head"
                          onClick={() => toggleRunExpand(run.id)}
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleRunExpand(run.id);
                            }
                          }}
                        >
                          <div className="rt-run-row-left">
                            {run.status === 'success' ? (
                              <CheckCircle2 size={16} className="rt-run-icon is-success" />
                            ) : isRunning ? (
                              <Loader2 size={16} className="spin rt-run-icon is-running" />
                            ) : run.status === 'cancelled' ? (
                              <Square size={14} className="rt-run-icon is-cancelled" />
                            ) : run.status === 'timeout' ? (
                              <Clock size={16} className="rt-run-icon is-failed" />
                            ) : (
                              <XCircle size={16} className="rt-run-icon is-failed" />
                            )}

                            <div className="rt-run-summary-wrap">
                              <div className="rt-run-summary-text">
                                {isRunning
                                  ? '正在执行中...'
                                  : run.summary ||
                                    (run.status === 'success'
                                      ? '执行完成'
                                      : run.error || STATUS_LABELS[run.status])}
                              </div>

                              <div className="rt-run-meta-line">
                                <span>{formatTime(run.startedAt)}</span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {isRunning && elapsedSeconds !== null
                                    ? `已运行 ${elapsedSeconds}s`
                                    : run.durationMs !== undefined
                                    ? `${(run.durationMs / 1000).toFixed(1)}s`
                                    : '-'}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{triggerLabel}</span>
                                {run.quiet && <span className="rt-run-tag">静默</span>}
                                {isErrorState && (
                                  <span className="rt-run-tag is-error">
                                    {STATUS_LABELS[run.status]}
                                  </span>
                                )}
                                {run.status === 'cancelled' && (
                                  <span className="rt-run-tag is-warn">已中止</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div
                            className="rt-run-row-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isRunning && (
                              <button
                                type="button"
                                onClick={() => onCancelRun(routine.id, run.id)}
                                disabled={isCancelling}
                                className="rt-run-stop-btn"
                              >
                                停止
                              </button>
                            )}
                            <button
                              type="button"
                              className="rt-run-chevron-btn"
                              onClick={() => toggleRunExpand(run.id)}
                              aria-label={isExpanded ? '收起详情' : '展开详情'}
                            >
                              {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="rt-run-row-body">
                            <div className="rt-run-body-actions">
                              {run.sessionId && !isRunning && (
                                <button
                                  type="button"
                                  className="rt-text-btn"
                                  onClick={() => onOpenSession(run.sessionId!)}
                                >
                                  <MessageSquare size={12} />
                                  <span>查看完整会话</span>
                                </button>
                              )}
                              {reportContent && !isRunning && (
                                <button
                                  type="button"
                                  className="rt-text-btn"
                                  onClick={() =>
                                    handleCopy(`run_${run.id}`, reportContent, '执行报告')
                                  }
                                >
                                  {copiedKey === `run_${run.id}` ? (
                                    <Check size={12} />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                  <span>
                                    {copiedKey === `run_${run.id}` ? '已复制' : '复制报告'}
                                  </span>
                                </button>
                              )}
                              {(isErrorState || run.status === 'cancelled') && (
                                <button
                                  type="button"
                                  className="rt-text-btn"
                                  onClick={() => onRunNow(routine)}
                                  disabled={isTriggering}
                                >
                                  <RefreshCw size={12} className={isTriggering ? 'spin' : ''} />
                                  <span>重新运行</span>
                                </button>
                              )}
                            </div>

                            {hasToolCalls && (
                              <div className="rt-run-trace-wrap">
                                <ToolTrace
                                  tools={(run.toolCalls || []).map((tc) => ({
                                    tool: tc.tool,
                                    params: tc.args,
                                    result: tc.output,
                                    status: 'done',
                                  }))}
                                />
                              </div>
                            )}

                            {isRunning ? (
                              <div className="rt-run-running-note">
                                <Loader2 size={14} className="spin" />
                                <span>正在沙箱中执行任务（已运行 {elapsedSeconds}s）...</span>
                              </div>
                            ) : run.output ? (
                              <div
                                className="markdown-body rt-run-markdown"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(run.output) }}
                              />
                            ) : (
                              <pre className="rt-run-error-pre">
                                {run.error || '无输出信息'}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </dialog>
  );
};
