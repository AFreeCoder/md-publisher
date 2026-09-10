import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const fixture = path.resolve('fixtures/sample.png');
test('图片处理期间继续打字，插入后光标与原生撤销重做正常', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    (window as any).releaseImage = release;
    let first = true;
    window.createImageBitmap = (async (...args: any[]) => {
      if (first) {
        first = false;
        (window as any).imageWaiting = true;
        await waiting;
      }
      return (original as any)(...args);
    }) as typeof createImageBitmap;
  });
  await page.goto('/format');
  const editor = page.getByRole('textbox', { name: 'Markdown 原文' });
  await editor.fill('前文\n后文');
  await editor.press('Home');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '＋ 插入图片' }).click();
  await (await chooser).setFiles(fixture);
  await expect.poll(() => page.evaluate(() => (window as any).imageWaiting)).toBe(true);
  await editor.focus();
  await editor.press('ArrowUp');
  await editor.press('Home');
  await page.keyboard.insertText('新增前文\n');
  await page.evaluate(() => (window as any).releaseImage());
  await expect(editor).toHaveValue(/^新增前文\n前文\n\n!\[.*\]\(jz-local:.*\)\n后文$/);
  const inserted = await editor.inputValue();
  expect(await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(
    inserted.length - 2,
  );
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue('新增前文\n前文\n后文');
  await editor.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveValue(inserted);
});
test('拖图插入鼠标落点而不是旧光标位置', async ({ page }) => {
  await page.goto('/format');
  const editor = page.getByRole('textbox', { name: 'Markdown 原文' });
  await editor.fill('第一行\n第二行\n第三行\n第四行');
  await editor.press('ControlOrMeta+Home');
  const bytes = Array.from(await readFile(fixture));
  await editor.evaluate((el: HTMLTextAreaElement, bytes) => {
    const rect = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([new Uint8Array(bytes)], 'drop.png', { type: 'image/png' }));
    el.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + parseFloat(css.paddingLeft) + 1,
        clientY: rect.top + parseFloat(css.paddingTop) + parseFloat(css.lineHeight) * 2.5,
      }),
    );
  }, bytes);
  await expect(editor).toHaveValue(
    /^第一行\n第二行\n\n!\[drop.png\]\(jz-local:.*\)\n第三行\n第四行$/,
  );
});
test('光标插图即时上传，失败可重试，切平台与刷新复用图片', async ({ page }) => {
  await page.goto('/format');
  const editor = page.getByRole('textbox', { name: 'Markdown 原文' });
  await expect(editor).toHaveCSS('font-size', '16px');
  await expect(page.locator('.work-header')).toHaveCSS('height', '60px');
  await expect(page.getByRole('button', { name: '更换封面 ↗' })).toHaveCount(0);
  await editor.fill('前文\n后文');
  await editor.press('Home');
  let uploads = 0;
  await page.route('https://oss.example.test/upload', (route) => {
    uploads++;
    return route.fulfill({ status: uploads === 1 ? 500 : 201, body: '' });
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '＋ 插入图片' }).click();
  await (await chooser).setFiles(fixture);
  await expect(editor).toHaveValue(/^前文\n\n!\[.*\]\(jz-local:.*\)\n后文$/);
  await expect(page.getByRole('button', { name: '重试上传' })).toBeVisible();
  const articleWithImage = await editor.inputValue();
  await editor.fill('图片已删除');
  await expect(page.getByRole('button', { name: '重试上传' })).toHaveCount(0);
  await editor.fill(articleWithImage);
  await expect(page.getByRole('button', { name: '重试上传' })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '重试上传' }).click();
  await expect(page.getByRole('button', { name: '复制到公众号 ↗' })).toBeEnabled();
  await expect(page.frameLocator('iframe').locator('header img')).toHaveCount(0);
  await expect(page.frameLocator('iframe').getByText('未设置封面')).toHaveCount(0);
  await expect.poll(() => uploads).toBe(2);
  await page.getByRole('button', { name: '知乎', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '复制到知乎 ↗' }).click();
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible();
  expect(uploads).toBe(2);
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('jinzhang-transit-cache') || '{}');
    for (const record of Object.values(saved) as { expires: number }[]) record.expires = 0;
    localStorage.setItem('jinzhang-transit-cache', JSON.stringify(saved));
  });
  await page.reload();
  await page.getByRole('button', { name: '复制到知乎 ↗' }).click();
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible();
  expect(uploads).toBe(3);
  await editor.click();
  await expect(editor).toHaveCSS('outline-style', 'none');
  await page.getByRole('textbox', { name: '文章标题' }).click();
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveCSS('outline-style', 'none');
  expect(await page.locator('.preview-paper').evaluate((el) => el.clientWidth)).toBeGreaterThan(
    375,
  );
  await page.getByRole('button', { name: '手机', exact: true }).click();
  expect(await page.locator('.preview-paper').evaluate((el) => el.clientWidth)).toBe(375);
});
test.beforeEach(async ({ page }) => {
  await page.route('**/api/transit/sign', (route) =>
    route.fulfill({
      json: {
        url: 'https://oss.example.test/upload',
        fields: { key: 'image.png' },
        ticket: 'test',
      },
    }),
  );
  await page.route('https://oss.example.test/upload', (route) =>
    route.fulfill({ status: 201, body: '' }),
  );
  await page.route('**/api/transit/complete', (route) =>
    route.fulfill({ json: { url: 'https://oss.example.test/read?signature=test' } }),
  );
});
test('更多菜单按惯例关闭，后台上传不阻塞公众号或已删图的文章', async ({ page }) => {
  await page.goto('/format');
  const editor = page.getByRole('textbox', { name: 'Markdown 原文' });
  const menu = page.locator('.workspace-menu');
  const trigger = menu.locator('summary');
  await trigger.click();
  await editor.click();
  await expect(menu).not.toHaveAttribute('open');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open');
  await expect(trigger).toBeFocused();

  let releaseUpload!: () => void;
  const waiting = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  let uploadStarted = false;
  let uploadFinished = false;
  await page.route('https://oss.example.test/upload', async (route) => {
    uploadStarted = true;
    await waiting;
    await route.fulfill({ status: 500, body: '' });
    uploadFinished = true;
  });
  await editor.fill('正文');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '＋ 插入图片' }).click();
  await (await chooser).setFiles(fixture);
  await expect.poll(() => uploadStarted).toBe(true);
  await expect(page.getByText('正在上传 1 张图片…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复制到公众号 ↗' }).click();
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible();
  await editor.fill('已删图片的正文');
  await page.getByRole('button', { name: '知乎', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制到知乎 ↗' })).toBeEnabled();
  await expect(page.getByText('正在上传 1 张图片…', { exact: true })).toHaveCount(0);
  releaseUpload();
  await expect.poll(() => uploadFinished).toBe(true);
  await expect(page.getByRole('button', { name: '重试上传' })).toHaveCount(0);
});
test('标题提取忽略代码，示例替换保留两个平台的个人设置', async ({ page }) => {
  await page.goto('/format');
  const editor = page.getByRole('textbox', { name: 'Markdown 原文' });
  const title = page.getByRole('textbox', { name: '文章标题' });
  await title.fill('保留的标题');
  await editor.fill('```sh\n# 代码注释\n```');
  await page.getByRole('button', { name: '用正文一级标题' }).click();
  await expect(page.getByRole('status')).toHaveText('没有找到正文一级标题。');
  await expect(title).toHaveValue('保留的标题');
  await editor.fill('```sh\n# 代码注释\n```\n\n# **真正**的标题');
  await page.getByRole('button', { name: '用正文一级标题' }).click();
  await expect(title).toHaveValue('真正的标题');
  await page.getByRole('button', { name: 'Mac', exact: true }).click();
  await page.getByText('编辑固定文案 ↗', { exact: true }).click();
  await page.getByRole('textbox', { name: '作者名', exact: true }).fill('公众号作者');
  await page.getByRole('checkbox', { name: '文章开头', exact: true }).check();
  await page.getByRole('button', { name: '知乎', exact: true }).click();
  await page.getByRole('textbox', { name: '作者名', exact: true }).fill('知乎作者');
  await page.getByText('···', { exact: true }).click();
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '载入示例', exact: true }).click();
  await expect(page.getByRole('button', { name: '知乎', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('textbox', { name: '作者名', exact: true })).toHaveValue('知乎作者');
  await expect(editor).toHaveValue(/把写作还给写作/);
  await page.getByRole('button', { name: '微信公众号', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mac', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('textbox', { name: '作者名', exact: true })).toHaveValue(
    '公众号作者',
  );
  await expect(page.getByRole('checkbox', { name: '文章开头', exact: true })).toBeChecked();
});
test('合集网址补全协议，无效输入就地反馈', async ({ page }) => {
  await page.goto('/format');
  await page.getByRole('textbox', { name: 'Markdown 原文' }).fill('正文');
  await page.getByRole('checkbox', { name: '文章结尾', exact: true }).check();
  await page.getByText('编辑固定文案 ↗', { exact: true }).click();
  const link = page.getByRole('textbox', { name: '合集链接' });
  await link.fill('javascript:alert(1)');
  await link.press('Tab');
  await expect(page.locator('#collection-error')).toHaveText('请输入有效的网页地址');
  await expect(link).toHaveAttribute('aria-invalid', 'true');
  await link.fill('example.com/collection');
  await link.press('Tab');
  await expect(page.locator('#collection-error')).toHaveCount(0);
  await expect(page.frameLocator('iframe').getByRole('link', { name: '继续阅读' })).toHaveAttribute(
    'href',
    'https://example.com/collection',
  );
});
test('补图、刷新恢复、真实富文本复制到两个平台、封面不进入正文', async ({ page }) => {
  await page.goto('/format');
  await page
    .getByRole('textbox', { name: 'Markdown 原文' })
    .fill('# 测试文章\n\n正文保留。\n\n![插图](./one/a.png)');
  await page.getByRole('button', { name: '用正文一级标题' }).click();
  await page.getByRole('button', { name: '复制到公众号 ↗' }).click();
  await expect(page.getByRole('button', { name: '请先补齐图片' })).toBeVisible();
  await expect(page.getByRole('button', { name: '补图', exact: true })).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '补图', exact: true }).click();
  await (await chooser).setFiles(fixture);
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue(/jz-local:\/\//);
  await expect(page.getByRole('button', { name: '复制到公众号 ↗' })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue(/jz-local:\/\//);
  await expect(
    page.frameLocator('iframe').getByRole('img', { name: '插图', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '复制到公众号 ↗' }).click();
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible();
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return (await items[0].getType('text/html')).text();
  });
  expect(html).toContain('data:image/');
  expect(html).toContain('正文保留');
  expect(html).not.toContain('文章封面');
  expect(html).not.toContain('测试文章');
  await page.getByRole('button', { name: '知乎', exact: true }).click();
  let uploads = 0;
  await page.route('**/api/transit/sign', (route) =>
    route.fulfill({
      json: {
        url: 'https://oss.example.test/upload',
        fields: { key: 'image.png' },
        ticket: 'test-ticket',
      },
    }),
  );
  await page.route('https://oss.example.test/upload', (route) => {
    uploads++;
    return route.fulfill({ status: 201, body: '' });
  });
  await page.route('**/api/transit/complete', (route) =>
    route.fulfill({ json: { url: 'https://oss.example.test/read?signature=test' } }),
  );
  await page.getByRole('button', { name: '复制到知乎 ↗' }).click();
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible();
  expect(uploads).toBe(0);
  const zhihu = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return (await items[0].getType('text/html')).text();
  });
  expect(zhihu).toContain('https://oss.example.test/read?signature=test');
  expect(zhihu).not.toContain('style=');
});
test('两平台预览、移动布局和清除只作用于当前站点数据', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /让文字，.*锦绣成章/ })).toBeVisible();
  await page.getByRole('link', { name: '打开在线排版' }).click();
  await page.getByText('···', { exact: true }).click();
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: '01 让内容，回到中心' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mac', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('pre')).toHaveCSS(
    'background-color',
    'rgb(40, 45, 53)',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '排版设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭设置 ×' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '关闭设置 ×' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '排版设置', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '排版设置', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置 ×' }).click();
  await page.getByText('···', { exact: true }).click();
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '清除本地数据', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue('');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue('');
});

