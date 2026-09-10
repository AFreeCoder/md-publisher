import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { BrowserAssetResolver } from '../src/browser';
describe('本地图片与引用绑定', () => {
  it('内容去重不导致不同目录同名图片错绑，刷新后能恢复', async () => {
    const store = new BrowserAssetResolver();
    await store.clear();
    const a = await store.add(new Blob(['abc'], { type: 'image/png' }), './one/a.png');
    const b = await store.add(new Blob(['abc'], { type: 'image/png' }), './two/a.png');
    expect(a).not.toBe(b);
    const fresh = new BrowserAssetResolver();
    expect((await fresh.resolve('./one/a.png')).kind).toBe('blob');
    expect((await fresh.resolve('./missing/a.png')).kind).toBe('missing');
    expect((await fresh.resolve(a)).kind).toBe('blob');
    await fresh.clear();
    expect((await fresh.resolve(a)).kind).toBe('missing');
  });
  it('超大资源与无效 data URL 拒绝', async () => {
    const store = new BrowserAssetResolver();
    await expect(store.add(new Blob([new Uint8Array(13 * 1024 * 1024)]))).rejects.toThrow('12 MB');
    expect((await store.resolve('data:image/png;base64,!!!!')).kind).toBe('missing');
  });
});
