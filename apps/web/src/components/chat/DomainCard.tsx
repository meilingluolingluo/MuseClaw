import React, { useState } from 'react';
import {
  ArrowRight,
  Brain,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  HelpCircle,
  Rss,
  Send,
  Target,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { DomainCardKind } from '../../utils/markdownBlocks';
import type { ToolTraceItem } from './ToolTrace';

interface DomainCardProps {
  kind: Exclude<DomainCardKind, 'clarify'>;
  data: Record<string, any>;
}

const DOMAIN_TAB_MAP: Record<Exclude<DomainCardKind, 'clarify'>, 'goals' | 'feed' | 'routines' | 'memory'> = {
  goal: 'goals',
  'goal-update': 'goals',
  feed: 'feed',
  routine: 'routines',
  memory: 'memory',
};

const DOMAIN_ACTION_LABEL: Record<Exclude<DomainCardKind, 'clarify'>, string> = {
  goal: '前往目标看板',
  'goal-update': '查看目标进展',
  feed: '前往态势流',
  routine: '前往例程工作台',
  memory: '管理长期记忆',
};

export const DomainCard: React.FC<DomainCardProps> = ({ kind, data }) => {
  const { setTab } = useApp();
  const targetTab = DOMAIN_TAB_MAP[kind];

  const renderIcon = () => {
    switch (kind) {
      case 'goal':
      case 'goal-update':
        return <Target size={15} />;
      case 'feed':
        return <Rss size={15} />;
      case 'routine':
        return <Calendar size={15} />;
      case 'memory':
        return <Brain size={15} />;
    }
  };

  const badgeLabel =
    kind === 'goal'
      ? '目标已创建'
      : kind === 'goal-update'
      ? '目标进度更新'
      : kind === 'feed'
      ? '态势动态已发布'
      : kind === 'routine'
      ? '例行任务已配置'
      : '长期记忆已沉淀';

  const progressRaw = Number(data.progress);
  const hasProgress = Number.isFinite(progressRaw) && progressRaw >= 0;
  const clampedProgress = hasProgress ? Math.min(100, Math.max(0, Math.round(progressRaw))) : 0;
  const steps: string[] = Array.isArray(data.steps)
    ? data.steps.map((s: any) => (typeof s === 'string' ? s : s?.title || '')).filter(Boolean).slice(0, 5)
    : [];

  return (
    <div className={`domain-inline-card is-${kind}`}>
      <div className="domain-inline-header">
        <div className="domain-inline-badge">
          {renderIcon()}
          <span>{badgeLabel}</span>
        </div>
        {data.status && (
          <span className={`domain-status-pill is-${String(data.status).toLowerCase()}`}>
            {data.status === 'done' || data.status === 'completed'
              ? '已完成'
              : data.status === 'attention' || data.status === 'blocked'
              ? '需关注'
              : '推进中'}
          </span>
        )}
      </div>

      {(data.title || data.name || data.content) && (
        <div className="domain-inline-title">
          {data.emoji ? `${data.emoji} ` : ''}
          {data.title || data.name || data.content}
        </div>
      )}

      {(data.why || data.description || data.note || data.body) && (
        <div className="domain-inline-desc">
          {data.why || data.description || data.note || data.body}
        </div>
      )}

      {hasProgress && (
        <div className="domain-progress-wrap">
          <div className="domain-progress-bar" role="progressbar" aria-valuenow={clampedProgress} aria-valuemin={0} aria-valuemax={100}>
            <span className="domain-progress-fill" style={{ width: `${clampedProgress}%` }} />
          </div>
          <span className="domain-progress-pct">{clampedProgress}%</span>
        </div>
      )}

      {steps.length > 0 && (
        <ul className="domain-steps-list">
          {steps.map((step, idx) => (
            <li key={idx}>{step}</li>
          ))}
        </ul>
      )}

      <div className="domain-inline-footer">
        <span className="domain-inline-meta">
          {data.cadence || data.scheduleHumanZh || data.cronExpr || (data.check_every_hours ? `每 ${data.check_every_hours} 小时检查` : '') || data.category || ''}
        </span>
        <button
          type="button"
          className="domain-inline-action"
          onClick={() => setTab(targetTab)}
        >
          <span>{DOMAIN_ACTION_LABEL[kind]}</span>
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
};

interface ClarifyOption {
  label: string;
  description?: string;
}

interface ClarifyQuestion {
  id?: string;
  question: string;
  multiSelect?: boolean;
  options: ClarifyOption[];
}

function normalizeClarifyQuestions(data: Record<string, any>): ClarifyQuestion[] {
  const toOpt = (o: any): ClarifyOption =>
    typeof o === 'string'
      ? { label: o }
      : { label: String(o?.label || o?.title || o?.value || ''), description: o?.description || o?.desc };

  if (Array.isArray(data.questions) && data.questions.length > 0) {
    return data.questions
      .map((q: any, idx: number) => ({
        id: q?.id || `q_${idx}`,
        question: String(q?.question || q?.title || `问题 ${idx + 1}`),
        multiSelect: Boolean(q?.multiSelect || q?.is_multi_select),
        options: Array.isArray(q?.options) ? q.options.map(toOpt).filter((o: ClarifyOption) => o.label) : [],
      }))
      .filter((q: ClarifyQuestion) => q.options.length > 0);
  }

  if (Array.isArray(data.options) && data.options.length > 0) {
    return [
      {
        id: 'q_0',
        question: String(data.question || data.title || '请选择您的偏好或方案'),
        multiSelect: Boolean(data.multiSelect || data.is_multi_select),
        options: data.options.map(toOpt).filter((o: ClarifyOption) => o.label),
      },
    ];
  }

  return [];
}

export const ClarifyCard: React.FC<{
  data: Record<string, any>;
  onSendPrompt?: (prompt: string) => void;
}> = ({ data, onSendPrompt }) => {
  const questions = normalizeClarifyQuestions(data);
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [customNote, setCustomNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (questions.length === 0) return null;

  const toggleOption = (qIdx: number, label: string, multi?: boolean) => {
    if (submitted) return;
    setSelections((prev) => {
      const current = prev[qIdx] || [];
      if (multi) {
        const exists = current.includes(label);
        return {
          ...prev,
          [qIdx]: exists ? current.filter((x) => x !== label) : [...current, label],
        };
      }
      return { ...prev, [qIdx]: [label] };
    });
  };

  const hasAnyChoice =
    Object.values(selections).some((arr) => arr.length > 0) || customNote.trim().length > 0;

  const handleSubmit = () => {
    if (submitted || !hasAnyChoice || !onSendPrompt) return;
    const lines: string[] = [];
    questions.forEach((q, idx) => {
      const picked = selections[idx] || [];
      if (picked.length > 0) {
        lines.push(questions.length > 1 ? `${q.question}：${picked.join('、')}` : `我选择：${picked.join('、')}`);
      }
    });
    if (customNote.trim()) {
      lines.push(`补充说明：${customNote.trim()}`);
    }
    setSubmitted(true);
    onSendPrompt(lines.join('\n'));
  };

  return (
    <div className={`clarify-card${submitted ? ' is-submitted' : ''}`}>
      <div className="clarify-card-header">
        <HelpCircle size={15} />
        <span>请确认以下选项以继续</span>
        {submitted && (
          <span className="clarify-submitted-badge">
            <Check size={12} /> 已回复
          </span>
        )}
      </div>

      <div className="clarify-questions">
        {questions.map((q, qIdx) => {
          const picked = selections[qIdx] || [];
          return (
            <div key={q.id || qIdx} className="clarify-question-block">
              <div className="clarify-question-title">
                {q.question}
                {q.multiSelect && <span className="clarify-multi-hint">（可多选）</span>}
              </div>
              <div className="clarify-options-list">
                {q.options.map((opt, oIdx) => {
                  const active = picked.includes(opt.label);
                  return (
                    <button
                      key={oIdx}
                      type="button"
                      disabled={submitted}
                      className={`clarify-option-btn${active ? ' is-active' : ''}`}
                      onClick={() => toggleOption(qIdx, opt.label, q.multiSelect)}
                    >
                      <span className="clarify-option-index">{oIdx + 1}</span>
                      <span className="clarify-option-body">
                        <span className="clarify-option-label">{opt.label}</span>
                        {opt.description && (
                          <span className="clarify-option-desc">{opt.description}</span>
                        )}
                      </span>
                      {active && <CheckCircle2 size={15} className="clarify-option-check" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {!submitted && (
        <div className="clarify-footer">
          <input
            type="text"
            className="clarify-custom-input"
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            placeholder="补充说明或自定义要求（可选）…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button
            type="button"
            className="clarify-submit-btn"
            disabled={!hasAnyChoice || !onSendPrompt}
            onClick={handleSubmit}
          >
            <Send size={13} />
            <span>提交确认</span>
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * 从已成功执行的业务工具调用中自动提取内联领域卡片摘要
 */
export function extractToolDomainCards(
  toolCalls?: ToolTraceItem[]
): Array<{ kind: Exclude<DomainCardKind, 'clarify'>; data: Record<string, any> }> {
  if (!toolCalls || toolCalls.length === 0) return [];
  const cards: Array<{ kind: Exclude<DomainCardKind, 'clarify'>; data: Record<string, any> }> = [];
  const seen = new Set<string>();

  for (const tc of toolCalls) {
    if (tc.ok === false || tc.status === 'failed' || tc.status === 'rejected' || tc.status === 'running') {
      continue;
    }
    const name = String(tc.tool || '').toLowerCase();
    const params = (tc.params && typeof tc.params === 'object' ? tc.params : {}) as Record<string, any>;
    const rawRes = tc.result ?? tc.output;
    const resObj = (rawRes && typeof rawRes === 'object' ? rawRes : {}) as Record<string, any>;
    const merged = { ...params, ...(resObj.goal || resObj.routine || resObj.post || resObj) };

    if (name === 'create_goal' || name === 'goal_create') {
      const title = merged.title || '新目标';
      const key = `goal:${title}`;
      if (!seen.has(key)) {
        seen.add(key);
        cards.push({ kind: 'goal', data: merged });
      }
    } else if (name === 'update_goal' || name === 'advance_goal' || name === 'checkin_goal') {
      const key = `goal-upd:${merged.goalId || merged.id || merged.title || cards.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        cards.push({ kind: 'goal-update', data: merged });
      }
    } else if (name === 'create_routine' || name === 'schedule_routine' || name === 'routine_create') {
      const title = merged.name || merged.title || '新例行任务';
      const key = `routine:${title}`;
      if (!seen.has(key)) {
        seen.add(key);
        cards.push({ kind: 'routine', data: merged });
      }
    } else if (name === 'memory_save' || name === 'save_memory' || name === 'add_memory') {
      const content = merged.content || merged.text || merged.fact;
      if (content) {
        const key = `mem:${String(content).slice(0, 40)}`;
        if (!seen.has(key)) {
          seen.add(key);
          cards.push({ kind: 'memory', data: { content, category: merged.category || '记忆沉淀' } });
        }
      }
    } else if (name === 'publish_feed' || name === 'create_feed_post') {
      const title = merged.title || '态势简报';
      const key = `feed:${title}`;
      if (!seen.has(key)) {
        seen.add(key);
        cards.push({ kind: 'feed', data: merged });
      }
    }
  }

  return cards;
}
