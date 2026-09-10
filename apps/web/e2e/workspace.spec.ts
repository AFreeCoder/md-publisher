import { test, expect } from '@playwright/test';
import path from 'node:path';
const fixture = path.resolve('fixtures/sample.png');
test('补图、刷新恢复、真实富文本复制到两个平台、封面不进入正文', async ({ page }) => {
  await page.goto('/format');
  await page
    .getByRole('textbox', { name: 'Markdown 原文' })
    .fill('# 测试文章\n\n正文保留。\n\n![插图](./one/a.png)');
  await page.getByRole('button', { name: '用正文一级标题' }).click();
  await expect(page.getByRole('button', { name: '补充图片 ↗' })).toBeVisible();
  await page.getByRole('button', { name: '补充图片 ↗' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '选择文件', exact: true }).click();
  await (await chooser).setFiles(fixture);
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue(/jz-local:\/\//);
  await expect(page.getByRole('button', { name: '复制到公众号 ↗' })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue(/jz-local:\/\//);
  await expect(
    page.frameLocator('iframe').getByRole('img', { name: '插图', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '复制到公众号 ↗' }).click();
  await expect(page.getByRole('heading', { name: '正文已复制' })).toBeVisible();
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return (await items[0].getType('text/html')).text();
  });
  expect(html).toContain('data:image/');
  expect(html).toContain('正文保留');
  expect(html).not.toContain('文章封面');
  expect(html).not.toContain('测试文章');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
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
  await expect(page.getByRole('heading', { name: '复制前，确认图片中转' })).toBeVisible();
  expect(uploads).toBe(0);
  await page.getByRole('button', { name: '上传并复制', exact: true }).click();
  await expect(page.getByRole('heading', { name: '正文已复制' })).toBeVisible();
  expect(uploads).toBe(1);
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
  await page.getByRole('button', { name: '关闭设置 ×' }).click();
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '清除本地数据', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue('');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue('');
});

test('剪贴板权限失败后复用已上传图片，重试不会重复上传', async ({ page }) => {
  await page.goto('/format');
  await page.getByRole('textbox', { name: 'Markdown 原文' }).fill('正文');
  await page.locator('input[type=file]').setInputFiles([fixture, fixture]);
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue(/jz-local/);
  await page.getByRole('button', { name: '知乎', exact: true }).click();
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
  await page.getByRole('button', { name: '上传并复制', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已准备，可重试复制' })).toBeVisible();
  expect(uploads).toBe(1);
  await page.getByRole('button', { name: '重新复制', exact: true }).click();
  await expect(page.getByRole('heading', { name: '正文已复制' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '已准备，可重试复制' })).toBeVisible();
  await page.getByRole('button', { name: '全选预览区正文' }).click();
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
  await expect(page.getByRole('heading', { name: '正文已复制' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('剪贴板实际体积');
});

test('处理中改稿作废旧上传，远程图片失败有明确降级提醒', async ({ page }) => {
  await page.goto('/format');
  await page.getByRole('textbox', { name: 'Markdown 原文' }).fill('旧稿');
  await page.locator('input[type=file]').setInputFiles(fixture);
  await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue(/jz-local/);
  await page.getByRole('button', { name: '知乎', exact: true }).click();
  let requested = false;
  await page.route('**/api/transit/sign', async (route) => {
    requested = true;
    await new Promise((r) => setTimeout(r, 1500));
    await route
      .fulfill({ json: { url: 'https://oss.example.test/upload', fields: {}, ticket: 'ticket' } })
      .catch(() => {});
  });
  let uploads = 0;
  await page.route('https://oss.example.test/upload', (route) => {
    uploads++;
    return route.fulfill({ status: 201, body: '' });
  });
  await page.getByRole('button', { name: '复制到知乎 ↗' }).click();
  await page.getByRole('button', { name: '上传并复制', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: '后台继续' }).click();
  await page.getByRole('textbox', { name: 'Markdown 原文' }).fill('新稿');
  await expect(page.frameLocator('iframe').locator('article')).toContainText('新稿');
  expect(uploads).toBe(0);
  await page.getByRole('button', { name: '微信公众号', exact: true }).click();
  await page.route('https://remote.example.test/image.png', (r) => r.abort());
  await page
    .getByRole('textbox', { name: 'Markdown 原文' })
    .fill('![远程](https://remote.example.test/image.png)');
  await page.getByRole('button', { name: '复制到公众号 ↗' }).click();
  await expect(page.getByRole('heading', { name: '正文已复制' })).toBeVisible();
  await expect(page.locator('.notice')).toContainText('远程图片未能处理');
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
  await expect(page.getByRole('heading', { name: '正文已复制' })).toBeVisible({ timeout: 25_000 });
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
  await page.getByRole('button', { name: '后台继续' }).click();
  await editor.fill('新稿');
  await expect(page.frameLocator('iframe').locator('article')).toContainText('新稿');
  await copy.click();
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('finish-copy-1'));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(copy).toBeDisabled();
  await expect(page.getByRole('dialog')).not.toContainText('文章或设置已变化');
  await page.evaluate(() => window.dispatchEvent(new Event('finish-copy-2')));
  await expect(page.getByRole('heading', { name: '正文已复制' })).toBeVisible();
});
