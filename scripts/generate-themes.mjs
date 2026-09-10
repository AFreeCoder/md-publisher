import { readFile, writeFile } from 'node:fs/promises';
const themes = {};
for (const id of ['sspai', 'native', 'mac'])
  themes[id] = await readFile(
    new URL(`../packages/core/src/themes/${id}/theme.css`, import.meta.url),
    'utf8',
  );
await writeFile(
  new URL('../packages/core/src/themes/generated.ts', import.meta.url),
  `// 由 scripts/generate-themes.mjs 从 CSS 生成。\nexport const themeSources = ${JSON.stringify(themes, null, 2)} as const;\n`,
);
