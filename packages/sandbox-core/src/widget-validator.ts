import vm from 'node:vm';

const MAX_TITLE_LENGTH = 120;
const MAX_HTML_BYTES = 512 * 1024;
const MIN_WIDGET_HEIGHT = 120;
const MAX_WIDGET_HEIGHT = 1200;

export interface WidgetValidationInput {
  title?: unknown;
  html?: unknown;
  height?: unknown;
  fallbackText?: unknown;
  fallback_text?: unknown;
}

export interface ValidatedWidget {
  title: string;
  html: string;
  kind: 'html' | 'svg';
  height?: number;
  fallbackText?: string;
}

export type WidgetValidationResult =
  | { ok: true; value: ValidatedWidget }
  | { ok: false; error: string };

/**
 * 提取内联 `<script>` 的 type 属性值（若不存在则返回空串）
 */
function extractScriptType(attrs: string): string {
  const match = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!match) return '';
  return (match[1] ?? match[2] ?? match[3] ?? '').trim().toLowerCase();
}

/**
 * 判断 `<script>` 是否为需要语法预检的内联 Classic JavaScript
 */
function isClassicInlineScript(attrs: string): boolean {
  if (/\bsrc\s*=/i.test(attrs)) {
    return false;
  }
  const scriptType = extractScriptType(attrs);
  return (
    scriptType === '' ||
    scriptType === 'text/javascript' ||
    scriptType === 'application/javascript'
  );
}

/**
 * 校验并规范化交互组件输入，并对内联 Classic JavaScript 做语法预检
 */
export function validateWidgetInput(input: WidgetValidationInput): WidgetValidationResult {
  const rawTitle = typeof input?.title === 'string' ? input.title : '';
  const normalizedTitle = rawTitle.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalizedTitle) {
    return { ok: false, error: 'Widget title 不能为空，请提供简短标题。' };
  }
  const title = normalizedTitle.slice(0, MAX_TITLE_LENGTH);

  const rawHtml = typeof input?.html === 'string' ? input.html : '';
  if (!rawHtml.trim()) {
    return { ok: false, error: 'Widget html 内容不能为空。' };
  }
  const htmlBytes = Buffer.byteLength(rawHtml, 'utf-8');
  if (htmlBytes > MAX_HTML_BYTES) {
    return {
      ok: false,
      error: `Widget html 内容过大（${htmlBytes} 字节），上限为 ${MAX_HTML_BYTES} 字节（512 KB）。`
    };
  }

  const trimmedHtml = rawHtml.trim();
  const kind: 'html' | 'svg' = /^<svg[\s>]/i.test(trimmedHtml) ? 'svg' : 'html';

  let height: number | undefined;
  if (input?.height !== undefined && input?.height !== null && input?.height !== '') {
    const num = Number(input.height);
    if (Number.isFinite(num)) {
      height = Math.min(MAX_WIDGET_HEIGHT, Math.max(MIN_WIDGET_HEIGHT, Math.round(num)));
    }
  }

  const rawFallback = input?.fallbackText ?? input?.fallback_text;
  const fallbackText =
    typeof rawFallback === 'string' && rawFallback.trim() ? rawFallback.trim() : undefined;

  const scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  let scriptIndex = 0;
  while ((match = scriptTagRegex.exec(rawHtml)) !== null) {
    const attrs = match[1] || '';
    const code = match[2] || '';
    if (!isClassicInlineScript(attrs) || !code.trim()) {
      continue;
    }
    scriptIndex += 1;
    try {
      new vm.Script(code, { filename: 'widget.js' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Widget 脚本语法错误（第 ${scriptIndex} 个内联 <script> 块）: ${msg}`
      };
    }
  }

  return {
    ok: true,
    value: {
      title,
      html: rawHtml,
      kind,
      ...(height !== undefined ? { height } : {}),
      ...(fallbackText !== undefined ? { fallbackText } : {})
    }
  };
}
