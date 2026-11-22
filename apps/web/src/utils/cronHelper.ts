/**
 * MuseClaw Routine Schedule Helper & Preset Utilities
 */

export interface SchedulePreset {
  id: string;
  label: string;
  description: string;
  cronExpr: string;
  kind: 'cron' | 'every' | 'at';
  icon?: string;
}

export type ScheduleFrequency = 'workday' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'custom';

export interface VisualScheduleState {
  frequency: ScheduleFrequency;
  hour: number;          // 0-23
  minute: number;        // 0-59
  weekdays: number[];    // 0-6 (0 is Sunday, 1 is Monday, ..., 6 is Saturday)
  monthDay: number;      // 1-31
  intervalUnit: 'm' | 'h';
  intervalValue: number; // e.g. 15, 30, 1, 2
  customCron: string;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: 'workday_morning',
    label: '工作日早晨',
    description: '周一至周五 09:00 巡检',
    cronExpr: '0 9 * * 1-5',
    kind: 'cron',
    icon: '💼',
  },
  {
    id: 'workday_evening',
    label: '工作日下班',
    description: '周一至周五 18:00 汇总',
    cronExpr: '0 18 * * 1-5',
    kind: 'cron',
    icon: '🏠',
  },
  {
    id: 'daily_morning',
    label: '每天早晨',
    description: '每天 09:00 执行',
    cronExpr: '0 9 * * *',
    kind: 'cron',
    icon: '☀️',
  },
  {
    id: 'hourly',
    label: '每小时整点',
    description: '整点执行一次',
    cronExpr: '0 * * * *',
    kind: 'cron',
    icon: '⏱️',
  },
  {
    id: 'every_15m',
    label: '每 15 分钟',
    description: '高频健康检查',
    cronExpr: '*/15 * * * *',
    kind: 'every',
    icon: '⚡',
  },
  {
    id: 'every_30m',
    label: '每 30 分钟',
    description: '半小时周期监控',
    cronExpr: '*/30 * * * *',
    kind: 'every',
    icon: '🔄',
  },
  {
    id: 'weekly_monday',
    label: '每周一早晨',
    description: '每周一 10:00 周会巡检',
    cronExpr: '0 10 * * 1',
    kind: 'cron',
    icon: '📅',
  },
];

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

