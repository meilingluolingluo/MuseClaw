import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import {
  formatCronZh,
  previewNextRuns,
  parseNaturalLanguageToCron,
} from '../../utils/cronHelper';

interface SchedulePickerProps {
  value: string;
  timezone?: string;
  onChange: (cron: string, kind?: 'cron' | 'every' | 'at') => void;
}

const PRESET_CHIPS = [
  { text: '工作日 09:00', cron: '0 9 * * 1-5', kind: 'cron' as const },
  { text: '工作日 18:00', cron: '0 18 * * 1-5', kind: 'cron' as const },
  { text: '每天 09:00', cron: '0 9 * * *', kind: 'cron' as const },
  { text: '每小时', cron: '0 * * * *', kind: 'cron' as const },
  { text: '每 30 分钟', cron: '*/30 * * * *', kind: 'every' as const },
  { text: '每周五 18:00', cron: '0 18 * * 5', kind: 'cron' as const },
];

export const SchedulePicker: React.FC<SchedulePickerProps> = ({ value, timezone, onChange }) => {
  const [inputMode, setInputMode] = useState<'natural' | 'cron'>('natural');
  const [naturalText, setNaturalText] = useState(() => formatCronZh(value) || '工作日 09:00');
  const lastEmittedRef = useRef<string>(value);

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setNaturalText(formatCronZh(value) || value);
    }
  }, [value]);

  const handleNaturalChange = (text: string) => {
    setNaturalText(text);
    const result = parseNaturalLanguageToCron(text);
    if (result) {
      lastEmittedRef.current = result.cron;
      onChange(result.cron, result.kind);
    }
  };

  const handleCronChange = (rawCron: string) => {
    lastEmittedRef.current = rawCron;
    onChange(rawCron);
    setNaturalText(formatCronZh(rawCron));
  };

  const handleSelectPreset = (chip: (typeof PRESET_CHIPS)[number]) => {
    setInputMode('natural');
    setNaturalText(chip.text);
    lastEmittedRef.current = chip.cron;
    onChange(chip.cron, chip.kind);
  };

  const previewRuns = useMemo(() => previewNextRuns(value, 3, timezone), [value, timezone]);
  const humanZh = useMemo(() => formatCronZh(value), [value]);

  return (
    <div className="sp-root">
      <div className="sp-input-row">
        {inputMode === 'natural' ? (
          <div className="sp-input-wrap">
            <input
              type="text"
              className="form-control sp-input"
              placeholder="如：工作日 09:00、每 30 分钟、每周五 18:00"
              value={naturalText}
              onChange={(e) => handleNaturalChange(e.target.value)}
            />
            {naturalText && (
              <button
                type="button"
                className="sp-clear-btn"
                onClick={() => handleNaturalChange('')}
                title="清空输入"
                aria-label="清空输入"
              >
                <X size={13} />
              </button>
            )}
          </div>
        ) : (
          <input
            type="text"
            className="form-control sp-input sp-input-mono"
            placeholder="如: 0 9 * * 1-5 或 */15 * * * *"
            value={value}
            onChange={(e) => handleCronChange(e.target.value)}
          />
        )}

        <button
          type="button"
          className="sp-mode-btn"
          onClick={() => setInputMode((prev) => (prev === 'natural' ? 'cron' : 'natural'))}
        >
          {inputMode === 'natural' ? 'Cron 表达式' : '自然语言'}
        </button>
      </div>

      <div className="sp-presets">
        {PRESET_CHIPS.map((chip) => {
          const isSelected = chip.cron.trim() === value.trim();
          return (
            <button
              key={chip.text}
              type="button"
              onClick={() => handleSelectPreset(chip)}
              className={`sp-chip ${isSelected ? 'is-active' : ''}`}
            >
              {chip.text}
            </button>
          );
        })}
      </div>

      <div className="sp-summary" title={previewRuns.length > 0 ? `未来 3 次：\n${previewRuns.join('\n')}` : humanZh}>
        <span className="sp-summary-next">
          {previewRuns.length > 0 ? `下次运行：${previewRuns[0]}` : humanZh}
        </span>
        <code className="sp-summary-cron">{value}</code>
      </div>
    </div>
  );
};
