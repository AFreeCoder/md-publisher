import * as css from 'css-tree';
const allowed = new Set([
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'line-height',
  'text-align',
  'text-decoration',
  'letter-spacing',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'border',
  'border-top',
  'border-bottom',
  'border-left',
  'border-right',
  'border-color',
  'border-width',
  'border-style',
  'border-radius',
  'max-width',
  'width',
  'height',
  'white-space',
  'word-break',
  'overflow-wrap',
]);
export function safeStyle(source: string) {
  const declarations: string[] = [];
  try {
    const tree = css.parse(source, { context: 'declarationList' });
    css.walk(tree, (node) => {
      if (node.type !== 'Declaration' || !allowed.has(node.property)) return;
      const value = css.generate(node.value);
      if (/url\s*\(|expression|javascript|var\(|@|\\|[<>]/i.test(value)) return;
      if (css.lexer.matchProperty(node.property, node.value).error) return;
      declarations.push(`${node.property}:${value}${node.important ? '!important' : ''}`);
    });
  } catch {
    return '';
  }
  return declarations.join(';');
}
