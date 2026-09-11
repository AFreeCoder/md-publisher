import type { Platform, ThemeId } from '@jinzhang/core';
export const STORAGE_KEY = 'jinzhang.document.v1';
export interface FixedContent {
  header: boolean;
  footer: boolean;
  headerStyle: string;
  footerStyle: string;
  author: string;
  slogan: string;
  closing: string;
  collection: string;
}
export interface DocumentState {
  markdown: string;
  title: string;
  theme: ThemeId;
  platform: Platform;
  fixed: Record<Platform, FixedContent>;
}
export function freshDocument(): DocumentState {
  const fixed = () => ({
    header: false,
    footer: false,
    headerStyle: '简约署名',
    footerStyle: '一句寄语',
    author: '',
    slogan: '',
    closing: '愿每一次认真表达，都被好好看见。',
    collection: '',
  });
  return {
    markdown: '',
    title: '',
    theme: 'sspai',
    platform: 'wechat',
    fixed: { wechat: fixed(), zhihu: fixed() },
  };
}
export function restoreDocument(raw: string | null): DocumentState {
  if (!raw) return freshDocument();
  const d = JSON.parse(raw);
  if (
    !d ||
    typeof d.markdown !== 'string' ||
    typeof d.title !== 'string' ||
    !['wechat', 'zhihu'].includes(d.platform) ||
    !['sspai', 'native', 'mac'].includes(d.theme)
  )
    throw new Error('本地文档格式无效。');
  for (const platform of ['wechat', 'zhihu']) {
    const f = d.fixed?.[platform];
    if (
      !f ||
      typeof f.header !== 'boolean' ||
      typeof f.footer !== 'boolean' ||
      ['headerStyle', 'footerStyle', 'author', 'slogan', 'closing', 'collection'].some(
        (k) => typeof f[k] !== 'string',
      )
    )
      throw new Error('本地设置格式无效。');
  }
  return {
    markdown: d.markdown,
    title: d.title,
    theme: d.theme,
    platform: d.platform,
    fixed: d.fixed,
  };
}
export function normalizeCollectionLink(value: string): string | null {
  const input = value.trim();
  if (!input) return '';
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      /\s/.test(input) ||
      !url.hostname.includes('.')
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function templates(f: FixedContent) {
  const safe = (s: string) => s.replace(/[\\`*_{}[\]()#+.!<>|~=:$/?&@%,;"'-]/g, '\\$&');
  const link = normalizeCollectionLink(f.collection);
  const collection = link ? `\n[继续阅读](${link.replace(/[()\s]/g, encodeURIComponent)})` : '';
  return {
    header: `${f.headerStyle === '留白分隔' ? '---\n' : ''}${safe(f.author)}\n\n${safe(f.slogan)}`,
    footer: `${f.footerStyle === '细线落款' ? '---\n' : ''}${safe(f.closing)}${collection}`,
  };
}
export const sampleMarkdown =
  '# 把写作还给写作\n\n写完一篇文章，应该是松一口气的时刻。\n而不是另一场排版工作的开始。\n\n## 01 让内容，回到中心\n\n我们在不同的地方写作，却常常在发布前做着相同的事：调整标题、处理图片、为每个平台重新排版。\n\n**好的工具，应该把这些琐碎接过去。**\n\n> 少一些来回复制，多一些认真表达。\n\n## 02 一份原文，两种呈现\n\n- 在公众号，让样式与文字相得益彰\n- 在知乎，让内容结构清楚完整\n- 发布之前，始终由你做最后的确认\n\n```typescript\nconst article = await prepare(markdown);\nconst result = render(article);\n```\n\n| 平台 | 呈现方式 |\n| --- | --- |\n| 微信公众号 | 主题与样式 |\n| 知乎 | 内容结构 |\n\n写作的下一步，可以很轻。';
