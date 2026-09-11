import * as css from 'css-tree';
import type { Root, Element } from 'hast';
/** 压缩声明语法，但保留显式样式，避免目标编辑器默认样式覆盖继承。 */
export function compactStyles(root: Root) {
  function walk(parent: Root | Element) {
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
      const output: string[] = [];
      for (const d of declarations) {
        output.push(`${d.name}:${d.value}${d.important ? '!important' : ''}`);
      }
      if (output.length) parent.properties.style = output.join(';');
      else delete parent.properties.style;
    }
    for (const child of parent.children) if (child.type === 'element') walk(child);
  }
  walk(root);
}
