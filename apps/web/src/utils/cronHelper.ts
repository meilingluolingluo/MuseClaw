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

function getZonedCronParts(d: Date, timezone?: string) {
  if (timezone) {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
      });
      const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      let minute = 0;
      let hour = 0;
      let day = 1;
      let month = 1;
      let dow = d.getDay();
      for (const p of fmt.formatToParts(d)) {
        if (p.type === 'minute') minute = parseInt(p.value, 10);
        else if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
        else if (p.type === 'day') day = parseInt(p.value, 10);
        else if (p.type === 'month') month = parseInt(p.value, 10);
        else if (p.type === 'weekday' && p.value in wkMap) dow = wkMap[p.value];
      }
      return { minute, hour, day, month, dow };
    } catch {
      // fallback to local time
    }
  }
  return {
    minute: d.getMinutes(),
    hour: d.getHours(),
    day: d.getDate(),
    month: d.getMonth() + 1,
    dow: d.getDay(),
  };
}

export function previewNextRuns(expr: string, count = 3, timezone?: string): string[] {
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
      results.push(formatDateTime(d, timezone));
    }
    return results;
  }

  // 2. @at
  if (trimmed.startsWith('@at ')) {
    const atVal = trimmed.replace('@at ', '').trim();
    const d = new Date(atVal);
    if (!isNaN(d.getTime())) {
      results.push(formatDateTime(d, timezone));
    }
    return results;
  }

  // 3. 别名转为标准 5 段式
  let cronTarget = trimmed;
  if (trimmed === '@hourly') cronTarget = '0 * * * *';
  else if (trimmed === '@daily') cronTarget = '0 0 * * *';
  else if (trimmed === '@weekly') cronTarget = '0 0 * * 0';
  else if (trimmed === '@monthly') cronTarget = '0 0 1 * *';

  // 4. 经典 cron 步进模拟 (支持 366 天月级调度快速跳步)
  const parts = cronTarget.split(/\s+/);
  if (parts.length !== 5) return results;
  const [minP, hourP, domP, monthP, dowP] = parts;

  const candidate = new Date(now.getTime() + 60000);
  candidate.setSeconds(0, 0);

  const endLimit = now.getTime() + 366 * 24 * 60 * 60 * 1000;
  let checked = 0;

  while (results.length < count && candidate.getTime() <= endLimit && checked < 35000) {
    checked++;
    const z = getZonedCronParts(candidate, timezone);
    if (
      !matchCronField(monthP, z.month, 1) ||
      !matchCronField(domP, z.day, 1) ||
      !matchCronField(dowP, z.dow, 0)
    ) {
      const minsLeft = (23 - z.hour) * 60 + (60 - z.minute);
      candidate.setMinutes(candidate.getMinutes() + Math.max(1, minsLeft));
      continue;
    }
    if (!matchCronField(hourP, z.hour, 0)) {
      candidate.setMinutes(candidate.getMinutes() + Math.max(1, 60 - z.minute));
      continue;
    }
    if (!matchCronField(minP, z.minute, 0)) {
      candidate.setMinutes(candidate.getMinutes() + 1);
      continue;
    }
    results.push(formatDateTime(new Date(candidate), timezone));
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return results;
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

function formatDateTime(d: Date, timezone?: string): string {
  if (timezone) {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
      });
      const wkMap: Record<string, string> = {
        Sun: '日',
        Mon: '一',
        Tue: '二',
        Wed: '三',
        Thu: '四',
        Fri: '五',
        Sat: '六',
      };
      let year = '';
      let month = '';
      let day = '';
      let hour = '';
      let min = '';
      let dow = '';
      for (const p of fmt.formatToParts(d)) {
        if (p.type === 'year') year = p.value;
        else if (p.type === 'month') month = p.value;
        else if (p.type === 'day') day = p.value;
        else if (p.type === 'hour') hour = String(parseInt(p.value, 10) % 24).padStart(2, '0');
        else if (p.type === 'minute') min = p.value;
        else if (p.type === 'weekday') dow = wkMap[p.value] || '';
      }
      if (year && month && day) {
        return `${year}-${month}-${day} (周${dow}) ${hour}:${min}`;
      }
    } catch {
      // fallback below
    }
  }
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hour = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  const dow = WEEKDAY_NAMES[d.getDay()];
  return `${year}-${month}-${day} (周${dow}) ${hour}:${min}`;
}

