import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Clock,
  Calendar,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Sliders,
  Check,
  Zap,
  Repeat,
  Sparkles,
  Info,
  CalendarDays,
  Timer,
  Sun,
  Briefcase,
} from 'lucide-react';
import {
  SCHEDULE_PRESETS,
  SchedulePreset,
  ScheduleFrequency,
  VisualScheduleState,
  parseCronToVisual,
  buildCronFromVisual,
  formatCronZh,
  previewNextRuns,
} from '../../utils/cronHelper';

interface SchedulePickerProps {
  value: string;
  onChange: (cron: string, kind?: 'cron' | 'every' | 'at') => void;
}

const WEEKDAYS = [
  { id: 1, label: '周一', short: '一' },
  { id: 2, label: '周二', short: '二' },
  { id: 3, label: '周三', short: '三' },
  { id: 4, label: '周四', short: '四' },
  { id: 5, label: '周五', short: '五' },
  { id: 6, label: '周六', short: '六' },
  { id: 0, label: '周日', short: '日' },
];

const QUICK_MINUTES = [0, 15, 30, 45];
const QUICK_HOURS = [
  { h: 9, m: 0, label: '09:00 上班' },
  { h: 10, m: 0, label: '10:00 晨会' },
  { h: 12, m: 0, label: '12:00 午间' },
  { h: 14, m: 0, label: '14:00 下午' },
  { h: 18, m: 0, label: '18:00 下班' },
  { h: 22, m: 0, label: '22:00 晚间' },
];

const COMMON_MINUTE_INTERVALS = [5, 10, 15, 30, 45];
const COMMON_HOUR_INTERVALS = [1, 2, 4, 6, 12];

/**
 * 触控/滚轮双模式数字滚轮列
 */
interface WheelColumnProps {
  label: string;
  value: number;
  min: number;
  max: number;
  padZero?: boolean;
  onChange: (val: number) => void;
}

