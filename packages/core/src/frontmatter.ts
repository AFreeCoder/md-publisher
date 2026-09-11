import { isMap, parseDocument } from 'yaml';

/** 只忽略可识别的 YAML 映射；分隔线之间的正文必须保留。 */
export function stripFrontmatter(markdown: string) {
  const source = markdown.replace(/^\uFEFF/, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { source, ignored: false };
  const yaml = parseDocument(match[1]);
  const commentsOnly =
    match[1].trim() &&
    match[1].split(/\r?\n/).every((line) => !line.trim() || line.trim().startsWith('#'));
  if (yaml.errors.length || (!isMap(yaml.contents) && !commentsOnly))
    return { source, ignored: false };
  return { source: source.slice(match[0].length), ignored: true };
}
