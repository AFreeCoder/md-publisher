import type {
  AssetResolver,
  ResolvedAsset,
  NormalizedImage,
  NormalizeProfile,
  ImageCodec,
} from './types';
export const DATABASE = 'jinzhang-assets';
export const MAX_INPUT_BYTES = 12 * 1024 * 1024;
export async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function request<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export class BrowserAssetResolver implements AssetResolver {
  private connection?: Promise<IDBDatabase>;
  private open() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DATABASE, 1);
      req.onupgradeneeded = () => {
        for (const name of ['refs', 'blobs']) req.result.createObjectStore(name);
      };
      req.onerror = () => {
        this.connection = undefined;
        reject(req.error);
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => {
          req.result.close();
          this.connection = undefined;
        };
        resolve(req.result);
      };
    }));
  }
  async add(blob: Blob, originalRef?: string) {
    if (!blob.size || blob.size > MAX_INPUT_BYTES) throw new Error('图片必须小于 12 MB。');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = await digest(bytes);
    const id = crypto.randomUUID();
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['refs', 'blobs'], 'readwrite');
      tx.objectStore('blobs').put(blob, hash);
      tx.objectStore('refs').put(hash, `jz-local://${id}`);
      if (originalRef) tx.objectStore('refs').put(hash, originalRef);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return `jz-local://${id}`;
  }
  async get(ref: string) {
    const db = await this.open();
    const tx = db.transaction(['refs', 'blobs'], 'readonly');
    const hash = await request(tx.objectStore('refs').get(ref));
    return hash ? await request<Blob | undefined>(tx.objectStore('blobs').get(hash)) : undefined;
  }
  async resolve(ref: string): Promise<ResolvedAsset> {
    if (/^https?:\/\//i.test(ref)) {
      try {
        const url = new URL(ref);
        if (url.username || url.password) throw new Error();
        return { kind: 'remote', url: url.href };
      } catch {
        return { kind: 'missing', reason: '图片地址无效' };
      }
    }
    if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(ref)) {
      try {
        const encoded = ref.slice(ref.indexOf(',') + 1);
        if (encoded.length > MAX_INPUT_BYTES * 1.4) throw new Error();
        const binary = atob(encoded);
        return {
          kind: 'data',
          bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0)),
          mime: ref.slice(5, ref.indexOf(';')),
        };
      } catch {
        return { kind: 'missing', reason: '内嵌图片无效或超过 12 MB' };
      }
    }
    const blob = await this.get(ref);
    if (blob)
      return {
        kind: 'blob',
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: blob.type,
        assetId: ref,
      };
    return { kind: 'missing', reason: '浏览器无法读取此图片，请选择对应的本地文件。' };
  }
  async clear() {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['refs', 'blobs'], 'readwrite');
      tx.objectStore('refs').clear();
      tx.objectStore('blobs').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
async function decodeImage(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error('图片超过 12 MB，请压缩后重试。');
  const text = new TextDecoder().decode(bytes.slice(0, 8192));
  const svg = /<svg[\s>]/i.test(text);
  if (
    svg &&
    /<script|foreignObject|\son\w+\s*=|(?:href|url)\s*[=(]\s*["']?(?:https?:|\/\/)/i.test(text)
  )
    throw new Error('SVG 含外部资源或活动内容，请先导出 PNG。');
  const blob = new Blob([new Uint8Array(bytes)], { type: svg ? 'image/svg+xml' : '' });
  try {
    return await createImageBitmap(blob);
  } catch {
    if (!svg) throw new Error('图片无法解码，请换用 PNG、JPEG 或 WebP 图片。');
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return await createImageBitmap(image);
    } catch {
      throw new Error('SVG 无法栅格化，请先导出 PNG。');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
function imageMetadata(bytes: Uint8Array) {
  const header = new TextDecoder('latin1').decode(bytes);
  const animated =
    header.startsWith('GIF') || (header.startsWith('RIFF') && header.includes('ANIM'));
  const mime = header.startsWith('GIF')
    ? 'image/gif'
    : header.startsWith('RIFF')
      ? 'image/webp'
      : bytes[0] === 137
        ? 'image/png'
        : bytes[0] === 255
          ? 'image/jpeg'
          : /<svg[\s>]/i.test(header.slice(0, 8192))
            ? 'image/svg+xml'
            : 'application/octet-stream';
  return { mime, animated };
}
export class CanvasImageCodec implements ImageCodec {
  async probe(bytes: Uint8Array) {
    const bitmap = await decodeImage(bytes);
    try {
      if (bitmap.width * bitmap.height > 40_000_000)
        throw new Error('图片像素过大，请缩小后重试。');
      return { ...imageMetadata(bytes), width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  async normalize(bytes: Uint8Array, profile: NormalizeProfile): Promise<NormalizedImage> {
    const { animated } = imageMetadata(bytes);
    const bitmap = await decodeImage(bytes);
    try {
      if (bitmap.width * bitmap.height > 40_000_000)
        throw new Error('图片像素过大，请缩小后重试。');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('浏览器不支持图片处理。');
      let transparent = false;
      for (const scale of [1, 0.8, 0.6, 0.4, 0.25, 0.15]) {
        const ratio = Math.min(1, profile.maxEdge / Math.max(bitmap.width, bitmap.height)) * scale;
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (scale === 1) {
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 3; i < pixels.length; i += 4)
            if (pixels[i] !== 255) {
              transparent = true;
              break;
            }
        }
        const mime = transparent ? 'image/png' : 'image/jpeg';
        for (const quality of transparent ? [1] : [0.9, 0.8, 0.65, 0.5]) {
          const output = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('图片编码失败'))),
              mime,
              quality,
            ),
          );
          if (output.size <= profile.maxBytes)
            return {
              bytes: new Uint8Array(await output.arrayBuffer()),
              mime,
              width: canvas.width,
              height: canvas.height,
              animated,
            };
        }
      }
      throw new Error('图片压缩后仍超过大小限制，请手动缩小后重试。');
    } finally {
      bitmap.close();
    }
  }
}
export function dataUrl(bytes: Uint8Array, mime: string) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
