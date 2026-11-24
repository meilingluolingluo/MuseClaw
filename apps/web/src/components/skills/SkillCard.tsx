import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot as BotIcon,
  CheckCircle2,
  MessageSquare,
  Pin,
  ShieldAlert,
  SlidersHorizontal
} from 'lucide-react';
import type { Skill } from '../../types';
import { CATEGORY_META, LIFECYCLE_LABELS, SOURCE_LABELS } from './skillsMeta';

interface SkillCardProps {
  skill: Skill;
  onOpenWorkbench: (skill: Skill, initialTab?: 'overview' | 'files' | 'test' | 'manage') => void;
  onToggleEnabled: (skill: Skill) => void;
  onTogglePin: (skill: Skill) => void;
  onUseInChat: (skill: Skill) => void;
}

export const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  onOpenWorkbench,
  onToggleEnabled,
  onTogglePin,
  onUseInChat
}) => {
  const catMeta = CATEGORY_META[skill.category] || CATEGORY_META.utility;
  const isReady = skill.readiness?.ready !== false;
  const isPinned = Boolean(skill.usage?.pinned);
  const useCount = skill.usage?.useCount || 0;
  const lifecycleState = skill.usage?.lifecycleState || 'active';
  const verdict = skill.security?.verdict || 'safe';
  const lintScore = skill.lint?.score;

  return (
    <div
      className={`skill-card${skill.enabled ? '' : ' is-disabled'}${lifecycleState === 'archived' ? ' is-archived' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpenWorkbench(skill, isReady ? 'overview' : 'overview')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenWorkbench(skill, 'overview');
        }
      }}
    >
      <div className="skill-card-main">
        <div className="skill-head">
          <div className="skill-badges">
            <span className={`badge badge-cat ${catMeta.className}`}>
              {catMeta.icon}
              {catMeta.label}
            </span>
            <span className="badge badge-src">{SOURCE_LABELS[skill.source] || skill.source}</span>
            {skill.hasBuiltinOverride && <span className="badge badge-override">已覆写</span>}
            {lifecycleState !== 'active' && (
              <span className={`badge badge-lifecycle is-${lifecycleState}`}>
                {LIFECYCLE_LABELS[lifecycleState]}
              </span>
            )}
            {verdict !== 'safe' && (
              <span
                className={`badge ${verdict === 'dangerous' ? 'badge-danger' : 'badge-warn'}`}
                title={skill.warnings.join('\n')}
              >
                <ShieldAlert size={11} />
                {verdict === 'dangerous' ? '高风险项' : '需关注'}
              </span>
            )}
          </div>

          <div className="skill-head-controls" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`skill-pin-btn${isPinned ? ' is-pinned' : ''}`}
              title={isPinned ? '取消置顶' : '置顶常用技能'}
              aria-label={isPinned ? `取消置顶 ${skill.name}` : `置顶 ${skill.name}`}
              onClick={() => onTogglePin(skill)}
            >
              <Pin size={13} />
            </button>
            <label className="skill-switch">
              <input
                type="checkbox"
                checked={skill.enabled}
                onChange={() => onToggleEnabled(skill)}
                aria-label={`启用或禁用技能 ${skill.name}`}
              />
              <span className={skill.enabled ? 'is-on' : 'is-off'}>{skill.enabled ? '启用' : '禁用'}</span>
            </label>
          </div>
        </div>

        <div className="skill-name-row">
          <h3 className="skill-name">/{skill.name}</h3>
          <span className="skill-ver">v{(skill.metadata?.version as string) || '1.0.0'}</span>
          {typeof lintScore === 'number' && lintScore < 90 && (
            <span className="skill-lint-chip" title="点击进入工作台查看质量优化建议">
              <AlertTriangle size={11} />
              {lintScore}分
            </span>
          )}
        </div>

        <p className="skill-desc">{skill.description}</p>

        <div className="skill-compact-meta">
          <span
            className={`skill-status-inline ${isReady ? 'is-ok' : 'is-warn'}`}
            title={skill.readiness?.details}
          >
            {isReady ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {isReady ? '环境就绪' : skill.readiness?.details || '待配置依赖'}
          </span>

          <span className="skill-stat-inline">{useCount} 次调用</span>

          <span className="skill-stat-inline">
            <BotIcon size={12} />
            {skill.everyBot ? '全员 Bot' : `${skill.assignedBots?.length || 0} Bot`}
          </span>
        </div>
      </div>

      <div className="skill-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="om-btn-subtle skill-action"
          onClick={() => onOpenWorkbench(skill, 'overview')}
        >
          <SlidersHorizontal size={13} />
          {isReady ? '工作台与详情' : '去配置依赖'}
        </button>

        <button
          type="button"
          className="om-btn-subtle skill-action"
          disabled={!skill.enabled || !isReady || lifecycleState === 'archived'}
          title={!isReady ? '请先在工作台补齐依赖环境' : `在对话中使用 /${skill.name}`}
          onClick={() => onUseInChat(skill)}
        >
          <MessageSquare size={13} />
          对话使用
        </button>
      </div>
    </div>
  );
};
