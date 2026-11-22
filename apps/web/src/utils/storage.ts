/**
 * 安全封装 Storage，具备在隐私模式或受限 WebView 抛出 SecurityError 时的自动降级能力
 */
class SafeStorage {
  private memory = new Map<string, string>();

  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // 捕获受限环境中的 SecurityError
    }
    return this.memory.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch {
      // 降级到内存
    }
    this.memory.set(key, value);
  }

  removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
        return;
      }
    } catch {
      // 降级到内存
    }
    this.memory.delete(key);
  }
}

export const safeStorage = new SafeStorage();
