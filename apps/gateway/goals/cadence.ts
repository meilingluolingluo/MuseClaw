import { computeNextRun } from '../proactive/cron.ts';

const WEEKDAY_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};

/**
 * 将周期提醒配置解析并转换为标准 5 段式 Cron 表达式
 * 支持:
 * - "daily 09:00" -> "0 9 * * *"
 * - "weekdays 09:30" -> "30 9 * * 1-5"
 * - "weekly mon 10:00" -> "0 10 * * 1"
 * - "monthly 1 09:00" -> "0 9 1 * *"
 * - 标准 5 段式 cron 表达式与 @every 声明
 */
export function cadenceToCron(cadence: string): string {
  const trimmed = (cadence || '').trim().toLowerCase();
  if (!trimmed || trimmed === 'none') {
    return '';
  }

  if (trimmed.split(/\s+/).length === 5 || trimmed.startsWith('@')) {
    return trimmed;
  }

  const dailyMatch = trimmed.match(/^daily(?:\s+([01]?\d|2[0-3]):([0-5]\d))?$/);
  if (dailyMatch) {
    const h = dailyMatch[1] ? parseInt(dailyMatch[1], 10) : 9;
    const m = dailyMatch[2] ? parseInt(dailyMatch[2], 10) : 0;
    return `${m} ${h} * * *`;
  }

  const weekdaysMatch = trimmed.match(/^weekdays(?:\s+([01]?\d|2[0-3]):([0-5]\d))?$/);
  if (weekdaysMatch) {
    const h = weekdaysMatch[1] ? parseInt(weekdaysMatch[1], 10) : 9;
    const m = weekdaysMatch[2] ? parseInt(weekdaysMatch[2], 10) : 30;
    return `${m} ${h} * * 1-5`;
  }

  const weeklyMatch = trimmed.match(
    /^weekly(?:\s+(mon|tue|wed|thu|fri|sat|sun))?(?:\s+([01]?\d|2[0-3]):([0-5]\d))?$/
  );
  if (weeklyMatch) {
    const day = weeklyMatch[1] || 'mon';
    const h = weeklyMatch[2] ? parseInt(weeklyMatch[2], 10) : 10;
    const m = weeklyMatch[3] ? parseInt(weeklyMatch[3], 10) : 0;
    const dow = WEEKDAY_MAP[day] ?? 1;
    return `${m} ${h} * * ${dow}`;
  }

  const monthlyMatch = trimmed.match(
    /^monthly(?:\s+([1-9]|[12]\d|3[01]))?(?:\s+([01]?\d|2[0-3]):([0-5]\d))?$/
  );
  if (monthlyMatch) {
    const day = monthlyMatch[1] ? parseInt(monthlyMatch[1], 10) : 1;
    const h = monthlyMatch[2] ? parseInt(monthlyMatch[2], 10) : 9;
    const m = monthlyMatch[3] ? parseInt(monthlyMatch[3], 10) : 0;
    return `${m} ${h} ${day} * *`;
  }

  // 默认 fallback 工作日 9:30
  return '30 9 * * 1-5';
}

/**
 * 计算下次巡检 Check-in 时间戳 (毫秒)
 */
export function computeNextCheckIn(cadence: string, fromDate = new Date()): number {
  const cron = cadenceToCron(cadence);
  if (!cron) return 0;
  return computeNextRun(cron, fromDate);
}