export function parseCronToVisual(expr: string): VisualScheduleState {
  const defaultState: VisualScheduleState = {
    frequency: 'workday',
    hour: 9,
    minute: 0,
    weekdays: [1, 2, 3, 4, 5],
    monthDay: 1,
    intervalUnit: 'm',
    intervalValue: 15,
    customCron: expr || '0 9 * * 1-5',
  };

  if (!expr || !expr.trim()) return defaultState;
  const trimmed = expr.trim();

  // 1. @every
  if (trimmed.startsWith('@every ')) {
    const rawVal = trimmed.replace('@every ', '').trim();
    if (rawVal.endsWith('m')) {
      return {
        ...defaultState,
        frequency: 'interval',
        intervalUnit: 'm',
        intervalValue: Math.max(1, parseInt(rawVal, 10) || 15),
        customCron: trimmed,
      };
    }
    if (rawVal.endsWith('h')) {
      return {
        ...defaultState,
        frequency: 'interval',
        intervalUnit: 'h',
        intervalValue: Math.max(1, parseInt(rawVal, 10) || 1),
        customCron: trimmed,
      };
    }
  }

  // 2. @hourly, @daily, @weekly, @monthly
  if (trimmed === '@hourly') {
    return {
      ...defaultState,
      frequency: 'interval',
      intervalUnit: 'h',
      intervalValue: 1,
      customCron: trimmed,
    };
  }
  if (trimmed === '@daily') {
    return {
      ...defaultState,
      frequency: 'daily',
      hour: 0,
      minute: 0,
      customCron: trimmed,
    };
  }
  if (trimmed === '@weekly') {
    return {
      ...defaultState,
      frequency: 'weekly',
      hour: 0,
      minute: 0,
      weekdays: [0],
      customCron: trimmed,
    };
  }
  if (trimmed === '@monthly') {
    return {
      ...defaultState,
      frequency: 'monthly',
      hour: 0,
      minute: 0,
      monthDay: 1,
      customCron: trimmed,
    };
  }

  // 3. 5 段式标准 Cron
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return {
      ...defaultState,
      frequency: 'custom',
      customCron: trimmed,
    };
  }

  const [minP, hourP, domP, monthP, dowP] = parts;

  // 3.1 间隔: */N * * * *
  if (minP.startsWith('*/') && hourP === '*' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    const step = parseInt(minP.slice(2), 10);
    return {
      ...defaultState,
      frequency: 'interval',
      intervalUnit: 'm',
      intervalValue: isNaN(step) || step <= 0 ? 15 : step,
      customCron: trimmed,
    };
  }

  // 3.2 每小时整点: 0 * * * *
  if (minP === '0' && hourP === '*' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return {
      ...defaultState,
      frequency: 'interval',
      intervalUnit: 'h',
      intervalValue: 1,
      customCron: trimmed,
    };
  }

  // 3.3 每隔 N 小时: 0 */N * * *
  if (minP === '0' && hourP.startsWith('*/') && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    const step = parseInt(hourP.slice(2), 10);
    return {
      ...defaultState,
      frequency: 'interval',
      intervalUnit: 'h',
      intervalValue: isNaN(step) || step <= 0 ? 1 : step,
      customCron: trimmed,
    };
  }

  // 3.4 固定时间 M H (数字)
  if (/^\d+$/.test(minP) && /^\d+$/.test(hourP) && monthP === '*') {
    const minVal = parseInt(minP, 10);
    const hourVal = parseInt(hourP, 10);

    // 工作日: 1-5
    if (domP === '*' && dowP === '1-5') {
      return {
        ...defaultState,
        frequency: 'workday',
        hour: hourVal,
        minute: minVal,
        weekdays: [1, 2, 3, 4, 5],
        customCron: trimmed,
      };
    }

    // 每天: * 或 ?
    if (domP === '*' && (dowP === '*' || dowP === '?')) {
      return {
        ...defaultState,
        frequency: 'daily',
        hour: hourVal,
        minute: minVal,
        customCron: trimmed,
      };
    }

    // 每周: 指定星期 (如 1, 1,3,5 等)
    if (domP === '*' && dowP !== '*' && dowP !== '?') {
      const parsedDays = dowP
        .split(',')
        .map((p) => {
          const val = parseInt(p.trim(), 10);
          return val === 7 ? 0 : val;
        })
        .filter((v) => !isNaN(v) && v >= 0 && v <= 6);

      if (parsedDays.length > 0) {
        return {
          ...defaultState,
          frequency: 'weekly',
          hour: hourVal,
          minute: minVal,
          weekdays: parsedDays,
          customCron: trimmed,
        };
      }
    }

    // 每月: 指定日期
    if (/^\d+$/.test(domP) && (dowP === '*' || dowP === '?')) {
      const dayVal = parseInt(domP, 10);
      return {
        ...defaultState,
        frequency: 'monthly',
        hour: hourVal,
        minute: minVal,
        monthDay: dayVal >= 1 && dayVal <= 31 ? dayVal : 1,
        customCron: trimmed,
      };
    }
  }

  // 其他非标准格式退化为自定义模式
  return {
    ...defaultState,
    frequency: 'custom',
    customCron: trimmed,
  };
}

