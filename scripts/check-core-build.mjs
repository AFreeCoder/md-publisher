import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as esm from '../packages/core/dist/index.js';
const cjs = createRequire(import.meta.url)('../packages/core/dist/index.cjs');
const markdown = await readFile(new URL('../fixtures/article.md', import.meta.url), 'utf8');
const resolver = { resolve: async () => ({ kind: 'missing', reason: 'fixture' }) };
for (const platform of ['wechat', 'zhihu']) {
  const args = [
    { markdown, title: '标准验收文章' },
    { platform, fixed: { header: false, footer: false }, resolver },
  ];
  const a = await esm.prepare(...args),
    b = await cjs.prepare(...args);
  for (const theme of ['sspai', 'native', 'mac'])
    assert.deepEqual(esm.render(a, { theme }), cjs.render(b, { theme }));
}
console.log('ESM / CJS 产物：标准文章 × 两平台 × 三主题输出一致。');
