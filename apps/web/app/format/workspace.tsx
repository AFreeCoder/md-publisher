'use client';
import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import {
  prepare,
  render,
  placeImages,
  themes,
  escapeHtml,
  replaceImageReference,
  type RenderResult,
  type PreparedArticle,
  type ImageRef,
  type ImageStore,
} from '@jinzhang/core';
import { previewDocument } from '@jinzhang/core/preview';
import { BrowserAssetResolver, CanvasImageCodec } from '@jinzhang/core/browser';
import { CopyImageStore, TaskVersion, writeClipboard, type CopyPayload } from '../../lib/clipboard';
import {
  freshDocument,
  restoreDocument,
  STORAGE_KEY,
  templates,
  sampleMarkdown,
  type DocumentState,
  type FixedContent,
} from '../../lib/document';
const titleFor = (p: string) => (p === 'wechat' ? '公众号' : '知乎');
type Modal = 'upload' | 'images' | 'cover' | 'clear' | 'copy' | 'sample' | null;
export default function Workspace() {
  const [doc, setDoc] = useState<DocumentState>(freshDocument);
  const docRef = useRef(doc);
  const [ready, setReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState('正在恢复本地数据…');
  const [result, setResult] = useState<RenderResult>();
  const [preview, setPreview] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [copyPhase, setCopyPhase] = useState<
    'idle' | 'working' | 'ready' | 'failed' | 'stale' | 'success'
  >('idle');
  const [copySize, setCopySize] = useState<number>();
  const allowSave = useRef(true);
  const skipSave = useRef(false);
  const resolver = useRef(new BrowserAssetResolver());
  const version = useRef(new TaskVersion());
  const controller = useRef<AbortController | undefined>(undefined);
  const currentJob = useRef<
    { version: number; payload: Promise<CopyPayload>; store: CopyImageStore } | undefined
  >(undefined);
  const editor = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<string | undefined>(undefined);
  const insertion = useRef<[number, number]>([0, 0]);
  const frame = useRef<HTMLIFrameElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const preparedCache = useRef<{ key: string; value: PreparedArticle } | undefined>(undefined);
  const urls = useRef<string[]>([]);
  const inputOnly = useRef(false);
  const fixed = doc.fixed[doc.platform];
  function update(change: Partial<DocumentState>, isInput = false) {
    inputOnly.current = isInput;
    version.current.change();
    controller.current?.abort();
    if (currentJob.current) {
      setCopyPhase('stale');
      setMessage('文章或设置已变化，请重新复制。');
    }
    currentJob.current = undefined;
    setCopySize(undefined);
    setBusy(false);
    setResult(undefined);
    const next = { ...docRef.current, ...change };
    docRef.current = next;
    setDoc(next);
  }
  function updateFixed(change: Partial<FixedContent>) {
    update({ fixed: { ...doc.fixed, [doc.platform]: { ...fixed, ...change } } });
  }
  useEffect(() => {
    try {
      const restored = restoreDocument(localStorage.getItem(STORAGE_KEY));
      docRef.current = restored;
      setDoc(restored);
      setStorageStatus('已恢复本浏览器内容');
    } catch {
      allowSave.current = false;
      setStorageStatus('无法恢复本地数据');
      setNotice('本地存储不可用或内容损坏，当前输入不会覆盖原数据。');
    }
    setReady(true);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!ready || !allowSave.current) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
      setStorageStatus('已保存在本浏览器');
    } catch {
      setStorageStatus('保存失败');
      setNotice('本地空间不足或存储不可用，请先保留原文。');
    }
  }, [doc, ready]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const token = version.current.current();
    const delay = inputOnly.current ? 300 : 0;
    inputOnly.current = false;
    const timer = setTimeout(async () => {
      const allocated: string[] = [];
      try {
        const config = { date: new Date().toLocaleDateString('sv-SE'), author: fixed.author };
        const input = { markdown: doc.markdown, title: doc.title, templates: templates(fixed) };
        const key = JSON.stringify([input, doc.platform, doc.cover, fixed, config]);
        let prepared =
          preparedCache.current?.key === key
            ? preparedCache.current.value
            : await prepare(input, {
                platform: doc.platform,
                fixed,
                cover: doc.cover || undefined,
                resolver: resolver.current,
                config,
                version: String(token),
              });
        preparedCache.current = { key, value: prepared };
        prepared = { ...prepared, version: String(token) };
        const output = render(prepared, { theme: doc.theme });
        const mapping: Record<string, string> = {};
        const store: ImageStore = {
          put: async (image) => {
            if (mapping[image.original]) return { src: mapping[image.original] };
            const s = image.source;
            let src = '';
            if (s.kind === 'blob' || s.kind === 'data') {
              src = URL.createObjectURL(new Blob([new Uint8Array(s.bytes)], { type: s.mime }));
              allocated.push(src);
            } else if (s.kind === 'remote' || s.kind === 'hosted') src = s.url;
            mapping[image.original] = src;
            return { src };
          },
        };
        const placed = await placeImages(output, store);
        let html = placed.html;
        for (const image of output.images.filter((i) => i.source.kind === 'missing'))
          html = html.replace(
            /<img\b[^>]*src=""[^>]*>/,
            `<section class="missing">图片缺失：${escapeHtml(image.original)}</section>`,
          );
        const selectedCover = output.cover
          ? await store.put(output.cover, { platform: doc.platform, role: 'cover' })
          : undefined;
        if (!live || token !== version.current.current()) {
          allocated.forEach(URL.revokeObjectURL);
          return;
        }
        const oldUrls = urls.current;
        urls.current = allocated;
        setTimeout(() => oldUrls.forEach(URL.revokeObjectURL), 1500);
        setCoverUrl(selectedCover?.src || '');
        setImageUrls(mapping);
        setResult(output);
        setPreview(
          previewDocument(output, html, { coverSrc: selectedCover?.src, date: config.date }),
        );
      } catch (error) {
        allocated.forEach(URL.revokeObjectURL);
        if (live && token === version.current.current())
          setNotice(error instanceof Error ? error.message : '排版失败，请检查原文。');
      }
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [doc, ready]);
  useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), []);
  useEffect(() => {
    if (modal) {
      priorFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      priorFocus.current?.focus();
    }
  }, [modal]);
  async function insertFiles(files: FileList | File[], binding?: string) {
    const token = version.current.current();
    try {
      const selected = Array.from(files);
      if (!selected.length) return;
      setNotice('正在读取图片…');
      const refs: string[] = [];
      for (const file of binding ? selected.slice(0, 1) : selected) {
        await new CanvasImageCodec().probe(new Uint8Array(await file.arrayBuffer()));
        const ref = await resolver.current.add(file, binding);
        refs.push(ref);
      }
      version.current.assert(token);
      let markdown = docRef.current.markdown;
      if (binding) {
        // 只替换用户指定的引用，同名文件不自动关联。
        markdown = replaceImageReference(markdown, binding, refs[0]);
        preparedCache.current = undefined;
      } else {
        const [start, end] = insertion.current;
        const content = refs
          .map((ref, i) => `![${selected[i].name.replace(/[\[\]\n]/g, '')}](${ref})`)
          .join('\n');
        markdown = markdown.slice(0, start) + '\n' + content + '\n' + markdown.slice(end);
      }
      update({
        markdown,
        cover: binding && docRef.current.cover === binding ? refs[0] : docRef.current.cover,
      });
      setNotice('图片已保存在本浏览器。');
      setModal(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片保存失败。');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
      replaceRef.current = undefined;
    }
  }
  function chooseFiles(binding?: string) {
    replaceRef.current = binding;
    insertion.current = [editor.current?.selectionStart || 0, editor.current?.selectionEnd || 0];
    fileInput.current?.click();
  }
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (event.clipboardData.files.length) {
      event.preventDefault();
      insertion.current = [event.currentTarget.selectionStart, event.currentTarget.selectionEnd];
      void insertFiles(event.clipboardData.files);
    }
  }
  function onDrop(event: DragEvent<HTMLTextAreaElement>) {
    if (event.dataTransfer.files.length) {
      event.preventDefault();
      insertion.current = [event.currentTarget.selectionStart, event.currentTarget.selectionEnd];
      void insertFiles(event.dataTransfer.files);
    }
  }
  function loadExample() {
    update({ ...freshDocument(), markdown: sampleMarkdown, title: '把写作还给写作' });
    setNotice('已载入示例。也可以拖入自己的图片。');
    setModal(null);
  }
  function beginCopy() {
    if (!result || !doc.markdown.trim()) return;
    if (result.images.some((i) => i.source.kind === 'missing')) {
      setModal('images');
      return;
    }
    if (
      doc.platform === 'zhihu' &&
      result.images.some((i) => i.source.kind === 'blob' || i.source.kind === 'data')
    ) {
      setModal('upload');
      return;
    }
    executeCopy();
  }
  function executeCopy() {
    if (!result) return;
    const token = version.current.current();
    const platform = doc.platform;
    setModal('copy');
    setBusy(true);
    setCopyPhase('working');
    setMessage('正在准备正文与图片…');
    let job = currentJob.current;
    if (!job || job.version !== token) {
      controller.current = new AbortController();
      const signal = AbortSignal.any([controller.current.signal, AbortSignal.timeout(60_000)]);
      const store = new CopyImageStore(
        platform,
        signal,
        () => version.current.assert(token),
        setMessage,
      );
      const payload = placeImages(result, store).then((p) => {
        version.current.assert(token);
        setCopySize(p.bytes);
        setMessage('正文已准备完成。');
        return p;
      });
      job = { version: token, payload, store };
      currentJob.current = job;
      payload.catch(() => {});
    }
    const selected = job;
    let writing: Promise<void>;
    try {
      writing = writeClipboard(selected.payload);
    } catch (error) {
      writing = Promise.reject(error);
    }
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('剪贴板写入超时，请重试。')), 20_000),
    );
    Promise.race([writing, timeout])
      .then(() => {
        version.current.assert(token);
        setCopyPhase('success');
        setMessage(
          `已复制，请到${titleFor(platform)}编辑器粘贴后核对。封面请在平台编辑器里单独设置。`,
        );
        if (selected.store.warnings.length)
          setNotice(selected.store.warnings.map((w) => w.message).join(' '));
        setBusy(false);
      })
      .catch(async () => {
        // 改稿时已同步提示任务失效；旧回调不能覆盖之后开始的新任务。
        if (token !== version.current.current()) return;
        try {
          await selected.payload;
          version.current.assert(token);
          setCopyPhase('ready');
          setMessage('已准备，可重试复制；图片不会重复上传。');
        } catch (problem) {
          if (token !== version.current.current()) return;
          currentJob.current = undefined;
          setCopyPhase('failed');
          setMessage(problem instanceof Error ? problem.message : '图片准备失败，请重试。');
        } finally {
          if (token === version.current.current()) setBusy(false);
        }
      });
  }
  async function selectPreview() {
    if (!result) return;
    let html = result.html;
    if (currentJob.current?.version === version.current.current()) {
      try {
        html = (await currentJob.current.payload).html;
      } catch {
        return;
      }
    } else {
      html = frame.current?.contentDocument?.querySelector('article')?.innerHTML || html;
    }
    setPreview(previewDocument(result, html, { bodyOnly: true }));
    setModal(null);
    setTimeout(() => {
      const d = frame.current?.contentDocument;
      const body = d?.querySelector('article');
      if (!d || !body) return;
      const range = d.createRange();
      range.selectNodeContents(body);
      const selection = d.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      frame.current?.focus();
      setNotice(
        '已选中预览正文，按 ⌘C / Ctrl+C 复制。手动复制是降级方式，请到平台核对格式与图片。',
      );
    }, 100);
  }
  async function clearLocal() {
    version.current.change();
    controller.current?.abort();
    try {
      await resolver.current.clear();
      localStorage.removeItem(STORAGE_KEY);
      allowSave.current = true;
      skipSave.current = true;
      preparedCache.current = undefined;
      currentJob.current = undefined;
      update(freshDocument());
      setNotice('已清除本浏览器的原文、图片与排版设置。');
      setModal(null);
    } catch {
      setNotice('清除失败，请检查浏览器存储权限。');
    }
  }
  const missing = result?.images.filter((i) => i.source.kind === 'missing') || [];
  const localImages = result?.images.filter((i) => ['blob', 'data'].includes(i.source.kind)) || [];
  const remoteImages =
    result?.images.filter((i) => ['remote', 'hosted'].includes(i.source.kind)) || [];
  const candidates =
    result?.images.filter((i) => !i.inFixedContent && i.source.kind !== 'missing') || [];
  const unique = (images: ImageRef[]) => [...new Map(images.map((i) => [i.original, i])).values()];
  return (
    <main id="format">
      <header className="work-header">
        <Link className="brand" href="/">
          <span className="seal">锦</span>锦章 <span className="workspace-title">在线排版</span>
        </Link>
        <nav>
          <small style={{ fontSize: 10 }}>◌ 正文在本地处理</small>
          <button className="quiet clear-button" onClick={() => setModal('clear')}>
            清除本地数据
          </button>
          <a
            className="github"
            href="https://github.com/AFreeCoder/jinzhang-md-publisher"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
      </header>
      <div className="toolbar">
        <div className="toolbar-group">
          <div className="segment">
            {(['wechat', 'zhihu'] as const).map((p) => (
              <button
                key={p}
                aria-pressed={doc.platform === p}
                className={doc.platform === p ? 'active' : ''}
                onClick={() => update({ platform: p })}
              >
                {p === 'wechat' ? '微信公众号' : '知乎'}
              </button>
            ))}
          </div>
          <div className="tool-divider" />
          <small style={{ fontSize: 11 }}>
            {doc.platform === 'wechat' ? '样式预览' : '结构预览'}
          </small>
        </div>
        <div className="toolbar-group">
          <button
            className="quiet"
            onClick={() => (doc.markdown ? setModal('sample') : loadExample())}
          >
            载入示例
          </button>
          <button
            className="settings-toggle"
            style={{ display: 'none' }}
            aria-expanded={settings}
            onClick={() => setSettings(!settings)}
          >
            排版设置
          </button>
          <button
            className="primary"
            disabled={!result || !doc.markdown.trim() || busy}
            onClick={beginCopy}
          >
            复制到{titleFor(doc.platform)} ↗
          </button>
        </div>
      </div>
      <div className="copy-summary">
        {doc.platform === 'wechat'
          ? `预计内嵌 ${localImages.length} 张 · 上传 0 张`
          : `内嵌 0 张 · 将上传 ${localImages.length} 张`}{' '}
        · {remoteImages.length} 个远程地址{doc.platform === 'wechat' ? '将尝试内嵌' : '将保留'}
        {missing.length > 0 && ` · ${missing.length} 张缺失待补齐`}
      </div>
      {(notice || missing.length > 0) && (
        <div className="notice" role="status">
          {missing.length > 0 ? `${missing.length} 张图片缺失，浏览器无法读取本地路径。` : notice}
          {missing.length > 0 && <button onClick={() => setModal('images')}>补充图片 ↗</button>}
          <button aria-label="关闭提示" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      <div className="workspace">
        <section className="input-panel">
          <div className="panel-label">
            <span>Markdown 原文</span>
            <button className="quiet" style={{ fontSize: 11 }} onClick={() => chooseFiles()}>
              ＋ 插入图片
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple={!replaceRef.current}
              hidden
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                if (e.target.files) void insertFiles(e.target.files, replaceRef.current);
              }}
            />
          </div>
          <div className="title-field">
            <input
              aria-label="文章标题"
              placeholder="输入文章标题"
              value={doc.title}
              onChange={(e) => update({ title: e.target.value }, true)}
            />
            <button
              onClick={() => {
                const match = doc.markdown.match(/^#\s+(.+)$/m);
                if (match) update({ title: match[1].trim() });
                else setNotice('没有找到正文一级标题。');
              }}
            >
              用正文一级标题
            </button>
          </div>
          <div className="input-hint">标题与封面仅用于预览，请在平台编辑器里单独设置。</div>
          <textarea
            ref={editor}
            className="editor"
            spellCheck={false}
            aria-label="Markdown 原文"
            placeholder={'在这里贴入 Markdown…\n\n也可以载入示例，或直接粘贴、拖入图片。'}
            value={doc.markdown}
            onChange={(e) => update({ markdown: e.target.value }, true)}
            onPaste={onPaste}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          />
          <div className="input-bottom">
            <span>支持粘贴 Markdown · 拖入或粘贴图片</span>
            <span>{result?.stats.visibleTextChars ?? 0} 可见字</span>
          </div>
        </section>
        <section className="preview-panel">
          <div className="panel-label">
            <span>
              成品预览 <span className="review-label"> / LIVE PREVIEW</span>
            </span>
            <small>375 px · 手机阅读</small>
          </div>
          <div className="preview-scroll">
            {doc.markdown ? (
              <div className="preview-paper">
                <iframe
                  ref={frame}
                  title="文章成品预览"
                  sandbox="allow-same-origin"
                  srcDoc={preview}
                  onLoad={() => {
                    const f = frame.current;
                    if (f?.contentDocument)
                      f.style.height = `${f.contentDocument.documentElement.scrollHeight}px`;
                  }}
                />
              </div>
            ) : (
              <div className="empty-state">
                在左侧贴入 Markdown
                <br />
                <small>成品会呈现在这里</small>
              </div>
            )}
          </div>
          <div className="preview-caption">
            {doc.platform === 'wechat'
              ? '公众号样式预览 · 粘贴后请在平台核对图片与格式'
              : '知乎结构预览 · 装饰样式将移除，最终外观以知乎为准'}
          </div>
        </section>
        <aside className={`settings ${settings ? 'open' : ''}`}>
          <button className="settings-close quiet" onClick={() => setSettings(false)}>
            关闭设置 ×
          </button>
          <div className="settings-section">
            <h3>
              排版主题 <span className="review-label">01</span>
            </h3>
            {doc.platform === 'wechat' ? (
              <div className="theme-options">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    className={`theme-option ${doc.theme === t.id ? 'active' : ''}`}
                    aria-pressed={doc.theme === t.id}
                    onClick={() => update({ theme: t.id })}
                  >
                    <i aria-hidden="true" style={{ color: t.accent }}>
                      文
                    </i>
                    {t.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="theme-disabled">
                知乎使用平台原生阅读样式。
                <br />
                仅预览标题、段落等内容结构。
              </div>
            )}
          </div>
          <div className="settings-section">
            <h3>
              固定内容 <span className="review-label">02</span>
            </h3>
            <label className="setting-line">
              文章开头
              <input
                className="switch"
                type="checkbox"
                checked={fixed.header}
                onChange={(e) => updateFixed({ header: e.target.checked })}
              />
            </label>
            <select
              aria-label="开头样式"
              value={fixed.headerStyle}
              onChange={(e) => updateFixed({ headerStyle: e.target.value })}
            >
              <option>简约署名</option>
              <option>留白分隔</option>
            </select>
            <label className="setting-line">
              文章结尾
              <input
                className="switch"
                type="checkbox"
                checked={fixed.footer}
                onChange={(e) => updateFixed({ footer: e.target.checked })}
              />
            </label>
            <select
              aria-label="结尾样式"
              value={fixed.footerStyle}
              onChange={(e) => updateFixed({ footerStyle: e.target.value })}
            >
              <option>一句寄语</option>
              <option>细线落款</option>
            </select>
            <details className="fixed-fields">
              <summary>编辑固定文案 ↗</summary>
              {(
                [
                  ['author', '作者名'],
                  ['slogan', '口号'],
                  ['closing', '结尾话术'],
                  ['collection', '合集链接'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="text"
                    value={fixed[key]}
                    placeholder={key === 'collection' ? 'https://…' : ''}
                    onChange={(e) => updateFixed({ [key]: e.target.value })}
                  />
                </label>
              ))}
            </details>
            <p>每个平台单独保存，仅样式与文案。</p>
          </div>
          <div className="settings-section">
            <h3>
              文章封面 <span className="review-label">03</span>
            </h3>
            {coverUrl ? (
              <img className="image-cover" alt="当前预览封面" src={coverUrl} />
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                未设置封面
              </div>
            )}
            <button
              className="cover-button"
              disabled={!candidates.length}
              onClick={() => setModal('cover')}
            >
              更换封面 ↗
            </button>
            <p>
              {doc.cover ? '已手动选择' : '默认使用正文首图'} · 只影响预览
              <br />
              复制正文时不包含封面。
            </p>
          </div>
          <div>
            <h3>复制前检查</h3>
            <p style={{ color: missing.length ? '#a47735' : '#73856a' }}>
              {missing.length
                ? `${missing.length} 张图片缺失`
                : `${result?.images.length || 0} 张正文图片`}
            </p>
            <p>
              {doc.platform === 'wechat'
                ? `预计内嵌 ${localImages.length} 张 · 上传 0 张`
                : `内嵌 0 张 · 将上传 ${localImages.length} 张`}
              <br />
              {remoteImages.length} 个远程地址{doc.platform === 'wechat' ? '将尝试内嵌' : ''}
            </p>
            {remoteImages.length > 0 && (
              <button className="quiet" onClick={() => setModal('images')}>
                核对或替换远程图片 ↗
              </button>
            )}
            <p>
              {doc.platform === 'wechat' && (
                <>
                  <span className={(result?.stats.htmlChars || 0) >= 20000 ? 'error-message' : ''}>
                    接口 HTML 预估：{result?.stats.htmlChars || 0} / 20,000 字符
                  </span>
                  <br />
                </>
              )}
              剪贴板：{copySize ? `${(copySize / 1024).toFixed(1)} KB` : '复制后显示实际体积'}
              <br />
              接口长度限制不用于剪贴板。
            </p>
            <div className="diagnostics">
              {[...(result?.warnings || []), ...(result?.degraded || [])]
                .filter((w) => w.code !== 'IMAGE_MISSING')
                .map((w, i) => (
                  <p key={i}>{w.message}</p>
                ))}
            </div>
          </div>
        </aside>
      </div>
      <div className="statusbar">
        <span>
          <b>●</b> {storageStatus}
        </span>
        <span>复制的是正文；标题、封面需在目标平台单独填写。</span>
        <span>JINZHANG / WEB</span>
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setModal(null)}
        className="modal"
        onClick={(e) => {
          if (e.target === dialog.current) setModal(null);
        }}
      >
        <div className="eyebrow">JINZHANG</div>
        {modal === 'upload' && (
          <>
            <h2>复制前，确认图片中转</h2>
            <p>
              为让知乎读取正文图片，本次将临时上传以下 {localImages.length}{' '}
              张图片。正文不会上传至锦章服务端。
            </p>
            <div className="image-list">
              {unique(localImages).map((i) => (
                <div className="image-item" key={i.id}>
                  <img src={imageUrls[i.original]} alt="待上传图片" />
                  <span>
                    {i.original}
                    <br />
                    {'bytes' in i.source
                      ? `${(i.source.bytes.length / 1024).toFixed(1)} KB 原图`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="modal-info">
              图片链接 7 天后失效。
              <br />
              中转图片按生命周期规则清理，不承诺到期即时删除。
            </div>
            <p>粘贴到知乎后，请等待图片转存完成并核对。</p>
            <div className="modal-actions">
              <button onClick={() => setModal(null)}>取消</button>
              <button className="primary" onClick={executeCopy}>
                上传并复制
              </button>
            </div>
          </>
        )}
        {modal === 'images' && (
          <>
            <h2>补齐文章里的图片</h2>
            <p>请选择每个引用对应的文件。相同文件名不会自动关联到其他目录。</p>
            <div className="image-list">
              {unique([...(result?.images || [])]).map((i) => (
                <div className="image-item" key={i.id}>
                  {imageUrls[i.original] && <img src={imageUrls[i.original]} alt="正文图片" />}
                  <span>
                    {i.original}
                    <br />
                    {i.source.kind === 'missing' ? '图片缺失' : '可替换为本地图片'}
                  </span>
                  <button onClick={() => chooseFiles(i.original)}>选择文件</button>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={() => setModal(null)}>完成</button>
            </div>
          </>
        )}
        {modal === 'cover' && (
          <>
            <h2>选择预览封面</h2>
            <p>仅影响预览；复制时不包含封面。</p>
            <div className="image-list">
              {unique(candidates).map((i) => (
                <button
                  className="image-item"
                  key={i.id}
                  onClick={() => {
                    update({ cover: i.original });
                    setModal(null);
                  }}
                >
                  <img src={imageUrls[i.original]} alt="封面候选" />
                  <span>{i.original}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button
                onClick={() => {
                  update({ cover: '' });
                  setModal(null);
                }}
              >
                恢复正文首图
              </button>
              <button onClick={() => setModal(null)}>取消</button>
            </div>
          </>
        )}
        {modal === 'copy' && (
          <>
            <h2>
              {copyPhase === 'success'
                ? '正文已复制'
                : copyPhase === 'ready'
                  ? '已准备，可重试复制'
                  : copyPhase === 'stale'
                    ? '请重新复制'
                    : '复制正文'}
            </h2>
            <p role="status">{message}</p>
            {copySize && (
              <p>
                剪贴板实际体积：{(copySize / 1024).toFixed(1)} KB
                <br />
                已内嵌 {currentJob.current?.store.counts.embedded || 0} 张 · 已上传{' '}
                {currentJob.current?.store.counts.uploaded || 0} 张 · 保留远程地址{' '}
                {currentJob.current?.store.counts.remote || 0} 个
              </p>
            )}
            {copyPhase === 'ready' && (
              <p>
                也可全选预览正文后按 ⌘C /
                Ctrl+C。此方式可能降级，请在平台核对格式与图片；纯文本不保留完整排版。
              </p>
            )}
            <div className="modal-actions">
              <button onClick={() => setModal(null)}>{busy ? '后台继续' : '关闭'}</button>
              {copyPhase === 'ready' && (
                <button onClick={() => void selectPreview()}>全选预览区正文</button>
              )}
              {['ready', 'failed', 'stale'].includes(copyPhase) && (
                <button
                  className="primary"
                  disabled={!result || busy}
                  onClick={copyPhase === 'stale' ? beginCopy : executeCopy}
                >
                  重新复制
                </button>
              )}
            </div>
          </>
        )}
        {modal === 'clear' && (
          <>
            <h2>清除本浏览器的数据？</h2>
            <p>删除此浏览器保存的原文、图片与排版设置，不影响平台里的内容。此操作不能撤销。</p>
            <div className="modal-actions">
              <button onClick={() => setModal(null)}>取消</button>
              <button className="primary" onClick={() => void clearLocal()}>
                清除本地数据
              </button>
            </div>
          </>
        )}
        {modal === 'sample' && (
          <>
            <h2>用示例替换当前原文？</h2>
            <p>当前原文与排版设置会被替换，请先保留需要的内容。</p>
            <div className="modal-actions">
              <button onClick={() => setModal(null)}>取消</button>
              <button className="primary" onClick={loadExample}>
                载入示例
              </button>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
