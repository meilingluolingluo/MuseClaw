const ZH_REQUEST_PATTERNS = [
  /^(?:请|麻烦|帮我|帮忙|可以|能不能|能否)?\s*(?:把|将)?\s*(?:你的|你|我的|我)?\s*(?:虚拟)?(?:形象|头像|样子|外形)\s*(?:改|换|变|更换|切换|设置|设定|变更)(?:成|为|到|成为|一下成|一下为)?\s*(.+)$/i,
  /^(?:请|麻烦|帮我|帮忙)?\s*(?:换|变|改)(?:个|一个|一下)?\s*(?:新的?)?(?:虚拟)?(?:形象|头像)\s*[：:，,、]?\s*(.+)$/i,
  /^(?:请|麻烦|帮我|帮忙)?\s*(?:变成|化身为|变身为|变身成)\s*(.+?)\s*(?:的)?(?:形象|样子|头像)?$/i,
  /^(?:生成|创作|绘制|做一个)(?:新的?)?(?:虚拟)?(?:形象|头像)\s*[：:，,、]?\s*(.+)$/i,
];

const EN_REQUEST_PATTERNS = [
  /^(?:please\s+)?(?:can you\s+)?(?:change|switch|set|update|turn|make|transform)\s+(?:your|the|my|ur)?\s*(?:virtual\s+)?(?:avatar|appearance|look|character)\s+(?:to|into)\s+(.+)$/i,
  /^(?:please\s+)?(?:new|another)\s+(?:virtual\s+)?avatar\s*[:,-]?\s*(.+)$/i,
  /^(?:please\s+)?(?:become|be)\s+(.+)$/i,
  /^(?:please\s+)?(?:generate|create|draw)\s+(?:an?\s+)?avatar\s*[:,-]?\s*(.+)$/i,
];

const SUBJECT_FILTER = /\b(cat|dog|puppy|kitten|robot|bear|panda|fox|rabbit|bunny|bird|dragon|penguin|owl|corgi|shiba|husky|otter|character|creature|monster|alien|knight|wizard|ninja)\b/i;
const TRAILING_PUNCTUATION = /[。.!！~～吧呗呀哦啊嘛]+$/;

/**
 * 解析用户自然语言中包含的更换或创建形象诉求
 */
export function parseAvatarRequest(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 400 || trimmed.includes('\n')) {
    return null;
  }

  let matchedDesc: string | null = null;
  let matchedHead = '';

  for (const rx of [...ZH_REQUEST_PATTERNS, ...EN_REQUEST_PATTERNS]) {
    const hit = rx.exec(trimmed);
    if (hit) {
      matchedDesc = hit[1];
      matchedHead = hit[0].toLowerCase();
      break;
    }
  }

  if (!matchedDesc) {
    return null;
  }

  let desc = matchedDesc.trim().replace(TRAILING_PUNCTUATION, '').trim();
  desc = desc.replace(/^(?:成|为|到)\s*/i, '').trim();
  desc = desc.replace(/^(an?|the)\s+/i, '').trim();

  if (!desc || desc.length > 200) {
    return null;
  }

  if ((matchedHead.startsWith('be ') || matchedHead.startsWith('become ')) && !SUBJECT_FILTER.test(desc)) {
    return null;
  }

  if (matchedHead.startsWith('变成') || matchedHead.startsWith('化身') || matchedHead.startsWith('变身')) {
    if (desc.length < 2) return null;
  }

  return desc;
}

const ZH_ORDINAL_MAP: Record<string, number> = {
  一: 0,
  '1': 0,
  二: 1,
  两: 1,
  '2': 1,
  三: 2,
  '3': 2,
  四: 3,
  '4': 3,
};

const EN_ORDINAL_MAP: Record<string, number> = {
  first: 0,
  '1st': 0,
  second: 1,
  '2nd': 1,
  third: 2,
  '3rd': 2,
  fourth: 3,
  '4th': 3,
  last: 3,
};

const CORNER_MAP: Record<string, number> = {
  左上: 0,
  右上: 1,
  左下: 2,
  右下: 3,
  'top left': 0,
  'top right': 1,
  'bottom left': 2,
  'bottom right': 3,
};

const REGENERATE_REGEX = /^(重新生成|再来一组|再生成|换一批|都不喜欢|都不好|都不要|再来四个|重来|regenerate|try again|another set|none of (these|them)|new options)$/i;
const CANCEL_REGEX = /^(算了|不换了|取消|不要了|cancel|never mind|nevermind|forget it|stop)$/i;

const PICK_ZH_REGEX = /^(?:就|选|要|我要|我选|用|我喜欢|喜欢)?\s*第\s*([一二两三四1234])\s*(?:个|只|张|款|号)?(?:吧|好了|好)?$/i;
const PICK_NUM_REGEX = /^(?:就|选|要|我要|我选|用)?\s*([1-4])\s*(?:号|个|只|张)?(?:吧|好了|好)?$/i;
const PICK_EN_REGEX = /^(?:i(?:'ll| will)? (?:take|pick|choose|like|want)|pick|choose|take|use|go with)?\s*(?:the\s+)?(?:option|number|no\.?|#)?\s*([1-4])$/i;
const PICK_EN_ORD_REGEX = /^(?:i(?:'ll| will)? (?:take|pick|choose|like|want)|pick|choose|take|use|go with)?\s*(?:the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|last)(?:\s+one)?$/i;

/**
 * 在 4 候选图等待挑选状态下，解析用户文本输入的选择、重试或取消动作
 */
export function parseAvatarChoice(text: string): number | 'regenerate' | 'cancel' | null {
  const clean = text.trim().replace(TRAILING_PUNCTUATION, '').trim();
  const lower = clean.toLowerCase();
  if (!clean || clean.length > 40) {
    return null;
  }

  if (REGENERATE_REGEX.test(lower)) {
    return 'regenerate';
  }
  if (CANCEL_REGEX.test(lower)) {
    return 'cancel';
  }

  for (const [corner, idx] of Object.entries(CORNER_MAP)) {
    if (
      lower === corner ||
      lower === `${corner}那个` ||
      lower === `${corner}的` ||
      lower === `${corner}角` ||
      lower === `${corner}角那个` ||
      lower === `${corner}角的` ||
      lower === `the ${corner} one` ||
      lower === `${corner} one`
    ) {
      return idx;
    }
  }

  const mZh = PICK_ZH_REGEX.exec(clean);
  if (mZh && ZH_ORDINAL_MAP[mZh[1]] !== undefined) {
    return ZH_ORDINAL_MAP[mZh[1]];
  }

  const mNum = PICK_NUM_REGEX.exec(clean);
  if (mNum) {
    return parseInt(mNum[1], 10) - 1;
  }

  const mEn = PICK_EN_REGEX.exec(lower);
  if (mEn) {
    return parseInt(mEn[1], 10) - 1;
  }

  const mEnOrd = PICK_EN_ORD_REGEX.exec(lower);
  if (mEnOrd && EN_ORDINAL_MAP[mEnOrd[1]] !== undefined) {
    return EN_ORDINAL_MAP[mEnOrd[1]];
  }

  return null;
}
