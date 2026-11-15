/**
 * 轻量级标准 5 段式 Cron 解析与匹配器（无第三方依赖）
 * 格式: [分] [时] [日] [月] [周] (0-59, 0-23, 1-31, 1-12, 0-6，0代表周日)
 */

function matchField(pattern: string, val: number, min: number, max: number): boolean {
  if (pattern === '*' || pattern === '?') return true;

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
    return pattern.split(',').some(p => matchField(p.trim(), val, min, max));
  }

  // 3. 处理范围 1-5
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number);
    return val >= start && val <= end;
  }

  // 4. 精确数字匹配
  return parseInt(pattern, 10) === val;
}

/**
 * 判断指定时间是否命中 Cron 表达式
 */
export function matchesCron(expr: string, date = new Date()): boolean {
  const trimmed = expr.trim();

  // 快捷别名支持
  if (trimmed === '@hourly') return date.getMinutes() === 0;
  if (trimmed === '@daily') return date.getHours() === 0 && date.getMinutes() === 0;

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return false;

  const [minP, hourP, domP, monthP, dowP] = parts;

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const dayOfWeek = date.getDay();   // 0-6 (0 is Sunday)

  if (!matchField(minP, minute, 0, 59)) return false;
  if (!matchField(hourP, hour, 0, 23)) return false;
  if (!matchField(domP, dayOfMonth, 1, 31)) return false;
  if (!matchField(monthP, month, 1, 12)) return false;
  if (!matchField(dowP, dayOfWeek, 0, 6)) return false;

  return true;
}

/**
 * 计算 Cron 表达式在指定基准时间之后的下一次执行时间戳
 */
export function computeNextRun(expr: string, fromDate = new Date()): number {
  const trimmed = expr.trim();

  // 支持 @every 5m 形式
  if (trimmed.startsWith('@every ')) {
    const durationStr = trimmed.replace('@every ', '').trim();
    let ms = 60 * 1000;
    if (durationStr.endsWith('m')) {
      ms = parseInt(durationStr, 10) * 60 * 1000;
    } else if (durationStr.endsWith('h')) {
      ms = parseInt(durationStr, 10) * 3600 * 1000;
    } else if (durationStr.endsWith('s')) {
      ms = parseInt(durationStr, 10) * 1000;
    }
    return fromDate.getTime() + ms;
  }

  // 从下一分钟的第 0 秒开始向上探测，最多探测 14 天（防止死循环）
  const cursor = new Date(fromDate.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxChecks = 60 * 24 * 14; // 14 天
  for (let i = 0; i < maxChecks; i++) {
    if (matchesCron(trimmed, cursor)) {
      return cursor.getTime();
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  // 若探测未果，默认 1 小时后
  return fromDate.getTime() + 3600 * 1000;
}
