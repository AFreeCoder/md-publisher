import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskVersion, writeClipboard } from './clipboard';
afterEach(() => vi.unstubAllGlobals());
describe('复制任务', () => {
  it('用户改稿后旧版本必须失败', () => {
    const v = new TaskVersion();
    const token = v.current();
    v.change();
    expect(() => v.assert(token)).toThrow('重新复制');
  });
  it('点击的同步栈立即写 ClipboardItem，两种 MIME 来自同一准备任务', async () => {
    let payloads: Record<string, Promise<Blob>> = {};
    const write = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(data: typeof payloads) {
          payloads = data;
        }
      },
    );
    let complete!: (v: { html: string; text: string; bytes: number }) => void;
    const task = new Promise<{ html: string; text: string; bytes: number }>((r) => (complete = r));
    const writing = writeClipboard(task);
    expect(write).toHaveBeenCalledTimes(1);
    complete({ html: '<p>正文</p>', text: '正文', bytes: 13 });
    await writing;
    expect(await (await payloads['text/html']).text()).toBe('<p>正文</p>');
    expect(await (await payloads['text/plain']).text()).toBe('正文');
  });
});