test('剪贴板权限失败后复用已上传图片，重试不会重复上传', async ({ page }) => {
  await page.goto('/format');
  await page.getByRole('textbox', { name: 'Markdown 原文' }).fill('正文');
  let uploads = 0;
  await page.route('**/api/transit/sign', (route) =>
    route.fulfill({
      json: { url: 'https://oss.example.test/upload', fields: { key: 'x' }, ticket: 'ticket' },
    }),
  );
  await page.route('https://oss.example.test/upload', (route) => {
    uploads++;
    return route.fulfill({ status: 201, body: '' });
  });
  await page.route('**/api/transit/complete', (route) =>
    route.fulfill({ json: { url: 'https://oss.example.test/read' } }),
  );
  await page.locator('input[type=file]').setInputFiles([fixture, fixture]);
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue(/jz-local/);
  await page.getByRole('button', { name: '知乎', exact: true }).click();
  await page.evaluate(() => {
    const original = navigator.clipboard.write.bind(navigator.clipboard);
    let calls = 0;
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: (data: ClipboardItems) =>
        ++calls === 1
          ? Promise.reject(new DOMException('Denied', 'NotAllowedError'))
          : original(data),
    });
  });
  await page.getByRole('button', { name: '复制到知乎 ↗' }).click();
  await expect(page.getByText('未能写入剪贴板', { exact: true })).toBeVisible();
  expect(uploads).toBe(1);
  await page.getByRole('button', { name: '重试复制', exact: true }).click();
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible();
  expect(uploads).toBe(1);
});
test('快速改稿不显示旧稿，脚本不执行，手动复制不含标题封面', async ({ page }) => {
  await page.goto('/format');
  const input = page.getByRole('textbox', { name: 'Markdown 原文' });
  await input.fill('# 旧稿');
  await input.fill(
    '# 最新稿\n\n<script>parent.__unsafe=true</script>\n\n正文 <img src="x" onerror="parent.__unsafe=true">',
  );
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '最新稿' })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__unsafe'))).toBeUndefined();
  await input.fill('可以手动复制的正文');
  await page.getByRole('textbox', { name: '文章标题' }).fill('不要复制这个标题');
  await page.evaluate(() =>
    Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: undefined }),
  );
  await page.getByRole('button', { name: '复制到公众号 ↗' }).click();
  await expect(page.getByText('未能写入剪贴板', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '手动复制' }).click();
  await expect
    .poll(() =>
      page
        .frameLocator('iframe')
        .locator('article')
        .evaluate(() => window.getSelection()?.toString()),
    )
    .toBe('可以手动复制的正文');
});

