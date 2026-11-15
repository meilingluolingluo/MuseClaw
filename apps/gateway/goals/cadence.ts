import { computeNextRun } from '../proactive/cron.ts';

/**
 * 将自然语言巡检周期转换为标准 5 段式 Cron 表达式
 * 对标 nanoMuse: parse_check_in / next_check_in
 *
 * 支持:
 * - "daily 09:00" -> "0 9 * * *"
 * - "weekdays 09:30" -> "30 9 * * 1-5"
 * - "weekly mon 10:00" -> "0 10 * * 1"
 * - 标准 5 段 cron 表达式如 "0 9 * * 1-5" 或 "@every 1h"
 */
export function cadenceToCron(cadence: string): string {
  const trimmed = cadence.trim().toLowerCase();
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

  const weekdayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };
  const weeklyMatch = trimmed.match(
    /^weekly(?:\s+(mon|tue|wed|thu|fri|sat|sun))?(?:\s+([01]?\d|2[0-3]):([0-5]\d))?$/
  );
  if (weeklyMatch) {
    const day = weeklyMatch[1] || 'mon';
    const h = weeklyMatch[2] ? parseInt(weeklyMatch[2], 10) : 10;
    const m = weeklyMatch[3] ? parseInt(weeklyMatch[3], 10) : 0;
    const dow = weekdayMap[day] ?? 1;
    return `${m} ${h} * * ${dow}`;
  }

  // 默认 fallback 工作日 9:30
  return '30 9 * * 1-5';
}

export function computeNextCheckIn(cadence: string, fromDate = new Date()): number {
  const cron = cadenceToCron(cadence);
  return computeNextRun(cron, fromDate);
}
