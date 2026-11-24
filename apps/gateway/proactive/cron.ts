/**
 * 轻量级标准 5 段式与间隔式 Cron 调度解析与中文转译器
 * 支持格式:
 * - 标准 5 段式 Cron: [分] [时] [日] [月] [周] (如 "0 9 * * 1-5")
 * - 周期性间隔: "@every 15m", "@every 1h", "@every 2h"
 * - 常用快捷别名: "@hourly", "@daily", "@weekly", "@monthly"
 * - 单次指定时间: "@at 2026-11-22T10:00:00Z"
 */

import type { ScheduleKind } from './types.ts';

export function detectScheduleKind(expr: string): ScheduleKind {
  const trimmed = (expr || '').trim();
  if (trimmed.startsWith('@every ')) return 'every';
  if (trimmed.startsWith('@at ')) return 'at';
  return 'cron';
}

interface ZonedDateParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

const WEEKDAY_SHORT_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat | null {
  if (dtfCache.has(timezone)) return dtfCache.get(timezone)!;
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
    dtfCache.set(timezone, fmt);
    return fmt;
  } catch {
    return null;
  }
}

export function getZonedDateParts(date: Date, timezone?: string): ZonedDateParts {
  if (timezone) {
    const fmt = getFormatter(timezone);
    if (fmt) {
      const parts = fmt.formatToParts(date);
      let minute = 0;
      let hour = 0;
      let dayOfMonth = 1;
      let month = 1;
      let dayOfWeek = date.getDay();
      for (const p of parts) {
        if (p.type === 'minute') minute = parseInt(p.value, 10);
        else if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
        else if (p.type === 'day') dayOfMonth = parseInt(p.value, 10);
        else if (p.type === 'month') month = parseInt(p.value, 10);
        else if (p.type === 'weekday' && p.value in WEEKDAY_SHORT_MAP) {
          dayOfWeek = WEEKDAY_SHORT_MAP[p.value];
        }
      }
      return { minute, hour, dayOfMonth, month, dayOfWeek };
    }
  }
  return {
    minute: date.getMinutes(),
    hour: date.getHours(),
    dayOfMonth: date.getDate(),
    month: date.getMonth() + 1,
    dayOfWeek: date.getDay(),
  };
}

function matchField(pattern: string, val: number, min: number, max: number, isWeekday = false): boolean {
  if (pattern === '*' || pattern === '?') return true;
  const normalize = (n: number) => (isWeekday && n === 7 ? 0 : n);

  // 1. 处理步长 */5 或 10-30/5
  if (pattern.includes('/')) {
    const [rangePart, stepPart] = pattern.split('/');
    const step = parseInt(stepPart, 10);
    if (isNaN(step) || step <= 0) return false;

    let start = min;
    let end = max;
    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [rStart, rEnd] = rangePart.split('-').map(Number);
        start = rStart;
        end = rEnd;
      } else {
        start = parseInt(rangePart, 10);
      }
    }
    if (val < start || val > end) return false;
    return (val - start) % step === 0;
  }

  // 2. 处理列表 1,3,5
  if (pattern.includes(',')) {
    return pattern.split(',').some((p) => matchField(p.trim(), val, min, max, isWeekday));
  }

  // 3. 处理范围 1-5
  if (pattern.includes('-')) {
    const [rawStart, rawEnd] = pattern.split('-').map(Number);
    const start = normalize(rawStart);
    const end = normalize(rawEnd);
    if (start <= end) {
      return val >= start && val <= end;
    }
    return val >= start || val <= end;
  }

  // 4. 精确数字匹配
  const parsed = parseInt(pattern, 10);
  if (isNaN(parsed)) return false;
  return normalize(parsed) === val;
}

/**
 * 判断指定时间是否命中调度表达式
 */
