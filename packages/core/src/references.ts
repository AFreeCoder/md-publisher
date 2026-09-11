import { decodeHTMLAttribute } from 'entities';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
/** 精确重写图片/定义节点，不替换正文文字或路径相似的其他引用。 */
export function replaceImageReference(markdown: string, original: string, replacement: string) {
  const tree = unified().use(remarkParse).parse(markdown);
  const changes: { start: number; end: number; value: string }[] = [];
  visit(tree, (node) => {
    if (
      (node.type === 'image' || node.type === 'definition') &&
      node.url === original &&
      node.position
    ) {
      const start = node.position.start.offset,
        end = node.position.end.offset;
      if (start === undefined || end === undefined) return;
      const title = node.title ? ` "${node.title.replace(/["\\]/g, '\\$&')}"` : '';
      const value =
        node.type === 'image'
          ? `![${node.alt?.replace(/[\[\]\\]/g, '\\$&') || ''}](<${replacement}>${title})`
          : `[${node.label || node.identifier}]: <${replacement}>${title}`;
      changes.push({ start, end, value });
    } else if (node.type === 'html' && node.position) {
      const start = node.position.start.offset,
        end = node.position.end.offset;
      if (start === undefined || end === undefined) return;
      const value = node.value.replace(
        /(<img\b[^>]*?\s+src\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (all, prefix, doubleQuoted, singleQuoted, unquoted) => {
          const ref = doubleQuoted ?? singleQuoted ?? unquoted;
          return decodeHTMLAttribute(ref) === original
            ? `${prefix}"${replacement.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
            : all;
        },
      );
      if (value !== node.value) changes.push({ start, end, value });
    }
  });
  for (const change of changes.sort((a, b) => b.start - a.start))
    markdown = markdown.slice(0, change.start) + change.value + markdown.slice(change.end);
  return markdown;
}
