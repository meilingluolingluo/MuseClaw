/**
 * MuseClaw Routine Schedule Helper & Preset Utilities
 */

export interface SchedulePreset {
  id: string;
  label: string;
  description: string;
  cronExpr: string;
  kind: 'cron' | 'every' | 'at';
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: 'workday_morning',
    label: '工作日早晨',
    description: '周一至周五 09:00 巡检',
    cronExpr: '0 9 * * 1-5',
    kind: 'cron',
  },
  {
    id: 'workday_evening',
    label: '工作日下班',
    description: '周一至周五 18:00 汇总',
    cronExpr: '0 18 * * 1-5',
    kind: 'cron',
  },
  {
    id: 'daily_morning',
    label: '每天早晨',
    description: '每天 09:00 执行',
    cronExpr: '0 9 * * *',
    kind: 'cron',
  },
  {
    id: 'hourly',
    label: '每小时整点',
    description: '整点执行一次',
    cronExpr: '0 * * * *',
    kind: 'cron',
  },
  {
    id: 'every_15m',
    label: '每 15 分钟',
    description: '高频健康检查',
    cronExpr: '*/15 * * * *',
    kind: 'every',
  },
  {
    id: 'every_30m',
    label: '每 30 分钟',
    description: '半小时周期监控',
    cronExpr: '*/30 * * * *',
    kind: 'every',
  },
  {
    id: 'weekly_monday',
    label: '每周一早晨',
    description: '每周一 10:00 周会巡检',
    cronExpr: '0 10 * * 1',
    kind: 'cron',
  },
];

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

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

  if (trimmed === '@hourly') return '每小时整点执行 (00 分)';
  if (trimmed === '@daily') return '每天午夜 00:00 执行';
  if (trimmed === '@weekly') return '每周日午夜 00:00 执行';
  if (trimmed === '@monthly') return '每月 1 日 00:00 执行';

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return expr;

  const [minP, hourP, domP, monthP, dowP] = parts;

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

  if (minP.startsWith('*/') && hourP === '*' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return `每隔 ${minP.slice(2)} 分钟执行一次`;
  }
  if (minP === '0' && hourP === '*' && domP === '*' && monthP === '*' && (dowP === '*' || dowP === '?')) {
    return '每小时整点执行';
  }

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

  // 3. 经典 cron 步进模拟 (步进 60 秒检查)
  const candidate = new Date(now.getTime() + 60000);
  candidate.setSeconds(0, 0);

  const maxChecks = 24 * 60 * 14; // 最多探测 14 天
  let checked = 0;

  while (results.length < count && checked < maxChecks) {
    if (simpleCronMatch(trimmed, candidate)) {
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
    matchCronField(minP, d.getMinutes(), 0, 59) &&
    matchCronField(hourP, d.getHours(), 0, 23) &&
    matchCronField(domP, d.getDate(), 1, 31) &&
    matchCronField(monthP, d.getMonth() + 1, 1, 12) &&
    matchCronField(dowP, d.getDay(), 0, 6)
  );
}

function matchCronField(pattern: string, val: number, min: number, max: number): boolean {
  if (pattern === '*' || pattern === '?') return true;
  if (pattern.includes('/')) {
    const [rangePart, stepPart] = pattern.split('/');
    const step = parseInt(stepPart, 10);
    if (isNaN(step) || step <= 0) return false;
    let start = min;
    if (rangePart !== '*') start = parseInt(rangePart, 10);
    return val >= start && (val - start) % step === 0;
  }
  if (pattern.includes(',')) {
    return pattern.split(',').some((p) => matchCronField(p.trim(), val, min, max));
  }
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number);
    return val >= start && val <= end;
  }
  return parseInt(pattern, 10) === val;
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
