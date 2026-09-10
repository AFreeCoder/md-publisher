import { describe, expect, it } from 'vitest';
import { moveRange } from './editor';

describe('异步图片插入位置', () => {
  it('前文增删时跟随位置，后文输入不移动插入点', () => {
    const range = { start: 3, end: 3 };
    moveRange(range, '前文\n后文', '新增\n前文\n后文');
    expect(range).toEqual({ start: 6, end: 6 });
    moveRange(range, '新增\n前文\n后文', '前文\n后文');
    expect(range).toEqual({ start: 3, end: 3 });
    moveRange(range, '前文\n后文', '前文\n后文继续写');
    expect(range).toEqual({ start: 3, end: 3 });
  });
  it('选中文字被用户改写后收起选区，避免图片覆盖新输入', () => {
    const range = { start: 2, end: 5 };
    moveRange(range, 'AB旧内容CD', 'AB新输入的文字CD');
    expect(range).toEqual({ start: 8, end: 8 });
  });
});