test('粘贴 SVG 可栅格化，复制体积使用实际载荷', async ({ page }) => {
  await page.goto('/format');
  await page.getByRole('textbox', { name: 'Markdown 原文' }).fill('图片测试');
  await page.getByRole('textbox', { name: 'Markdown 原文' }).evaluate((el) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#ac493a"/></svg>';
    const dt = new DataTransfer();
    dt.items.add(new File([svg], 'vector.svg', { type: 'image/svg+xml' }));
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  });
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue(/jz-local/);
  await page.getByRole('button', { name: '复制到公众号 ↗' }).click();
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const size = await page.evaluate(
    async () => (await (await navigator.clipboard.read())[0].getType('text/html')).size,
  );
  expect(size).toBeGreaterThan(100);
});

test('插图立即上传，编辑不被阻塞，远程图片失败有轻提示', async ({ page }) => {
  await page.goto('/format');
  const editor = page.getByRole('textbox', { name: 'Markdown 原文' });
  await editor.fill('旧稿');
  let uploaded = 0;
  await page.route('https://oss.example.test/upload', async (route) => {
    uploaded++;
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ status: 201, body: '' });
  });
  await page.locator('input[type=file]').setInputFiles(fixture);
  await expect(editor).toHaveValue(/jz-local/);
  await expect.poll(() => uploaded).toBe(1);
  await editor.fill('新稿');
  await expect(page.frameLocator('iframe').locator('article')).toContainText('新稿');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.route('https://remote.example.test/image.png', (route) => route.abort());
  await editor.fill('![远程](https://remote.example.test/image.png)');
  await page.getByRole('button', { name: '复制到公众号 ↗' }).click();
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible();
  await expect(page.locator('.toast')).toContainText('远程图片未能处理');
});
test('损坏的本地数据不会被页面加载静默覆盖', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('jinzhang.document.v1', '{broken-json'));
  await page.goto('/format');
  await expect(page.getByRole('status')).toContainText('本地存储不可用');
  expect(await page.evaluate(() => localStorage.getItem('jinzhang.document.v1'))).toBe(
    '{broken-json',
  );
});

