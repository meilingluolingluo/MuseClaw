/**
 * 跨浏览器剪贴板复制工具，适配非安全上下文（如局域网 HTTP IP 访问）与多层级模态框焦点隔离环境
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. 优先尝试现代异步剪贴板 API
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 浏览器权限策略或非安全上下文拦截时，平滑降级至兼容性选区模式
    }
  }

  // 2. 兼容模式：创建动态文本域并通过 execCommand 完成复制
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.opacity = '0.01';
    textArea.style.zIndex = '9999999';
    textArea.setAttribute('readonly', '');

    // 挂载至当前活跃模态框内部或 body，避免被 aria-modal 焦点管理陷阱阻断
    const activeModal = document.querySelector('.modal-content');
    const targetParent = activeModal || document.body;
    targetParent.appendChild(textArea);

    textArea.focus({ preventScroll: true });
    textArea.select();
    textArea.setSelectionRange(0, text.length);
    const successful = document.execCommand('copy');
    targetParent.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback copy error:', err);
    return false;
  }
}
