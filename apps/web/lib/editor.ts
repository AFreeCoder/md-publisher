export interface EditRange {
  start: number;
  end: number;
}

export function changedRange(before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, oldEnd, newEnd };
}

// 图片解码期间允许继续编辑，跟随前文移动插入点，不覆盖后来输入的内容。
export function moveRange(range: EditRange, before: string, after: string) {
  const edit = changedRange(before, after);
  if (range.end <= edit.start) return;
  if (range.start >= edit.oldEnd) {
    range.start += edit.newEnd - edit.oldEnd;
    range.end += edit.newEnd - edit.oldEnd;
  } else {
    range.start = range.end = edit.newEnd;
  }
}

export function replaceEditorText(editor: HTMLTextAreaElement, next: string) {
  const before = editor.value;
  const edit = changedRange(before, next);
  if (before === next) return;
  const scrollTop = editor.scrollTop;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(edit.start, edit.oldEnd);
  // insertText 保留浏览器原生撤销栈；不通过 innerHTML 写入文章内容。
  if (!document.execCommand('insertText', false, next.slice(edit.start, edit.newEnd))) {
    editor.setRangeText(next.slice(edit.start, edit.newEnd), edit.start, edit.oldEnd, 'end');
  }
  editor.setSelectionRange(edit.newEnd, edit.newEnd);
  editor.scrollTop = scrollTop;
}

export function dropOffset(editor: HTMLTextAreaElement, x: number, y: number): number {
  const rect = editor.getBoundingClientRect();
  const style = getComputedStyle(editor);
  const mirror = document.createElement('div');
  for (const key of [
    'font',
    'letterSpacing',
    'lineHeight',
    'padding',
    'border',
    'boxSizing',
    'textAlign',
    'tabSize',
  ] as const)
    mirror.style[key] = style[key];
  Object.assign(mirror.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${editor.offsetWidth}px`,
    height: `${editor.offsetHeight}px`,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    overflow: 'auto',
    opacity: '0',
    zIndex: '2147483647',
  });
  mirror.textContent = editor.value + '\n';
  document.body.append(mirror);
  mirror.scrollTop = editor.scrollTop;
  mirror.scrollLeft = editor.scrollLeft;
  try {
    const point = document.caretPositionFromPoint?.(x, y);
    if (point && point.offsetNode === mirror.firstChild)
      return Math.min(point.offset, editor.value.length);
    const range = document.caretRangeFromPoint?.(x, y);
    if (range?.startContainer === mirror.firstChild)
      return Math.min(range.startOffset, editor.value.length);
    return editor.selectionStart;
  } finally {
    mirror.remove();
  }
}
