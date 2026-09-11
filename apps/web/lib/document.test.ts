import { it, expect } from 'vitest';
import { freshDocument, restoreDocument, templates } from './document';
import { prepare, render } from '@jinzhang/core';
it('兼容旧封面数据，但不再在网页文档中保留', () => {
  expect(
    restoreDocument(JSON.stringify({ ...freshDocument(), cover: 'old.png' })),
  ).not.toHaveProperty('cover');
});
it('署名与寄语中的 Markdown 标点作为正文呈现', async () => {
  for (const author of ['~~~', '---', '===', '# 作者', '[作者](x)']) {
    const f = { ...freshDocument().fixed.wechat, author, slogan: '寄语仍在' };
    const p = await prepare(
      { markdown: templates(f).header, title: '' },
      {
        platform: 'wechat',
        fixed: { header: false, footer: false },
        resolver: { resolve: async () => ({ kind: 'missing', reason: '' }) },
      },
    );
    const r = render(p);
    expect(r.text).toContain(author);
    expect(r.text).toContain('寄语仍在');
    expect(r.html).not.toMatch(/<pre|<hr|<h1/);
  }
});