test('十张透明图片形成约 5 MB 富文本载荷，Chrome 剪贴板保留全部图片', async ({ page }) => {
  await page.goto('/format');
  await page.getByRole('textbox', { name: 'Markdown 原文' }).fill('大体积图片测试');
  await page.getByRole('textbox', { name: 'Markdown 原文' }).evaluate(async (el) => {
    const dt = new DataTransfer();
    for (let i = 0; i < 10; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 350;
      canvas.height = 350;
      const ctx = canvas.getContext('2d')!;
      const pixels = ctx.createImageData(350, 350);
      for (let offset = 0; offset < pixels.data.length; offset += 65536)
        crypto.getRandomValues(
          pixels.data.subarray(offset, Math.min(offset + 65536, pixels.data.length)),
        );
      for (let alpha = 3; alpha < pixels.data.length; alpha += 4) pixels.data[alpha] = 128;
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );
      dt.items.add(new File([blob], `large-${i}.png`, { type: 'image/png' }));
    }
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  });
  await expect
    .poll(
      async () =>
        (
          (await page.getByRole('textbox', { name: 'Markdown 原文' }).inputValue()).match(
            /jz-local:/g,
          ) || []
        ).length,
    )
    .toBe(10);
  await page.getByRole('button', { name: '复制到公众号 ↗' }).click();
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible({ timeout: 25_000 });
  const payload = await page.evaluate(async () => {
    const data = await navigator.clipboard.read();
    const blob = await data[0].getType('text/html');
    const html = await blob.text();
    return { size: blob.size, count: (html.match(/data:image\/png;base64/g) || []).length };
  });
  console.log('large clipboard payload', payload);
  expect(payload.count).toBe(10);
  expect(payload.size).toBeGreaterThan(4 * 1024 * 1024);
  expect(payload.size).toBeLessThan(8 * 1024 * 1024);
});

test('旧复制任务晚失败不能覆盖新任务进度', async ({ page }) => {
  await page.goto('/format');
  await page.evaluate(() => {
    let calls = 0;
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: () => {
        const call = ++calls;
        return new Promise<void>((resolve, reject) => {
          window.addEventListener(
            `finish-copy-${call}`,
            () => {
              if (call === 1) reject(new DOMException('Denied', 'NotAllowedError'));
              else resolve();
            },
            { once: true },
          );
        });
      },
    });
  });
  const editor = page.getByRole('textbox', { name: 'Markdown 原文' });
  const copy = page.getByRole('button', { name: '复制到公众号 ↗' });
  await editor.fill('旧稿');
  await copy.click();
  await editor.fill('新稿');
  await expect(page.frameLocator('iframe').locator('article')).toContainText('新稿');
  await copy.click();
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('finish-copy-1'));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(page.getByRole('button', { name: '正在复制…' })).toBeDisabled();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('finish-copy-2')));
  await expect(page.getByRole('button', { name: '已复制 ✓' })).toBeVisible();
});
