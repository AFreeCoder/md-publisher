import * as css from 'css-tree';
import type { Root, Element } from 'hast';
const inherited = new Set([
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
]);
/** 仅删除明确可继承且与父级相同的值；不推测浏览器默认样式。 */
export function compactStyles(root: Root) {
  function walk(parent: Root | Element, ancestor: Map<string, string>) {
    let next = ancestor;
    if (parent.type === 'element' && typeof parent.properties.style === 'string') {
      const declarations: { name: string; value: string; important: boolean }[] = [];
      const ast = css.parse(parent.properties.style, { context: 'declarationList' });
      css.walk(ast, (node) => {
        if (node.type === 'Declaration') {
          let value = css
            .generate(node.value)
            .replace(/\b0px\b/g, '0')
            .replace(/#([a-f\d])\1([a-f\d])\2([a-f\d])\3\b/gi, '#$1$2$3');
          if (/^(#000|black)$/i.test(value)) value = '#292c29';
          declarations.push({ name: node.property, value, important: !!node.important });
        }
      });
      next = new Map(ancestor);
      const output: string[] = [];
      for (const d of declarations) {
        if (!inherited.has(d.name) || ancestor.get(d.name) !== d.value || d.important)
          output.push(`${d.name}:${d.value}${d.important ? '!important' : ''}`);
        if (inherited.has(d.name)) next.set(d.name, d.value);
      }
      if (output.length) parent.properties.style = output.join(';');
      else delete parent.properties.style;
    }
    for (const child of parent.children) if (child.type === 'element') walk(child, next);
  }
  walk(root, new Map());
}