export function matchesCron(expr: string, date = new Date(), timezone?: string): boolean {
  const trimmed = expr.trim();
  const zoned = getZonedDateParts(date, timezone);

  // 快捷别名支持
  if (trimmed === '@hourly') return zoned.minute === 0;
  if (trimmed === '@daily') return zoned.hour === 0 && zoned.minute === 0;
  if (trimmed === '@weekly') return zoned.dayOfWeek === 0 && zoned.hour === 0 && zoned.minute === 0;
  if (trimmed === '@monthly') return zoned.dayOfMonth === 1 && zoned.hour === 0 && zoned.minute === 0;

  if (trimmed.startsWith('@at ')) {
    const timeStr = trimmed.replace('@at ', '').trim();
    const target = new Date(timeStr).getTime();
    return Math.abs(date.getTime() - target) < 60 * 1000;
  }

  if (trimmed.startsWith('@every ')) {
    return true;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return false;

  const [minP, hourP, domP, monthP, dowP] = parts;

  if (!matchField(minP, zoned.minute, 0, 59)) return false;
  if (!matchField(hourP, zoned.hour, 0, 23)) return false;
  if (!matchField(domP, zoned.dayOfMonth, 1, 31)) return false;
  if (!matchField(monthP, zoned.month, 1, 12)) return false;
  if (!matchField(dowP, zoned.dayOfWeek, 0, 6, true)) return false;

  return true;
}

/**
 * 计算调度表达式在指定基准时间之后的下一次执行时间戳
 */
export function computeNextRun(
  expr: string,
  fromDate: Date | number = new Date(),
  timezone?: string,
  jitterSeconds = 0
): number {
  const baseDate = fromDate instanceof Date ? fromDate : new Date(fromDate || Date.now());
  const trimmed = expr.trim();

  // 1. 支持 @at 单次执行
  if (trimmed.startsWith('@at ')) {
    const timeStr = trimmed.replace('@at ', '').trim();
    const ts = new Date(timeStr).getTime();
    return isNaN(ts) ? baseDate.getTime() + 3600 * 1000 : ts;
  }

  // 2. 支持 @every 5m / 1h / 1d 形式
  if (trimmed.startsWith('@every ')) {
    const durationStr = trimmed.replace('@every ', '').trim();
    let ms = 60 * 1000;
    if (durationStr.endsWith('m')) {
      ms = parseInt(durationStr, 10) * 60 * 1000;
    } else if (durationStr.endsWith('h')) {
      ms = parseInt(durationStr, 10) * 3600 * 1000;
    } else if (durationStr.endsWith('d')) {
      ms = parseInt(durationStr, 10) * 86400 * 1000;
    } else if (durationStr.endsWith('s')) {
      ms = parseInt(durationStr, 10) * 1000;
    }
    return baseDate.getTime() + (isNaN(ms) || ms <= 0 ? 60 * 1000 : ms);
  }

  const applyJitter = (ts: number) => {
    if (jitterSeconds > 0) {
      const cap = Math.min(60, Math.max(0, jitterSeconds));
      return ts + Math.floor(Math.random() * cap * 1000);
    }
    return ts;
  };

  if (trimmed === '@hourly') {
    const cursor = new Date(baseDate.getTime());
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);
    for (let i = 0; i < 65; i++) {
      if (getZonedDateParts(cursor, timezone).minute === 0) return applyJitter(cursor.getTime());
      cursor.setMinutes(cursor.getMinutes() + 1);
    }
  }

  // 3. 5 段式标准 Cron / @daily / @weekly / @monthly：支持最长 366 天快速跳步扫描
  const normalizedExpr =
    trimmed === '@daily'
      ? '0 0 * * *'
      : trimmed === '@weekly'
      ? '0 0 * * 0'
      : trimmed === '@monthly'
      ? '0 0 1 * *'
      : trimmed;

  const parts = normalizedExpr.split(/\s+/);
  if (parts.length !== 5) {
    return baseDate.getTime() + 3600 * 1000;
  }

  const [minP, hourP, domP, monthP, dowP] = parts;
  const cursor = new Date(baseDate.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const endLimit = baseDate.getTime() + 366 * 24 * 60 * 60 * 1000;
  let guard = 0;
  const MAX_ITERATIONS = 30000;

  while (cursor.getTime() <= endLimit && guard < MAX_ITERATIONS) {
    guard++;
    const z = getZonedDateParts(cursor, timezone);

    // 按月/日/周快速跳步：不匹配时直接跳到下一小时或下一天，避免逐分钟空转
    if (!matchField(monthP, z.month, 1, 12) || !matchField(domP, z.dayOfMonth, 1, 31) || !matchField(dowP, z.dayOfWeek, 0, 6, true)) {
      const minsLeftInDay = (23 - z.hour) * 60 + (60 - z.minute);
      cursor.setMinutes(cursor.getMinutes() + Math.max(1, minsLeftInDay));
      continue;
    }

    if (!matchField(hourP, z.hour, 0, 23)) {
      const minsLeftInHour = 60 - z.minute;
      cursor.setMinutes(cursor.getMinutes() + Math.max(1, minsLeftInHour));
      continue;
    }

    if (!matchField(minP, z.minute, 0, 59)) {
      cursor.setMinutes(cursor.getMinutes() + 1);
      continue;
    }

    return applyJitter(cursor.getTime());
  }

  return baseDate.getTime() + 3600 * 1000;
}

/**
 * 计算未来接下来的 N 次执行时间戳预览
 */
export function computeNextRuns(
  expr: string,
  arg2?: number | Date,
  arg3?: number | Date,
  timezone?: string
): number[] {
  let count = 3;
  let fromDate = new Date();

  if (typeof arg2 === 'number') {
    count = arg2;
    if (arg3 instanceof Date) fromDate = arg3;
    else if (typeof arg3 === 'number') fromDate = new Date(arg3);
  } else if (arg2 instanceof Date) {
    fromDate = arg2;
    if (typeof arg3 === 'number') count = arg3;
  } else if (typeof arg2 === 'string') {
    fromDate = new Date(arg2);
    if (typeof arg3 === 'number') count = arg3;
  }

  const results: number[] = [];
  let cursor = fromDate;
  for (let i = 0; i < count; i++) {
    const next = computeNextRun(expr, cursor, timezone, 0);
    results.push(next);
    cursor = new Date(next + 1000);
  }
  return results;
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 将 Cron 表达式或调度字符串转译为通俗易懂的中文说明
 */
export function cronToHumanZh(expr: string): string {
  const trimmed = expr?.trim() || '';
  if (!trimmed) return '未配置调度';

  if (trimmed.startsWith('@every ')) {
    const dur = trimmed.replace('@every ', '').trim();
    if (dur.endsWith('m')) return `每隔 ${parseInt(dur, 10)} 分钟执行`;
    if (dur.endsWith('h')) return `每隔 ${parseInt(dur, 10)} 小时执行`;
    if (dur.endsWith('d')) return `每隔 ${parseInt(dur, 10)} 天执行`;
    if (dur.endsWith('s')) return `每隔 ${parseInt(dur, 10)} 秒执行`;
    return `每隔 ${dur} 执行一次`;
  }

  if (trimmed.startsWith('@at ')) {
    const atVal = trimmed.replace('@at ', '').trim();
    return `单次定时: ${atVal}`;
  }

  if (trimmed === '@hourly') return '每小时整点执行 (00 分)';
  if (trimmed === '@daily') return '每天午夜 00:00 执行';
  if (trimmed === '@weekly') return '每周日午夜 00:00 执行';
  if (trimmed === '@monthly') return '每月 1 日 00:00 执行';

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return expr;

  const [minP, hourP, domP, monthP, dowP] = parts;

  // 1. 经典快捷模式匹配
  if (minP === '0' && hourP === '9' && domP === '*' && monthP === '*' && dowP === '1-5') {
    return '工作日 (周一至周五) 上午 09:00';
  }
  if (minP === '0' && hourP === '18' && domP === '*' && monthP === '*' && dowP === '1-5') {
    return '工作日 (周一至周五) 傍晚 18:00';
  }
  if (minP === '30' && hourP === '9' && domP === '*' && monthP === '*' && dowP === '1-5') {
    return '工作日 (周一至周五) 上午 09:30';
  }
  if (minP === '0' && hourP === '9' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return '每天上午 09:00';
  }
  if (minP === '0' && hourP === '18' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return '每天傍晚 18:00';
  }
  if (minP === '0' && hourP === '10' && domP === '*' && monthP === '*' && dowP === '1') {
    return '每周一上午 10:00';
  }
  if (minP === '0' && hourP === '18' && domP === '*' && monthP === '*' && dowP === '5') {
    return '每周五傍晚 18:00';
  }

  // 2. 纯分钟步长
  if (minP.startsWith('*/') && hourP === '*' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return `每隔 ${minP.slice(2)} 分钟执行一次`;
  }
  if (minP === '0' && hourP === '*' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return '每小时整点执行';
  }

  // 3. 通用解析
  let dowStr = '';
  if (dowP !== '*' && dowP !== '?') {
    if (dowP === '1-5') dowStr = '工作日 (周一至周五)';
    else if (dowP === '0,6' || dowP === '6,0') dowStr = '周末 (周六日)';
    else if (/^[0-6]$/.test(dowP)) dowStr = `每周${WEEKDAY_NAMES[parseInt(dowP, 10)]}`;
    else dowStr = `星期 (${dowP})`;
  }

  let domStr = '';
  if (domP !== '*' && domP !== '?') {
    domStr = `每月 ${domP} 号`;
  }

  let monthStr = '';
  if (monthP !== '*') {
    monthStr = `每年 ${monthP} 月`;
  }

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

  const dateParts = [monthStr, domStr, dowStr].filter(Boolean);
  const dateStr = dateParts.length > 0 ? dateParts.join(' ') : '每天';
  return `${dateStr} ${timeStr} 执行`;
}