export function buildCronFromVisual(state: VisualScheduleState): string {
  if (state.frequency === 'workday') {
    return `${state.minute} ${state.hour} * * 1-5`;
  }

  if (state.frequency === 'daily') {
    return `${state.minute} ${state.hour} * * *`;
  }

  if (state.frequency === 'weekly') {
    const days = state.weekdays.length > 0 ? [...state.weekdays].sort((a, b) => a - b).join(',') : '*';
    return `${state.minute} ${state.hour} * * ${days}`;
  }

  if (state.frequency === 'monthly') {
    return `${state.minute} ${state.hour} ${state.monthDay || 1} * *`;
  }

  if (state.frequency === 'interval') {
    if (state.intervalUnit === 'm') {
      if ([1, 2, 3, 5, 10, 15, 20, 30].includes(state.intervalValue)) {
        return `*/${state.intervalValue} * * * *`;
      }
      return `@every ${state.intervalValue}m`;
    } else {
      if (state.intervalValue === 1) return `0 * * * *`;
      if ([2, 3, 4, 6, 8, 12].includes(state.intervalValue)) {
        return `0 */${state.intervalValue} * * *`;
      }
      return `@every ${state.intervalValue}h`;
    }
  }

  return state.customCron || '0 9 * * 1-5';
}

export function formatCronZh(expr: string): string {
  if (!expr || !expr.trim()) return '未设定调度周期';
  const trimmed = expr.trim();

  if (trimmed.startsWith('@every ')) {
    const rawVal = trimmed.replace('@every ', '').trim();
    if (rawVal.endsWith('m')) return `每隔 ${parseInt(rawVal, 10)} 分钟执行一次`;
    if (rawVal.endsWith('h')) return `每隔 ${parseInt(rawVal, 10)} 小时执行一次`;
    if (rawVal.endsWith('s')) return `每隔 ${parseInt(rawVal, 10)} 秒执行一次`;
    return `每隔 ${rawVal} 周期性执行`;
  }

  if (trimmed.startsWith('@at ')) {
    const atVal = trimmed.replace('@at ', '').trim();
    return `单次定时: ${atVal}`;
  }

  if (trimmed === '@hourly') return '每小时整点执行';
  if (trimmed === '@daily') return '每天午夜 00:00 执行';
  if (trimmed === '@weekly') return '每周日午夜 00:00 执行';
  if (trimmed === '@monthly') return '每月 1 日 00:00 执行';

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return expr;

  const [minP, hourP, domP, monthP, dowP] = parts;

  // 1. 每 N 分钟
  if (minP.startsWith('*/') && hourP === '*' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return `每隔 ${minP.slice(2)} 分钟执行一次`;
  }

  // 2. 每小时整点 / 每隔 N 小时
  if (minP === '0' && hourP === '*' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return '每小时整点执行';
  }
  if (minP === '0' && hourP.startsWith('*/') && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return `每隔 ${hourP.slice(2)} 小时整点执行`;
  }

  // 时间格式化
  let timeStr = '';
  if (/^\d+$/.test(hourP) && /^\d+$/.test(minP)) {
    const h = parseInt(hourP, 10);
    const m = parseInt(minP, 10);
    const timePrefix = h < 6 ? '凌晨' : h < 12 ? '上午' : h === 12 ? '中午' : h < 18 ? '下午' : '晚上';
    const hStr = h.toString().padStart(2, '0');
    const mStr = m.toString().padStart(2, '0');
    timeStr = `${timePrefix} ${hStr}:${mStr}`;
  } else {
    timeStr = `第 ${hourP} 时 ${minP} 分`;
  }

  // 星期格式化
  let dowStr = '';
  if (dowP !== '*' && dowP !== '?') {
    if (dowP === '1-5') {
      dowStr = '工作日 (周一至周五)';
    } else if (dowP === '0,6' || dowP === '6,0' || dowP === '6,7' || dowP === '7,6') {
      dowStr = '周末 (周六日)';
    } else if (/^[0-7]$/.test(dowP)) {
      const idx = parseInt(dowP, 10) % 7;
      dowStr = `每周${WEEKDAY_NAMES[idx]}`;
    } else if (dowP.includes(',')) {
      const days = dowP.split(',').map((p) => {
        const val = parseInt(p.trim(), 10) % 7;
        return isNaN(val) ? p : `周${WEEKDAY_NAMES[val]}`;
      });
      dowStr = `每${days.join('、')}`;
    } else {
      dowStr = `星期 (${dowP})`;
    }
  }

  // 日期格式化
  let domStr = '';
  if (domP !== '*' && domP !== '?') {
    domStr = `每月 ${domP} 号`;
  }

  // 月份
  let monthStr = '';
  if (monthP !== '*') {
    monthStr = `每年 ${monthP} 月`;
  }

  const dateParts = [monthStr, domStr, dowStr].filter(Boolean);
  const dateStr = dateParts.length > 0 ? dateParts.join(' ') : '每天';
  return `${dateStr} ${timeStr} 执行`;
}

