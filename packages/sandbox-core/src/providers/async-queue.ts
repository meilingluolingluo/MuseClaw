/**
 * 异步推送队列：用于向长驻 Agent SDK 会话持续投喂多轮用户消息
 */
export class AsyncPushQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<{
    resolve: (res: IteratorResult<T>) => void;
    reject: (err: unknown) => void;
  }> = [];
  private closed = false;
  private failure: unknown = undefined;
  private hasFailure = false;

  public push(item: T): boolean {
    if (this.closed || this.hasFailure) return false;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
      return true;
    }
    this.buffer.push(item);
    return true;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve({ value: undefined as unknown as T, done: true });
    }
  }

  public fail(err: unknown): void {
    if (this.closed || this.hasFailure) return;
    this.hasFailure = true;
    this.failure = err;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.reject(err);
    }
  }

  public isClosed(): boolean {
    return this.closed || this.hasFailure;
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.hasFailure) {
          return Promise.reject(this.failure);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close();
        return Promise.resolve({ value: undefined as unknown as T, done: true });
      }
    };
  }
}
