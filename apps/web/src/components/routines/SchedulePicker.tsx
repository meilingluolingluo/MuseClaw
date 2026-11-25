import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  formatCronZh,
  previewNextRuns,
  parseCronToVisual,
  buildCronFromVisual,
  validateCronExpr,
} from '../../utils/cronHelper';

export interface SchedulePickerProps {
  value: string;
  timezone?: string;
  onChange: (cron: string, kind: 'cron' | 'every' | 'at') => void;
  onValidityChange?: (valid: boolean) => void;
}

type ScheduleMode = 'daily' | 'workday' | 'weekly' | 'interval' | 'at' | 'custom';

const MODE_TABS: Array<{ id: ScheduleMode; label: string }> = [
  { id: 'daily', label: '每天' },
  { id: 'workday', label: '工作日' },
  { id: 'weekly', label: '每周' },
  { id: 'interval', label: '间隔' },
  { id: 'at', label: '单次' },
  { id: 'custom', label: 'Cron' },
];

const WEEKDAY_BUTTONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
];

const INTERVAL_PRESETS: Array<{ label: string; value: number; unit: 'm' | 'h' }> = [
  { label: '15 分钟', value: 15, unit: 'm' },
  { label: '30 分钟', value: 30, unit: 'm' },
  { label: '1 小时', value: 1, unit: 'h' },
  { label: '2 小时', value: 2, unit: 'h' },
  { label: '6 小时', value: 6, unit: 'h' },
];

function pad2(n: number): string {
  return String(Math.max(0, n)).padStart(2, '0');
}