export function previewNextRuns(expr: string, count = 3): string[] {
  if (!expr || !expr.trim()) return [];
  const trimmed = expr.trim();
  const results: string[] = [];
  const now = new Date();

  // 1. @every
  if (trimmed.startsWith('@every ')) {
    const rawVal = trimmed.replace('@every ', '').trim();
    let stepMs = 15 * 60 * 1000;
    if (rawVal.endsWith('m')) stepMs = parseInt(rawVal, 10) * 60 * 1000;
    else if (rawVal.endsWith('h')) stepMs = parseInt(rawVal, 10) * 3600 * 1000;
    else if (rawVal.endsWith('s')) stepMs = parseInt(rawVal, 10) * 1000;

    for (let i = 1; i <= count; i++) {
      const d = new Date(now.getTime() + i * stepMs);
      results.push(formatDateTime(d));
    }
    return results;
  }

  // 2. @at
  if (trimmed.startsWith('@at ')) {
    const atVal = trimmed.replace('@at ', '').trim();
    const d = new Date(atVal);
    if (!isNaN(d.getTime())) {
      results.push(formatDateTime(d));
    }
    return results;
  }

  // 3. 别名转为标准 5 段式
  let cronTarget = trimmed;
  if (trimmed === '@hourly') cronTarget = '0 * * * *';
  else if (trimmed === '@daily') cronTarget = '0 0 * * *';
  else if (trimmed === '@weekly') cronTarget = '0 0 * * 0';
  else if (trimmed === '@monthly') cronTarget = '0 0 1 * *';

  // 4. 经典 cron 步进模拟 (步进 60 秒检查)
  const candidate = new Date(now.getTime() + 60000);
  candidate.setSeconds(0, 0);

  const maxChecks = 24 * 60 * 14; // 最多探测 14 天
  let checked = 0;

  while (results.length < count && checked < maxChecks) {
    if (simpleCronMatch(cronTarget, candidate)) {
      results.push(formatDateTime(new Date(candidate)));
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
    checked++;
  }

  return results;
}

function simpleCronMatch(expr: string, d: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minP, hourP, domP, monthP, dowP] = parts;

  return (
    matchCronField(minP, d.getMinutes(), 0) &&
    matchCronField(hourP, d.getHours(), 0) &&
    matchCronField(domP, d.getDate(), 1) &&
    matchCronField(monthP, d.getMonth() + 1, 1) &&
    matchCronField(dowP, d.getDay(), 0)
  );
}

function matchCronField(pattern: string, val: number, min: number): boolean {
  if (pattern === '*' || pattern === '?') return true;
  if (pattern.includes(',')) {
    return pattern.split(',').some((p) => matchCronField(p.trim(), val, min));
  }
  if (pattern.includes('/')) {
    const [rangePart, stepPart] = pattern.split('/');
    const step = parseInt(stepPart, 10);
    if (isNaN(step) || step <= 0) return false;
    let start = min;
    if (rangePart !== '*') start = parseInt(rangePart, 10);
    return val >= start && (val - start) % step === 0;
  }
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number);
    return val >= start && val <= end;
  }
  const parsed = parseInt(pattern, 10);
  if (parsed === 7 && val === 0) return true;
  return parsed === val;
}

function formatDateTime(d: Date): string {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hour = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  const dow = WEEKDAY_NAMES[d.getDay()];
  return `${year}-${month}-${day} (周${dow}) ${hour}:${min}`;
}