const CN_NUM_MAP: Record<string, number> = {
  '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

function parseCnOrArabicNum(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  if (s.startsWith('十') && s.length === 2) {
    const u = CN_NUM_MAP[s[1]];
    return u !== undefined ? 10 + u : null;
  }
  if (s.endsWith('十') && s.length === 2) {
    const tens = CN_NUM_MAP[s[0]];
    return tens !== undefined ? tens * 10 : null;
  }
  if (s.length === 3 && s[1] === '十') {
    const tens = CN_NUM_MAP[s[0]];
    const unit = CN_NUM_MAP[s[2]];
    if (tens !== undefined && unit !== undefined) return tens * 10 + unit;
  }
  return CN_NUM_MAP[s] ?? null;
}

export function parseNaturalLanguageToCron(rawInput: string): {
  cron: string;
  kind: 'cron' | 'every' | 'at';
  description: string;
} | null {
  if (!rawInput || !rawInput.trim()) return null;
  const input = rawInput.trim();

  // 1. 若直接是标准 Cron 或 @every / @at 格式
  if (input.startsWith('@every ') || input.startsWith('@at ') || ['@hourly', '@daily', '@weekly', '@monthly'].includes(input)) {
    const kind = input.startsWith('@every ') ? 'every' : input.startsWith('@at ') ? 'at' : 'cron';
    return { cron: input, kind, description: formatCronZh(input) };
  }
  const parts = input.split(/\s+/);
  if (parts.length === 5 && !parts.some((p) => /[\u4e00-\u9fa5]/.test(p))) {
    return { cron: input, kind: 'cron', description: formatCronZh(input) };
  }

  // 2. 匹配预设别名
  const matchedPreset = SCHEDULE_PRESETS.find((p) =>
    input === p.label || input.startsWith(p.label) || input === p.description
  );
  if (matchedPreset) {
    return {
      cron: matchedPreset.cronExpr,
      kind: matchedPreset.kind,
      description: formatCronZh(matchedPreset.cronExpr),
    };
  }

  // 3. 间隔循环识别
  if (/(?:每|每隔)\s*半小时/i.test(input)) {
    return { cron: '*/30 * * * *', kind: 'every', description: '每隔 30 分钟执行一次' };
  }

  const minuteIntervalMatch = /(?:每|每隔)\s*(\d+|[一二两三四五六七八九十]+)\s*(?:分钟|分|mins?|m\b)/i.exec(input);
  if (minuteIntervalMatch) {
    const num = parseCnOrArabicNum(minuteIntervalMatch[1]);
    if (num && num > 0) {
      if ([1, 2, 3, 5, 10, 15, 20, 30].includes(num)) {
        return { cron: `*/${num} * * * *`, kind: 'every', description: `每隔 ${num} 分钟执行一次` };
      }
      return { cron: `@every ${num}m`, kind: 'every', description: `每隔 ${num} 分钟执行一次` };
    }
  }

  if (/(?:每小时整点|每小时执行|每隔1小时|每1小时|每小时\b)/i.test(input)) {
    return { cron: '0 * * * *', kind: 'cron', description: '每小时整点执行' };
  }

  const hourIntervalMatch = /(?:每|每隔)\s*(\d+|[一二两三四五六七八九十]+)\s*(?:小时|个半小时|小时整|hours?|h\b)/i.exec(input);
  if (hourIntervalMatch) {
    const num = parseCnOrArabicNum(hourIntervalMatch[1]);
    if (num && num > 0) {
      if ([2, 3, 4, 6, 8, 12].includes(num)) {
        return { cron: `0 */${num} * * *`, kind: 'cron', description: `每隔 ${num} 小时整点执行` };
      }
      return { cron: `@every ${num}h`, kind: 'every', description: `每隔 ${num} 小时周期执行` };
    }
  }

  // 4. 定时时刻提取 (时、分)
  let extractedHour: number | null = null;
  let extractedMinute: number | null = null;

  const colonTimeMatch = /(\d{1,2})[:：](\d{1,2})/.exec(input);
  if (colonTimeMatch) {
    extractedHour = parseInt(colonTimeMatch[1], 10);
    extractedMinute = parseInt(colonTimeMatch[2], 10);
  } else {
    const pointHalfMatch = /(\d{1,2}|[一二两三四五六七八九十]+)\s*点\s*半/.exec(input);
    if (pointHalfMatch) {
      extractedHour = parseCnOrArabicNum(pointHalfMatch[1]);
      extractedMinute = 30;
    } else {
      const pointMinuteMatch = /(\d{1,2}|[一二两三四五六七八九十]+)\s*点\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*分?/.exec(input);
      if (pointMinuteMatch) {
        extractedHour = parseCnOrArabicNum(pointMinuteMatch[1]);
        extractedMinute = parseCnOrArabicNum(pointMinuteMatch[2]);
      } else {
        const pointOnlyMatch = /(\d{1,2}|[一二两三四五六七八九十]+)\s*点/.exec(input);
        if (pointOnlyMatch) {
          extractedHour = parseCnOrArabicNum(pointOnlyMatch[1]);
          extractedMinute = 0;
        }
      }
    }
  }

  // 下午/傍晚/晚上修正
  const isPm = /(?:下午|傍晚|晚上|夜间|下班)/.test(input);
  if (isPm && extractedHour !== null && extractedHour < 12 && extractedHour > 0) {
    extractedHour += 12;
  }

  // 默认常用时间推测
  if (extractedHour === null) {
    if (/(?:下班|傍晚|晚间)/.test(input)) {
      extractedHour = 18;
      extractedMinute = 0;
    } else if (/(?:早晨|早上|上午|晨会)/.test(input)) {
      extractedHour = 9;
      extractedMinute = 0;
    } else if (/(?:中午|午间)/.test(input)) {
      extractedHour = 12;
      extractedMinute = 0;
    } else if (/(?:午夜|半夜|零点)/.test(input)) {
      extractedHour = 0;
      extractedMinute = 0;
    } else {
      extractedHour = 9;
      extractedMinute = 0;
    }
  }
  if (extractedMinute === null) {
    extractedMinute = 0;
  }

  extractedHour = Math.max(0, Math.min(23, extractedHour));
  extractedMinute = Math.max(0, Math.min(59, extractedMinute));

  // 5. 日期与周期抽取
  let dowPart = '*';
  let domPart = '*';

  if (/(?:工作日|周一至周五|周一到周五|礼拜一至礼拜五)/.test(input)) {
    dowPart = '1-5';
  } else if (/(?:周末|双休日)/.test(input)) {
    dowPart = '0,6';
  } else if (/(?:每周|每星期|周|星期|礼拜)/.test(input)) {
    const dayMap: Record<string, number> = {
      '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0, '七': 0,
      '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '0': 0, '7': 0,
    };
    const matchedDays = new Set<number>();
    const re = /(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      const d = dayMap[m[1]];
      if (d !== undefined) matchedDays.add(d);
    }
    if (matchedDays.size > 0) {
      dowPart = Array.from(matchedDays).sort((a, b) => a - b).join(',');
    }
  }

  const monthDayMatch = /(?:每月|每个月)\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*(?:号|日)/.exec(input);
  if (monthDayMatch) {
    const d = parseCnOrArabicNum(monthDayMatch[1]);
    if (d && d >= 1 && d <= 31) {
      domPart = d.toString();
    }
  } else if (/(?:月初|每月1号|每月1日)/.test(input)) {
    domPart = '1';
  } else if (/(?:月中|每月15号|每月15日)/.test(input)) {
    domPart = '15';
  } else if (/(?:月末|最后一天|每月31号)/.test(input)) {
    domPart = '31';
  }

  const cron = `${extractedMinute} ${extractedHour} ${domPart} * ${dowPart}`;
  return {
    cron,
    kind: 'cron',
    description: formatCronZh(cron),
  };
}

export function parseNaturalLanguageRoutine(text: string): {
  name: string;
  instructions: string;
  cronExpr: string;
  scheduleKind: 'cron' | 'every' | 'at';
  humanZh: string;
} {
  const parsedCron = parseNaturalLanguageToCron(text) || {
    cron: '0 9 * * 1-5',
    kind: 'cron' as const,
    description: '工作日 (周一至周五) 上午 09:00',
  };

  // 提炼标题
  let cleanName = text
    .replace(/(?:每个?工作日|每天|每周[一二三四五六日天1-7、,]*|每月\d*号?|每隔\d*分钟|每半小时|每小时整点|早晨|早上|上午|中午|下午|傍晚|晚上|夜间|\d{1,2}[:：]\d{1,2}|\d{1,2}点半?)/g, '')
    .trim();

  if (!cleanName || cleanName.length < 2) {
    cleanName = '例行自动化巡检任务';
  }
  if (cleanName.length > 28) {
    cleanName = cleanName.slice(0, 26) + '...';
  }

  return {
    name: cleanName,
    instructions: text,
    cronExpr: parsedCron.cron,
    scheduleKind: parsedCron.kind,
    humanZh: parsedCron.description,
  };
}
