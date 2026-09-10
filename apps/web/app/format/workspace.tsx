'use client';
import Link from 'next/link';
import { moveRange, replaceEditorText, dropOffset, type EditRange } from '../../lib/editor';
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
  extractMarkdownTitle,
  type RenderResult,
  type PreparedArticle,
  type ImageRef,
  type ImageStore,
} from '@jinzhang/core';
import { previewDocument } from '@jinzhang/core/preview';
import { BrowserAssetResolver, CanvasImageCodec } from '@jinzhang/core/browser';
import {
  CopyImageStore,
  TaskVersion,
  writeClipboard,
  clearTransitCache,
  type CopyPayload,
} from '../../lib/clipboard';
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
type Modal = 'clear' | 'sample' | null;
export default function Workspace() {
  const [doc, setDoc] = useState<DocumentState>(freshDocument);
  const docRef = useRef(doc);
  const [ready, setReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState('正在恢复本地数据…');
  const [result, setResult] = useState<RenderResult>();
  const [preview, setPreview] = useState('');
  const [notice, setNotice] = useState('');
  const [mobilePreview, setMobilePreview] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<string[]>([]);
  const [uploadFailed, setUploadFailed] = useState<string[]>([]);
  const uploadGeneration = useRef(0);
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
  const pendingInsertions = useRef(new Set<EditRange>());
  const frame = useRef<HTMLIFrameElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const preparedCache = useRef<{ key: string; value: PreparedArticle } | undefined>(undefined);
  const urls = useRef<string[]>([]);
  const inputOnly = useRef(false);
  const fixed = doc.fixed[doc.platform];
  function update(change: Partial<DocumentState>, isInput = false) {
    if (change.markdown !== undefined)
      for (const range of pendingInsertions.current)
        moveRange(range, docRef.current.markdown, change.markdown);
    inputOnly.current = isInput;
    version.current.change();
    controller.current?.abort();
    setCopyPhase('idle');
    setMessage('');
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
        if (!live || token !== version.current.current()) {
          allocated.forEach(URL.revokeObjectURL);
          return;
        }
        const oldUrls = urls.current;
        urls.current = allocated;
        setTimeout(() => oldUrls.forEach(URL.revokeObjectURL), 1500);
        setResult(output);
        setPreview(previewDocument(output, html, { hideCover: true, date: config.date }));
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
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreMenu.current?.contains(event.target))
        moreMenu.current?.removeAttribute('open');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && moreMenu.current?.open) {
        moreMenu.current.removeAttribute('open');
        moreMenu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
  useEffect(() => {
    if (copyPhase !== 'success') return;
    const timer = setTimeout(() => setCopyPhase('idle'), 2500);
    return () => clearTimeout(timer);
  }, [copyPhase]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function uploadImages(refs: string[]) {
    const generation = uploadGeneration.current;
    setPendingUploads((old) => [...old, ...refs]);
    setUploadFailed((old) => old.filter((r) => !refs.includes(r)));
    const store = new CopyImageStore('zhihu', AbortSignal.timeout(60_000), () => {
      if (generation !== uploadGeneration.current) throw new Error('上传已取消');
    });
    for (const ref of refs) {
      try {
        const source = await resolver.current.resolve(ref);
        await store.put({ id: ref, original: ref, source } as ImageRef);
      } catch {
        if (generation === uploadGeneration.current)
          setUploadFailed((old) => [...new Set([...old, ref])]);
      } finally {
        setPendingUploads((old) => {
          const index = old.indexOf(ref);
          return index < 0 ? old : [...old.slice(0, index), ...old.slice(index + 1)];
        });
      }
    }
  }
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
    const range = { start: insertion.current[0], end: insertion.current[1] };
    pendingInsertions.current.add(range);
    try {
      const selected = Array.from(files);
      if (!selected.length) return;
      const refs: string[] = [];
      for (const file of binding ? selected.slice(0, 1) : selected) {
        await new CanvasImageCodec().probe(new Uint8Array(await file.arrayBuffer()));
        const ref = await resolver.current.add(file, binding);
        refs.push(ref);
      }
      if (!pendingInsertions.current.has(range)) return;
      pendingInsertions.current.delete(range);
      let markdown = docRef.current.markdown;
      if (binding) {
        // 只替换用户指定的引用，同名文件不自动关联。
        markdown = replaceImageReference(markdown, binding, refs[0]);
        preparedCache.current = undefined;
      } else {
        const { start, end } = range;
        const content = refs
          .map((ref, i) => `![${selected[i].name.replace(/[\[\]\n]/g, '')}](${ref})`)
          .join('\n');
        markdown = markdown.slice(0, start) + '\n' + content + '\n' + markdown.slice(end);
      }
      if (editor.current) replaceEditorText(editor.current, markdown);
      if (docRef.current.markdown !== markdown) update({ markdown });
      void uploadImages(refs);
      editor.current?.focus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片保存失败。');
    } finally {
      pendingInsertions.current.delete(range);
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
      const offset = dropOffset(event.currentTarget, event.clientX, event.clientY);
      insertion.current = [offset, offset];
      void insertFiles(event.dataTransfer.files);
    }
  }
  function loadExample() {
    pendingInsertions.current.clear();
    update({ markdown: sampleMarkdown, title: '把写作还给写作' });
    setNotice('已载入示例。也可以拖入自己的图片。');
    setModal(null);
  }
  function beginCopy() {
    if (!result || !doc.markdown.trim()) return;
    if (result.images.some((i) => i.source.kind === 'missing')) {
      document.querySelector('.missing-images')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    executeCopy();
  }
  function executeCopy() {
    if (!result) return;
    const token = version.current.current();
    const platform = doc.platform;
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
        setMessage('已复制');
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
          setMessage('未能写入剪贴板');
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
      setCopyPhase('idle');
      setNotice('按 ⌘C / Ctrl+C 复制');
    }, 100);
  }
  async function clearLocal() {
    pendingInsertions.current.clear();
    uploadGeneration.current++;
    version.current.change();
    controller.current?.abort();
    try {
      await resolver.current.clear();
      clearTransitCache();
      setUploadFailed([]);
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
  const referencedImages = new Set(result?.images.map((image) => image.original));
  const uploading = pendingUploads.filter((ref) => referencedImages.has(ref)).length;
  const currentUploadFailed = uploadFailed.filter((ref) => referencedImages.has(ref));
  const unique = (images: ImageRef[]) => [...new Map(images.map((i) => [i.original, i])).values()];
  return (
    <main id="format">
      <header className="work-header">
        <Link className="brand" href="/">
          <span className="seal">锦</span>锦章 <span className="workspace-title">在线排版</span>
        </Link>
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
          </div>
          <div className="toolbar-group">
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
              disabled={
                !result ||
                !doc.markdown.trim() ||
                busy ||
                (doc.platform === 'zhihu' && uploading > 0)
              }
              onClick={beginCopy}
            >
              {busy
                ? '正在复制…'
                : copyPhase === 'success'
                  ? '已复制 ✓'
                  : `复制到${titleFor(doc.platform)} ↗`}
            </button>
          </div>
        </div>
        <details className="workspace-menu" ref={moreMenu}>
          <summary aria-label="更多操作">···</summary>
          <nav onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>
            <button
              className="quiet"
              onClick={() => (doc.markdown ? setModal('sample') : loadExample())}
            >
              载入示例
            </button>
            <button className="quiet clear-button" onClick={() => setModal('clear')}>
              清除本地数据
            </button>
            <a
              href="https://github.com/AFreeCoder/jinzhang-md-publisher"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </nav>
        </details>
      </header>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {['ready', 'failed', 'stale'].includes(copyPhase) && (
        <div className="copy-error" role="status">
          <span>{message}</span>
          <button disabled={busy || !result} onClick={beginCopy}>
            重试复制
          </button>
          {copyPhase === 'ready' && <button onClick={() => void selectPreview()}>手动复制</button>}
          <button aria-label="关闭复制提示" onClick={() => setCopyPhase('idle')}>
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
              onClick={async () => {
                const token = version.current.current();
                try {
                  const title = await extractMarkdownTitle(doc.markdown);
                  if (token !== version.current.current()) return;
                  if (title) update({ title });
                  else setNotice('没有找到正文一级标题。');
                } catch {
                  if (token === version.current.current()) setNotice('未能读取标题，请重试。');
                }
              }}
            >
              用正文一级标题
            </button>
          </div>
          <div className="input-hint">标题仅用于预览。</div>
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
          {missing.length > 0 && (
            <div className="missing-images">
              {unique(missing).map((image) => (
                <div key={image.original}>
                  <span>{image.original}</span>
                  <button onClick={() => chooseFiles(image.original)}>补图</button>
                </div>
              ))}
            </div>
          )}
          {currentUploadFailed.length > 0 && (
            <div className="copy-error" role="status">
              <span>图片上传失败，本地图片已保留</span>
              <button onClick={() => void uploadImages(currentUploadFailed)}>重试上传</button>
            </div>
          )}
          <div className="input-bottom">
            <span>
              {uploading > 0
                ? `正在上传 ${uploading} 张图片…`
                : '图片可粘贴或拖入 · 上传后保留 7 天'}
            </span>
            <span>{result?.stats.visibleTextChars ?? 0} 可见字</span>
          </div>
        </section>
        <section className="preview-panel">
          <div className="panel-label">
            <span>
              成品预览 <span className="review-label"> / LIVE PREVIEW</span>
            </span>
            <div className="preview-modes" aria-label="预览宽度">
              <button aria-pressed={!mobilePreview} onClick={() => setMobilePreview(false)}>
                自适应
              </button>
              <button aria-pressed={mobilePreview} onClick={() => setMobilePreview(true)}>
                手机
              </button>
            </div>
          </div>
          <div className="preview-scroll">
            {doc.markdown ? (
              <div className={`preview-paper ${mobilePreview ? 'mobile-preview' : 'wide-preview'}`}>
                <iframe
                  ref={frame}
                  title="文章成品预览"
                  sandbox="allow-same-origin"
                  srcDoc={preview}
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
        </aside>
      </div>
      <div className="statusbar">
        <span>
          <b>●</b> {storageStatus}
        </span>
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
            <p>将替换当前文章，平台与排版设置保留。请先保留需要的原文。</p>
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