const WheelColumn: React.FC<WheelColumnProps> = ({
  label,
  value,
  min,
  max,
  padZero = true,
  onChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const ITEM_HEIGHT = 32;

  const items = useMemo(() => {
    const list: number[] = [];
    for (let i = min; i <= max; i++) {
      list.push(i);
    }
    return list;
  }, [min, max]);

  // 滚动到当前值位置
  useEffect(() => {
    if (containerRef.current) {
      const targetTop = (value - min) * ITEM_HEIGHT;
      containerRef.current.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }, [value, min]);

  const handleStep = (delta: number) => {
    let next = value + delta;
    if (next < min) next = max;
    else if (next > max) next = min;
    onChange(next);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      handleStep(1);
    } else if (e.deltaY < 0) {
      handleStep(-1);
    }
  };

  return (
    <div className="wheel-column-wrap">
      <div className="wheel-column-label">{label}</div>
      <button
        type="button"
        className="wheel-step-btn"
        onClick={() => handleStep(-1)}
        title={`上移减 1 ${label}`}
        aria-label={`上移减 1 ${label}`}
      >
        <ChevronUp size={14} />
      </button>

      <div
        className="wheel-roller-container"
        ref={containerRef}
        onWheel={handleWheel}
        tabIndex={0}
        role="listbox"
        aria-label={label}
      >
        <div className="wheel-roller-lens" aria-hidden="true" />
        <div className="wheel-roller-list">
          {items.map((num) => {
            const isSelected = num === value;
            const text = padZero ? num.toString().padStart(2, '0') : num.toString();
            return (
              <div
                key={num}
                onClick={() => onChange(num)}
                className={`wheel-roller-item ${isSelected ? 'is-selected' : ''}`}
                role="option"
                aria-selected={isSelected}
              >
                {text}
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="wheel-step-btn"
        onClick={() => handleStep(1)}
        title={`下移加 1 ${label}`}
        aria-label={`下移加 1 ${label}`}
      >
        <ChevronDown size={14} />
      </button>
    </div>
  );
};

export const SchedulePicker: React.FC<SchedulePickerProps> = ({ value, onChange }) => {
  // 解析传入的 cron 为可视化状态
  const [visualState, setVisualState] = useState<VisualScheduleState>(() => parseCronToVisual(value));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // 当外部 value 变更时，更新内部可视化状态并高亮匹配的预设
  useEffect(() => {
    const parsed = parseCronToVisual(value);
    setVisualState(parsed);

    // 检查是否完全匹配某个常用业务预设
    const matched = SCHEDULE_PRESETS.find((p) => p.cronExpr.trim() === value.trim());
    setActivePresetId(matched ? matched.id : null);
  }, [value]);

  // 更新状态并向外部触发更新
  const updateVisual = useCallback(
    (updater: (prev: VisualScheduleState) => VisualScheduleState) => {
      setVisualState((prev) => {
        const next = updater(prev);
        const newCron = buildCronFromVisual(next);
        const kind = next.frequency === 'interval' && newCron.startsWith('@every') ? 'every' : 'cron';
        onChange(newCron, kind);
        return next;
      });
    },
    [onChange]
  );

  // 1. 点击常用业务预设
  const handleSelectPreset = (p: SchedulePreset) => {
    setActivePresetId(p.id);
    onChange(p.cronExpr, p.kind);
  };

  // 2. 切换主频率选项卡
  const handleSelectFrequency = (freq: ScheduleFrequency) => {
    updateVisual((prev) => {
      const next = { ...prev, frequency: freq };
      // 切换到工作日时默认周一至周五
      if (freq === 'workday') {
        next.weekdays = [1, 2, 3, 4, 5];
      }
      return next;
    });
  };

  // 3. 星期勾选切换
  const handleToggleWeekday = (dayId: number) => {
    updateVisual((prev) => {
      const current = prev.weekdays;
      let nextDays: number[];
      if (current.includes(dayId)) {
        nextDays = current.filter((d) => d !== dayId);
        // 至少保留一天
        if (nextDays.length === 0) nextDays = [dayId];
      } else {
        nextDays = [...current, dayId].sort((a, b) => a - b);
      }
      return { ...prev, weekdays: nextDays };
    });
  };

  const handleSetQuickWeekdays = (type: 'workdays' | 'weekend' | 'all') => {
    updateVisual((prev) => {
      let days = [1, 2, 3, 4, 5];
      if (type === 'weekend') days = [6, 0];
      else if (type === 'all') days = [1, 2, 3, 4, 5, 6, 0];
      return { ...prev, weekdays: days };
    });
  };

  // 4. 小时和分钟变动
  const handleChangeHour = (hour: number) => {
    updateVisual((prev) => ({ ...prev, hour }));
  };

  const handleChangeMinute = (minute: number) => {
    updateVisual((prev) => ({ ...prev, minute }));
  };

  const handleSetQuickTime = (h: number, m: number) => {
    updateVisual((prev) => ({ ...prev, hour: h, minute: m }));
  };

  // 5. 循环间隔配置
  const handleChangeIntervalUnit = (unit: 'm' | 'h') => {
    updateVisual((prev) => ({
      ...prev,
      intervalUnit: unit,
      intervalValue: unit === 'm' ? 15 : 1,
    }));
  };

  const handleChangeIntervalValue = (val: number) => {
    const safe = Math.max(1, Math.min(val, visualState.intervalUnit === 'm' ? 59 : 23));
    updateVisual((prev) => ({ ...prev, intervalValue: safe }));
  };

  // 6. 每月几号变更
  const handleChangeMonthDay = (day: number) => {
    updateVisual((prev) => ({ ...prev, monthDay: day }));
  };

  // 接下来 3 次运行预估
  const previewRuns = useMemo(() => {
    return previewNextRuns(value, 3);
  }, [value]);

  const humanZh = useMemo(() => {
    return formatCronZh(value);
  }, [value]);

  return (
    <div className="schedule-picker-root">
      {/* 1. 常用业务预设 (一键填入) */}
      <div className="schedule-section">
        <div className="schedule-section-header">
          <div className="schedule-section-title">常用业务预设 (一键选择)</div>
          <span className="schedule-section-sub">点击即选，下方频率与时间轮盘自动联动</span>
        </div>

        <div className="schedule-preset-grid">
          {SCHEDULE_PRESETS.map((p) => {
            const isSelected = activePresetId === p.id || value.trim() === p.cronExpr.trim();
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPreset(p)}
                className={`schedule-preset-card ${isSelected ? 'is-active' : ''}`}
              >
                <div className="schedule-preset-card-top">
                  <span className="schedule-preset-icon">{p.icon || '⏰'}</span>
                  <span className="schedule-preset-card-name">{p.label}</span>
                  {isSelected && <Check size={13} className="schedule-preset-check" />}
                </div>
                <div className="schedule-preset-card-desc">{p.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. 自定义调度周期频率 (列表/药丸选择) */}
      <div className="schedule-section">
        <div className="schedule-section-header">
          <div className="schedule-section-title">调度周期选择</div>
        </div>

        <div className="schedule-freq-pills">
          <button
            type="button"
            onClick={() => handleSelectFrequency('workday')}
            className={`schedule-freq-pill ${visualState.frequency === 'workday' ? 'is-active' : ''}`}
          >
            <Briefcase size={13} />
            <span>工作日 (周一至周五)</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectFrequency('daily')}
            className={`schedule-freq-pill ${visualState.frequency === 'daily' ? 'is-active' : ''}`}
          >
            <Sun size={13} />
            <span>每天</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectFrequency('weekly')}
            className={`schedule-freq-pill ${visualState.frequency === 'weekly' ? 'is-active' : ''}`}
          >
            <CalendarDays size={13} />
            <span>每周</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectFrequency('monthly')}
            className={`schedule-freq-pill ${visualState.frequency === 'monthly' ? 'is-active' : ''}`}
          >
            <Calendar size={13} />
            <span>每月</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectFrequency('interval')}
            className={`schedule-freq-pill ${visualState.frequency === 'interval' ? 'is-active' : ''}`}
          >
            <Timer size={13} />
            <span>循环间隔</span>
          </button>
        </div>
      </div>

      {/* 3. 频率详细选项配置面板 */}
      {/* 3.1 每周: 星期选择 */}
      {visualState.frequency === 'weekly' && (
        <div className="schedule-sub-panel">
          <div className="schedule-panel-row-header">
            <span className="schedule-panel-label">选择执行星期 (可多选)</span>
            <div className="schedule-quick-links">
              <button type="button" onClick={() => handleSetQuickWeekdays('workdays')}>
                工作日
              </button>
              <button type="button" onClick={() => handleSetQuickWeekdays('weekend')}>
                周末
              </button>
              <button type="button" onClick={() => handleSetQuickWeekdays('all')}>
                全选
              </button>
            </div>
          </div>
          <div className="schedule-weekdays-row">
            {WEEKDAYS.map((w) => {
              const checked = visualState.weekdays.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => handleToggleWeekday(w.id)}
                  className={`schedule-weekday-btn ${checked ? 'is-active' : ''}`}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3.2 每月: 几号选择 */}
      {visualState.frequency === 'monthly' && (
        <div className="schedule-sub-panel">
          <div className="schedule-panel-row-header">
            <span className="schedule-panel-label">选择执行日期</span>
            <div className="schedule-quick-links">
              <button type="button" onClick={() => handleChangeMonthDay(1)}>
                月初 (1号)
              </button>
              <button type="button" onClick={() => handleChangeMonthDay(15)}>
                月中 (15号)
              </button>
              <button type="button" onClick={() => handleChangeMonthDay(31)}>
                月末 (31号)
              </button>
            </div>
          </div>
          <div className="schedule-monthdays-scroll">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleChangeMonthDay(d)}
                className={`schedule-monthday-btn ${visualState.monthDay === d ? 'is-active' : ''}`}
              >
                {d}号
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3.3 循环间隔配置 */}
      {visualState.frequency === 'interval' && (
        <div className="schedule-sub-panel">
          <div className="schedule-panel-row-header">
            <span className="schedule-panel-label">间隔频率与数值</span>
            <div className="schedule-unit-toggle">
              <button
                type="button"
                onClick={() => handleChangeIntervalUnit('m')}
                className={`schedule-unit-btn ${visualState.intervalUnit === 'm' ? 'is-active' : ''}`}
              >
                按分钟
              </button>
              <button
                type="button"
                onClick={() => handleChangeIntervalUnit('h')}
                className={`schedule-unit-btn ${visualState.intervalUnit === 'h' ? 'is-active' : ''}`}
              >
                按小时
              </button>
            </div>
          </div>

          {/* 快捷推荐药丸 */}
          <div className="schedule-interval-chips">
            {visualState.intervalUnit === 'm'
              ? COMMON_MINUTE_INTERVALS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleChangeIntervalValue(m)}
                    className={`schedule-interval-chip ${visualState.intervalValue === m ? 'is-active' : ''}`}
                  >
                    每 {m} 分钟
                  </button>
                ))
              : COMMON_HOUR_INTERVALS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => handleChangeIntervalValue(h)}
                    className={`schedule-interval-chip ${visualState.intervalValue === h ? 'is-active' : ''}`}
                  >
                    每 {h} 小时 {h === 1 ? '(整点)' : ''}
                  </button>
                ))}
          </div>

          {/* 步进器微调 */}
          <div className="schedule-stepper-row">
            <span className="schedule-stepper-label">
              微调循环周期: 每隔
            </span>
            <div className="schedule-stepper-box">
              <button
                type="button"
                onClick={() => handleChangeIntervalValue(visualState.intervalValue - 1)}
                className="schedule-stepper-btn"
                title="减小间隔"
              >
                -
              </button>
              <span className="schedule-stepper-val">
                {visualState.intervalValue}
              </span>
              <button
                type="button"
                onClick={() => handleChangeIntervalValue(visualState.intervalValue + 1)}
                className="schedule-stepper-btn"
                title="增加间隔"
              >
                +
              </button>
            </div>
            <span className="schedule-stepper-unit">
              {visualState.intervalUnit === 'm' ? '分钟执行一次' : '小时执行一次'}
            </span>
          </div>
        </div>
      )}

      {/* 3.4 时间滚轮/轮盘选择器 (非间隔模式下展示) */}
      {visualState.frequency !== 'interval' && visualState.frequency !== 'custom' && (
        <div className="schedule-sub-panel">
          <div className="schedule-panel-row-header">
            <span className="schedule-panel-label">执行具体时刻 (滚轮选择)</span>
          </div>

          <div className="schedule-time-picker-card">
            {/* 滚轮主体 */}
            <div className="schedule-wheels-container">
              <WheelColumn
                label="时 (00-23)"
                value={visualState.hour}
                min={0}
                max={23}
                padZero
                onChange={handleChangeHour}
              />
              <div className="schedule-wheel-colon">:</div>
              <WheelColumn
                label="分 (00-59)"
                value={visualState.minute}
                min={0}
                max={59}
                padZero
                onChange={handleChangeMinute}
              />
            </div>

            {/* 快捷刻度选区 */}
            <div className="schedule-quick-time-pane">
              <div className="schedule-quick-time-group">
                <span className="schedule-quick-group-title">快捷刻度</span>
                <div className="schedule-quick-btns-row">
                  {QUICK_MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleChangeMinute(m)}
                      className={`schedule-quick-time-btn ${visualState.minute === m ? 'is-active' : ''}`}
                    >
                      {m === 0 ? '00分 (整点)' : m === 30 ? '30分 (半点)' : `${m}分`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="schedule-quick-time-group">
                <span className="schedule-quick-group-title">常用业务时刻</span>
                <div className="schedule-quick-btns-row">
                  {QUICK_HOURS.map((qh) => {
                    const isCur = visualState.hour === qh.h && visualState.minute === qh.m;
                    return (
                      <button
                        key={qh.label}
                        type="button"
                        onClick={() => handleSetQuickTime(qh.h, qh.m)}
                        className={`schedule-quick-time-btn ${isCur ? 'is-active' : ''}`}
                      >
                        {qh.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. 实时智能中文识别与接下来 3 次运行预估 */}
      <div className="schedule-feedback-card">
        <div className="schedule-feedback-top">
          <span className="schedule-feedback-tag">智能中文识别</span>
          <span className="schedule-feedback-expr-badge">
            Cron: <code>{value}</code>
          </span>
        </div>
        <div className="schedule-feedback-zh">
          📅 {humanZh}
        </div>

        {previewRuns.length > 0 && (
          <div className="schedule-preview-box">
            <div className="schedule-preview-title">接下来 3 次运行预估:</div>
            <div className="schedule-preview-list">
              {previewRuns.map((r, i) => (
                <div key={i} className="schedule-preview-item">
                  • {r}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 5. 高级专家模式 (Cron 表达式直接查看与编辑) */}
      <div className="schedule-advanced-fold">
        <button
          type="button"
          className="schedule-advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span>⚙️ 高级设置：Cron 表达式与专家模式</span>
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showAdvanced && (
          <div className="schedule-advanced-body">
            <div className="form-group">
              <label className="form-label">
                调度表达式 (标准 5 段式 Cron / @every 间隔 / @at 单次)
              </label>
              <input
                type="text"
                className="form-control font-mono"
                placeholder="如: 0 9 * * 1-5 或 */15 * * * * 或 @every 15m"
                value={value}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange(val);
                }}
              />
              <span className="schedule-advanced-hint">
                普通用户可直接使用上方轮盘与选项；高级运维人员可在此直接编辑原生 Cron 字符串。
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