function toTimeInputValue(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseTimeInputValue(raw: string): { hour: number; minute: number } {
  const [h, m] = (raw || '09:00').split(':').map((part) => parseInt(part, 10));
  return {
    hour: isNaN(h) ? 9 : Math.min(23, Math.max(0, h)),
    minute: isNaN(m) ? 0 : Math.min(59, Math.max(0, m)),
  };
}

function toLocalDatetimeInput(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function defaultFutureDatetimeInput(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setSeconds(0, 0);
  return toLocalDatetimeInput(next);
}

function deriveStateFromExpr(expr: string): {
  mode: ScheduleMode;
  hour: number;
  minute: number;
  weekdays: number[];
  intervalValue: number;
  intervalUnit: 'm' | 'h';
  atLocalStr: string;
  customExpr: string;
} {
  const trimmed = (expr || '').trim() || '0 9 * * 1-5';

  if (trimmed.startsWith('@at ')) {
    const rawDate = trimmed.slice(4).trim();
    const parsed = new Date(rawDate);
    return {
      mode: 'at',
      hour: 9,
      minute: 0,
      weekdays: [1, 2, 3, 4, 5],
      intervalValue: 30,
      intervalUnit: 'm',
      atLocalStr: !isNaN(parsed.getTime()) ? toLocalDatetimeInput(parsed) : defaultFutureDatetimeInput(),
      customExpr: trimmed,
    };
  }

  const parsed = parseCronToVisual(trimmed);
  let mode: ScheduleMode = 'custom';
  if (parsed.frequency === 'daily') mode = 'daily';
  else if (parsed.frequency === 'workday') mode = 'workday';
  else if (parsed.frequency === 'weekly') mode = 'weekly';
  else if (parsed.frequency === 'interval') mode = 'interval';

  return {
    mode,
    hour: parsed.hour,
    minute: parsed.minute,
    weekdays: parsed.weekdays.length > 0 ? parsed.weekdays : [1],
    intervalValue: parsed.intervalValue,
    intervalUnit: parsed.intervalUnit,
    atLocalStr: defaultFutureDatetimeInput(),
    customExpr: trimmed,
  };
}

export const SchedulePicker: React.FC<SchedulePickerProps> = ({
  value,
  timezone,
  onChange,
  onValidityChange,
}) => {
  const initial = useMemo(() => deriveStateFromExpr(value), []);
  const [mode, setMode] = useState<ScheduleMode>(initial.mode);
  const [hour, setHour] = useState<number>(initial.hour);
  const [minute, setMinute] = useState<number>(initial.minute);
  const [weekdays, setWeekdays] = useState<number[]>(initial.weekdays);
  const [intervalValue, setIntervalValue] = useState<number>(initial.intervalValue);
  const [intervalUnit, setIntervalUnit] = useState<'m' | 'h'>(initial.intervalUnit);
  const [atLocalStr, setAtLocalStr] = useState<string>(initial.atLocalStr);
  const [customExpr, setCustomExpr] = useState<string>(initial.customExpr);

  const lastEmittedRef = useRef<string>(value);
  const timeInputId = useId();
  const intervalInputId = useId();
  const intervalUnitId = useId();
  const atInputId = useId();
  const customInputId = useId();

  // 仅当外部受控值被模板或编辑切换重置时同步状态
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    const next = deriveStateFromExpr(value);
    setMode(next.mode);
    setHour(next.hour);
    setMinute(next.minute);
    setWeekdays(next.weekdays);
    setIntervalValue(next.intervalValue);
    setIntervalUnit(next.intervalUnit);
    setAtLocalStr(next.atLocalStr);
    setCustomExpr(next.customExpr);
  }, [value]);

  const emit = (nextExpr: string, kind: 'cron' | 'every' | 'at') => {
    lastEmittedRef.current = nextExpr;
    setCustomExpr(nextExpr);
    onChange(nextExpr, kind);
  };

  const validation = useMemo(() => {
    if (mode === 'custom') {
      return validateCronExpr(customExpr);
    }
    if (mode === 'at') {
      return validateCronExpr(value);
    }
    if (mode === 'interval') {
      if (!intervalValue || intervalValue < 1 || intervalValue > 1440) {
        return { valid: false, error: '间隔数值需在 1 至 1440 之间' };
      }
      return { valid: true };
    }
    return { valid: true };
  }, [mode, customExpr, value, intervalValue]);

  useEffect(() => {
    onValidityChange?.(validation.valid);
  }, [validation.valid, onValidityChange]);

  const handleModeSwitch = (nextMode: ScheduleMode) => {
    setMode(nextMode);
    if (nextMode === 'daily') {
      emit(
        buildCronFromVisual({
          frequency: 'daily',
          hour,
          minute,
          weekdays,
          monthDay: 1,
          intervalUnit,
          intervalValue,
          customCron: customExpr,
        }),
        'cron'
      );
    } else if (nextMode === 'workday') {
      emit(
        buildCronFromVisual({
          frequency: 'workday',
          hour,
          minute,
          weekdays: [1, 2, 3, 4, 5],
          monthDay: 1,
          intervalUnit,
          intervalValue,
          customCron: customExpr,
        }),
        'cron'
      );
    } else if (nextMode === 'weekly') {
      const safeDays = weekdays.length > 0 ? weekdays : [1];
      setWeekdays(safeDays);
      emit(
        buildCronFromVisual({
          frequency: 'weekly',
          hour,
          minute,
          weekdays: safeDays,
          monthDay: 1,
          intervalUnit,
          intervalValue,
          customCron: customExpr,
        }),
        'cron'
      );
    } else if (nextMode === 'interval') {
      const safeVal = Math.max(1, Math.min(1440, intervalValue || 30));
      const expr = buildCronFromVisual({
        frequency: 'interval',
        hour,
        minute,
        weekdays,
        monthDay: 1,
        intervalUnit,
        intervalValue: safeVal,
        customCron: customExpr,
      });
      const kind = intervalUnit === 'h' && [1, 2, 3, 4, 6, 8, 12].includes(safeVal) ? 'cron' : 'every';
      emit(expr, kind);
    } else if (nextMode === 'at') {
      const targetStr = atLocalStr || defaultFutureDatetimeInput();
      setAtLocalStr(targetStr);
      const parsed = new Date(targetStr);
      if (!isNaN(parsed.getTime())) {
        emit(`@at ${parsed.toISOString()}`, 'at');
      }
    } else {
      setCustomExpr(value || '0 9 * * 1-5');
    }
  };

  const handleTimeChange = (rawTime: string) => {
    const { hour: h, minute: m } = parseTimeInputValue(rawTime);
    setHour(h);
    setMinute(m);
    const freq = mode === 'workday' ? 'workday' : mode === 'weekly' ? 'weekly' : 'daily';
    emit(
      buildCronFromVisual({
        frequency: freq,
        hour: h,
        minute: m,
        weekdays,
        monthDay: 1,
        intervalUnit,
        intervalValue,
        customCron: customExpr,
      }),
      'cron'
    );
  };

  const handleToggleWeekday = (day: number) => {
    const exists = weekdays.includes(day);
    if (exists && weekdays.length === 1) return;
    const nextDays = exists
      ? weekdays.filter((d) => d !== day)
      : [...weekdays, day].sort((a, b) => a - b);
    setWeekdays(nextDays);
    emit(
      buildCronFromVisual({
        frequency: 'weekly',
        hour,
        minute,
        weekdays: nextDays,
        monthDay: 1,
        intervalUnit,
        intervalValue,
        customCron: customExpr,
      }),
      'cron'
    );
  };

  const applyInterval = (nextVal: number, nextUnit: 'm' | 'h') => {
    const safeVal = Math.max(1, Math.min(1440, nextVal || 1));
    setIntervalValue(safeVal);
    setIntervalUnit(nextUnit);
    const expr = buildCronFromVisual({
      frequency: 'interval',
      hour,
      minute,
      weekdays,
      monthDay: 1,
      intervalUnit: nextUnit,
      intervalValue: safeVal,
      customCron: customExpr,
    });
    const kind = nextUnit === 'h' && [1, 2, 3, 4, 6, 8, 12].includes(safeVal) ? 'cron' : 'every';
    emit(expr, kind);
  };

  const handleAtChange = (localValue: string) => {
    setAtLocalStr(localValue);
    const d = new Date(localValue);
    if (!isNaN(d.getTime())) {
      emit(`@at ${d.toISOString()}`, 'at');
    } else {
      emit(`@at ${localValue}`, 'at');
    }
  };

  const handleCustomChange = (raw: string) => {
    setCustomExpr(raw);
    const trimmed = raw.trim();
    const kind: 'cron' | 'every' | 'at' = trimmed.startsWith('@at ')
      ? 'at'
      : trimmed.startsWith('@every ') || trimmed.startsWith('*/')
      ? 'every'
      : 'cron';
    lastEmittedRef.current = raw;
    onChange(raw, kind);
  };

  const previewRuns = useMemo(
    () => (validation.valid ? previewNextRuns(value, 3, timezone) : []),
    [value, timezone, validation.valid]
  );
  const humanZh = useMemo(() => formatCronZh(value), [value]);

  return (
    <div className="sp-root">
      <div className="sp-mode-tabs" role="tablist" aria-label="执行周期模式">
        {MODE_TABS.map((tabItem) => {
          const active = mode === tabItem.id;
          return (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`sp-mode-tab ${active ? 'is-active' : ''}`}
              onClick={() => handleModeSwitch(tabItem.id)}
            >
              {tabItem.label}
            </button>
          );
        })}
      </div>

      <div className="sp-panel">
        {(mode === 'daily' || mode === 'workday') && (
          <div className="sp-row">
            <label htmlFor={timeInputId} className="sp-inline-label">
              {mode === 'workday' ? '周一至周五执行时间' : '每天执行时间'}
            </label>
            <input
              id={timeInputId}
              type="time"
              className="form-control sp-time-input"
              value={toTimeInputValue(hour, minute)}
              onChange={(e) => handleTimeChange(e.target.value)}
            />
          </div>
        )}

        {mode === 'weekly' && (
          <div className="sp-weekly-wrap">
            <div className="sp-weekdays" role="group" aria-label="选择星期">
              {WEEKDAY_BUTTONS.map((day) => {
                const pressed = weekdays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={pressed}
                    className={`sp-day-btn ${pressed ? 'is-selected' : ''}`}
                    onClick={() => handleToggleWeekday(day.value)}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <div className="sp-row">
              <label htmlFor={timeInputId} className="sp-inline-label">
                执行时间
              </label>
              <input
                id={timeInputId}
                type="time"
                className="form-control sp-time-input"
                value={toTimeInputValue(hour, minute)}
                onChange={(e) => handleTimeChange(e.target.value)}
              />
            </div>
          </div>
        )}

        {mode === 'interval' && (
          <div className="sp-interval-wrap">
            <div className="sp-presets" role="group" aria-label="常用间隔预设">
              {INTERVAL_PRESETS.map((preset) => {
                const active = intervalValue === preset.value && intervalUnit === preset.unit;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className={`sp-chip ${active ? 'is-active' : ''}`}
                    onClick={() => applyInterval(preset.value, preset.unit)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="sp-row">
              <label htmlFor={intervalInputId} className="sp-inline-label">
                每隔
              </label>
              <input
                id={intervalInputId}
                type="number"
                min={1}
                max={1440}
                className="form-control sp-number-input"
                value={intervalValue}
                onChange={(e) => applyInterval(parseInt(e.target.value, 10) || 1, intervalUnit)}
              />
              <select
                id={intervalUnitId}
                aria-label="间隔单位"
                className="form-control sp-unit-select"
                value={intervalUnit}
                onChange={(e) => applyInterval(intervalValue, e.target.value as 'm' | 'h')}
              >
                <option value="m">分钟</option>
                <option value="h">小时</option>
              </select>
              <span className="sp-inline-hint">执行一次</span>
            </div>
          </div>
        )}

        {mode === 'at' && (
          <div className="sp-at-wrap">
            <div className="sp-row">
              <label htmlFor={atInputId} className="sp-inline-label">
                触发时间
              </label>
              <input
                id={atInputId}
                type="datetime-local"
                className="form-control sp-datetime-input"
                value={atLocalStr}
                onChange={(e) => handleAtChange(e.target.value)}
              />
            </div>
            <p className="sp-inline-note">单次定时将在执行完成后自动暂停。</p>
          </div>
        )}

        {mode === 'custom' && (
          <div className="sp-custom-wrap">
            <label htmlFor={customInputId} className="sr-only">
              Cron 表达式
            </label>
            <input
              id={customInputId}
              type="text"
              className={`form-control sp-input-mono ${!validation.valid ? 'is-invalid' : ''}`}
              placeholder="5 段式 Cron（如 0 9 * * 1-5）或 @every 15m"
              value={customExpr}
              onChange={(e) => handleCustomChange(e.target.value)}
              aria-invalid={!validation.valid}
            />
          </div>
        )}

        {!validation.valid && validation.error && (
          <div className="sp-error" role="alert">
            <AlertCircle size={13} />
            <span>{validation.error}</span>
          </div>
        )}
      </div>

      <div
        className="sp-summary"
        title={previewRuns.length > 0 ? `未来 3 次触发：\n${previewRuns.join('\n')}` : humanZh}
      >
        <div className="sp-summary-main">
          <span className="sp-summary-human">{validation.valid ? humanZh : '表达式待修正'}</span>
          {previewRuns.length > 0 && (
            <span className="sp-summary-next">下次：{previewRuns[0]}</span>
          )}
        </div>
        <code className="sp-summary-cron">{value || '-'}</code>
      </div>
    </div>
  );
};
