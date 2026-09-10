import * as css from 'css-tree';
import { selectAll } from 'hast-util-select';
import type { Element, Root } from 'hast';
import type { ThemeId } from './types';
import { themeSources } from './themes/generated';
export const themes = [
  { id: 'sspai', name: '少数派', accent: '#ac493a', description: '温润克制，让重点被看见。' },
  { id: 'native', name: '公众号原生', accent: '#526d64', description: '自然留白，舒展长文阅读。' },
  { id: 'mac', name: 'Mac', accent: '#51667d', description: '层次清楚，适合技术表达。' },
] as const;
export function inlineTheme(root: Root, id: ThemeId) {
  const tree = css.parse(themeSources[id] || themeSources.sspai);
  let order = 0;
  const merged = new Map<Element, Map<string, { value: string; rank: number }>>();
  css.walk(tree, (node) => {
    if (node.type === 'Atrule') throw new Error('主题不支持 @ 规则');
    if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
    const selectorText = css.generate(node.prelude);
    const declarations: { name: string; value: string; important: boolean }[] = [];
    node.block.children.forEach((d) => {
      if (d.type !== 'Declaration') return;
      const value = css.generate(d.value);
      if (/^(position|float)$/.test(d.property) || /var\(|calc\(|url\(|grid|flex/.test(value))
        throw new Error('主题含不支持的声明');
      declarations.push({ name: d.property, value, important: !!d.important });
    });
    for (const selector of selectorText.split(',')) {
      if (/[\[\]~+]/.test(selector.replace(/:nth-child\([^)]*\)/g, '')))
        throw new Error('主题选择器超出范围');
      const pseudo = selector.match(/::(before|after)$/)?.[1];
      const base = selector.replace(/::(before|after)$/, '');
      const specificity =
        (base.match(/\.[\w-]+|:(?:first-child|last-child|nth-child)/g)?.length || 0) * 100 +
        (base.match(/(?:^|[ >])[a-z][\w-]*/g)?.length || 0);
      for (let element of selectAll(base, root)) {
        if (pseudo) {
          const content = declarations.find((d) => d.name === 'content')?.value;
          if (!content || !/^(['"]).*\1$/.test(content))
            throw new Error('伪元素 content 必须为字符串');
          const span: Element = {
            type: 'element',
            tagName: 'span',
            properties: {},
            children: [{ type: 'text', value: content.slice(1, -1) }],
          };
          if (pseudo === 'before') element.children.unshift(span);
          else element.children.push(span);
          element = span;
        }
        const values = merged.get(element) || new Map<string, { value: string; rank: number }>();
        if (!merged.has(element) && element.properties.style) {
          const inline = css.parse(String(element.properties.style), {
            context: 'declarationList',
          });
          css.walk(inline, (d) => {
            if (d.type === 'Declaration')
              values.set(d.property, {
                value: css.generate(d.value),
                rank: d.important ? 2e9 : 1e8,
              });
          });
        }
        merged.set(element, values);
        for (const d of declarations) {
          if (d.name === 'content') continue;
          const rank = (d.important ? 1e9 : 0) + specificity * 1e4 + order++;
          if ((values.get(d.name)?.rank ?? -1) <= rank)
            values.set(d.name, {
              value: d.value.replace(/#000(?:000)?\b/g, '#292c29').replace(/\b0px\b/g, '0'),
              rank,
            });
        }
      }
    }
  });
  for (const [element, values] of merged) {
    element.properties.style = [...values].map(([name, v]) => `${name}:${v.value}`).join(';');
  }
}
