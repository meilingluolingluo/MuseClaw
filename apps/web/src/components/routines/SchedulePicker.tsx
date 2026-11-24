import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Calendar,
  RotateCcw,
  Bot,
} from 'lucide-react';
import {
  formatCronZh,
  previewNextRuns,
  parseNaturalLanguageToCron,
  SCHEDULE_PRESETS,
  SchedulePreset,
} from '../../utils/cronHelper';

interface SchedulePickerProps {
  value: string;
  timezone?: string;
  onChange: (cron: string, kind?: 'cron' | 'every' | 'at') => void;
}

const NATURAL_SUGGESTIONS = [
  { text: '工作日早晨 09:00', icon: '💼', desc: '周一至周五 09:00' },
  { text: '工作日下班 18:00', icon: '🏠', desc: '周一至周五 18:00' },
  { text: '每天早晨 09:00', icon: '☀️', desc: '每天 09:00' },
  { text: '每小时整点', icon: '⏱️', desc: '每小时整点执行' },
  { text: '每 15 分钟', icon: '⚡', desc: '高频巡检' },
  { text: '每 30 分钟', icon: '🔄', desc: '半小时监控' },
  { text: '每周一早晨 10:00', icon: '📅', desc: '每周一 10:00' },
  { text: '每周五傍晚 18:00', icon: '📊', desc: '周五下班前' },
  { text: '每月 1 号上午 09:00', icon: '🗓️', desc: '每月初' },
];

export const SchedulePicker: React.FC<SchedulePickerProps> = ({ value, timezone, onChange }) => {
  const [naturalText, setNaturalText] = useState(() => formatCronZh(value) || '工作日早晨 09:00');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState<string | null>(null);

  // 当外部 value 改变时同步更新建议激活状态与自然语言描述
  useEffect(() => {
    // 匹配建议胶囊
    const matched = NATURAL_SUGGESTIONS.find((s) => {
      const parsed = parseNaturalLanguageToCron(s.text);
      return parsed && parsed.cron.trim() === value.trim();
    });
    setActiveSuggestion(matched ? matched.text : null);
  }, [value]);

  // 处理自然语言输入变更与即时语义识别
  const handleNaturalChange = (text: string) => {
    setNaturalText(text);
    const result = parseNaturalLanguageToCron(text);
    if (result) {
      onChange(result.cron, result.kind);
    }
  };

  // 点击快捷建议芯片
  const handleSelectSuggestion = (text: string) => {
    setNaturalText(text);
    setActiveSuggestion(text);
    const result = parseNaturalLanguageToCron(text);
    if (result) {
      onChange(result.cron, result.kind);
    }
  };

  // 未来预估执行时间
  const previewRuns = useMemo(() => {
    return previewNextRuns(value, 3, timezone);
  }, [value, timezone]);

  const humanZh = useMemo(() => {
    return formatCronZh(value);
  }, [value]);

  return (
    <div className="schedule-ai-picker-root">
      {/* 1. 自然语言描述与 AI 智能识别输入 */}
      <div className="schedule-ai-input-card">
        <div className="schedule-ai-input-header">
          <div className="schedule-ai-title-group">
            <span className="schedule-ai-sparkle-badge">
              <Sparkles size={13} /> AI 智能识别
            </span>
            <span className="schedule-ai-title">语言描述调度周期</span>
          </div>
          <span className="schedule-ai-subhint">用大白话输入何时运行，AI 将自动转译为调度策略</span>
        </div>

        <div className="schedule-ai-input-wrap">
          <input
            type="text"
            className="schedule-ai-text-input"
            placeholder="例如：每个工作日早晨 9 点、每 15 分钟、每周五傍晚 6 点半、每月 1 号上午 10 点..."
            value={naturalText}
            onChange={(e) => handleNaturalChange(e.target.value)}
          />
          {naturalText && (
            <button
              type="button"
              className="schedule-ai-clear-btn"
              onClick={() => handleNaturalChange('')}
              title="清空"
            >
              ×
            </button>
          )}
        </div>

        {/* 快捷自然语言建议胶囊 */}
        <div className="schedule-ai-suggestions-row">
          <span className="schedule-ai-suggestions-label">常用描述:</span>
          <div className="schedule-ai-chips-list">
            {NATURAL_SUGGESTIONS.map((item) => {
              const isSelected = activeSuggestion === item.text;
              return (
                <button
                  key={item.text}
                  type="button"
                  onClick={() => handleSelectSuggestion(item.text)}
                  className={`schedule-ai-chip ${isSelected ? 'is-active' : ''}`}
                >
                  <span className="schedule-ai-chip-icon">{item.icon}</span>
                  <span className="schedule-ai-chip-text">{item.text}</span>
                  {isSelected && <Check size={11} className="schedule-ai-chip-check" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. 实时识别结果看板 (AI 识别反馈与预测) */}
      <div className="schedule-ai-result-card">
        <div className="schedule-ai-result-top">
          <div className="schedule-ai-status-indicator">
            <span className="schedule-ai-dot" />
            <span className="schedule-ai-status-text">AI 识别成功</span>
          </div>
          <div className="schedule-ai-cron-badge">
            Cron 映射: <code>{value}</code>
          </div>
        </div>

        <div className="schedule-ai-result-zh">
          📅 {humanZh}
        </div>

        {previewRuns.length > 0 && (
          <div className="schedule-ai-preview-section">
            <div className="schedule-ai-preview-header">接下来 3 次运行预估:</div>
            <div className="schedule-ai-preview-items">
              {previewRuns.map((r, i) => (
                <div key={i} className="schedule-ai-preview-item">
                  • {r}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. 高级专家模式 (Cron 原生表达式折叠) */}
      <div className="schedule-ai-advanced-fold">
        <button
          type="button"
          className="schedule-ai-advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span>⚙️ 高级设置：Cron 表达式与专家模式</span>
          {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {showAdvanced && (
          <div className="schedule-ai-advanced-panel">
            <label className="form-label">
              调度表达式 (标准 5 段式 Cron / @every 间隔 / @at 单次)
            </label>
            <input
              type="text"
              className="form-control font-mono"
              placeholder="如: 0 9 * * 1-5 或 */15 * * * *"
              value={value}
              onChange={(e) => {
                const val = e.target.value;
                onChange(val);
                setNaturalText(formatCronZh(val));
              }}
            />
            <span className="schedule-ai-advanced-desc">
              支持直接输入底层 Cron 表达式，修改后将自动反向推导上方自然语言与执行预测。
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
