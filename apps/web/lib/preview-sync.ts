function linePositions(editor: HTMLTextAreaElement) {
  const mirror = document.createElement('div');
  const style = getComputedStyle(editor);
  for (const key of [
    'font',
    'letterSpacing',
    'lineHeight',
    'padding',
    'boxSizing',
    'tabSize',
  ] as const)
    mirror.style[key] = style[key];
  Object.assign(mirror.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${editor.clientWidth}px`,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    visibility: 'hidden',
  });
  for (const line of editor.value.split('\n')) {
    const row = document.createElement('div');
    row.textContent = line || '\u200b';
    mirror.append(row);
  }
  document.body.append(mirror);
  const positions = Array.from(
    mirror.children,
    (row) => (row as HTMLElement).offsetTop - parseFloat(style.paddingTop),
  );
  mirror.remove();
  return positions;
}
export function connectPreview(
  editor: HTMLTextAreaElement,
  frame: HTMLIFrameElement,
  onLocate: () => void,
) {
  const doc = frame.contentDocument;
  const scroller = doc?.scrollingElement;
  if (!doc || !scroller) return () => {};
  let locked = false,
    released = false,
    cachedValue = '',
    cachedWidth = 0;
  let positions: number[] = [];
  const getPositions = () => {
    if (cachedValue !== editor.value || cachedWidth !== editor.clientWidth) {
      cachedValue = editor.value;
      cachedWidth = editor.clientWidth;
      positions = linePositions(editor);
    }
    return positions;
  };
  const anchors = () => {
    const tops = getPositions();
    const maxEditor = Math.max(0, editor.scrollHeight - editor.clientHeight);
    const maxPreview = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const points: [number, number][] = [[0, 0]];
    for (const node of doc.querySelectorAll<HTMLElement>('[data-source-line]')) {
      const source = tops[Number(node.dataset.sourceLine) - 1];
      const target = node.getBoundingClientRect().top + scroller.scrollTop;
      const previous = points[points.length - 1];
      if (source > previous[0] && target > previous[1] && source < maxEditor && target < maxPreview)
        points.push([source, target]);
    }
    points.push([maxEditor, maxPreview]);
    return points;
  };
  const synchronize = (from: 0 | 1) => {
    if (locked || released || !editor.clientHeight) return;
    const points = anchors();
    const value = from === 0 ? editor.scrollTop : scroller.scrollTop;
    let index = 1;
    while (index < points.length - 1 && points[index][from] < value) index++;
    const low = points[index - 1],
      high = points[index];
    const ratio = Math.max(0, Math.min(1, (value - low[from]) / (high[from] - low[from] || 1)));
    const target = low[1 - from] + (high[1 - from] - low[1 - from]) * ratio;
    locked = true;
    if (from === 0) scroller.scrollTop = target;
    else editor.scrollTop = target;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        locked = false;
      }),
    );
  };
  const fromEditor = () => synchronize(0),
    fromPreview = () => synchronize(1);
  const locate = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!target || target.closest('a') || !doc.getSelection()?.isCollapsed) return;
    const node = target.closest<HTMLElement>('[data-source-line]');
    if (!node) return;
    const line = Number(node.dataset.sourceLine);
    const offset = editor.value
      .split('\n')
      .slice(0, line - 1)
      .reduce((sum, text) => sum + text.length + 1, 0);
    onLocate();
    requestAnimationFrame(() => {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(offset, offset);
      editor.scrollTop = Math.max(0, (getPositions()[line - 1] || 0) - 32);
    });
  };
  editor.addEventListener('scroll', fromEditor);
  doc.addEventListener('scroll', fromPreview);
  doc.addEventListener('click', locate);
  frame.contentWindow?.addEventListener('resize', fromEditor);
  fromEditor();
  return () => {
    released = true;
    editor.removeEventListener('scroll', fromEditor);
    doc.removeEventListener('scroll', fromPreview);
    doc.removeEventListener('click', locate);
    frame.contentWindow?.removeEventListener('resize', fromEditor);
  };
}
