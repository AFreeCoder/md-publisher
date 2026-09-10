import { build } from 'tsup';
import { readFile, readdir } from 'node:fs/promises';
await build({
  entry: [
    'packages/core/dist/index.js',
    'packages/core/dist/preview.js',
    'packages/core/dist/browser.js',
    'apps/web/lib/clipboard.ts',
  ],
  outDir: '.browser-audit',
  format: ['esm'],
  platform: 'browser',
  bundle: true,
  noExternal: [/.*/],
  metafile: true,
  clean: true,
  silent: true,
});
const files = await readdir('.browser-audit');
let checked = 0;
for (const file of files.filter((f) => f.endsWith('.json'))) {
  const graph = JSON.parse(await readFile(`.browser-audit/${file}`, 'utf8'));
  for (const input of Object.keys(graph.inputs || {})) {
    if (/(?:^|\/)(?:sharp|ali-oss|node:|publish)(?:\/|$)/.test(input))
      throw new Error(`浏览器依赖越界: ${input}`);
    checked++;
  }
}
if (!checked) throw new Error('未生成可检查的浏览器依赖图');
const chunks = await readdir('apps/web/.next/static/chunks');
for (const file of chunks.filter((f) => f.endsWith('.js'))) {
  const source = await readFile(`apps/web/.next/static/chunks/${file}`, 'utf8');
  if (/OSS_ACCESS_KEY_SECRET|TRANSIT_TICKET_SECRET/.test(source))
    throw new Error(`客户端含服务端配置名: ${file}`);
}
console.log(
  `浏览器依赖边界通过：${checked} 个模块；浏览器构建拒绝 Node 内置模块，无 OSS/sharp/投递依赖。`,
);
