import OSS from 'ali-oss';
import {
  createTransitHandlers,
  TransitError,
  type TransitConfig,
  type ObjectStore,
} from './service';
function config(): TransitConfig {
  const values = {
    origin: process.env.JINZHANG_ORIGIN,
    bucket: process.env.OSS_BUCKET,
    region: process.env.OSS_REGION,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    ticketSecret: process.env.TRANSIT_TICKET_SECRET,
  };
  if (Object.values(values).some((v) => !v) || values.ticketSecret!.length < 32)
    throw new TransitError(
      503,
      'TRANSIT_NOT_CONFIGURED',
      '知乎图片中转尚未配置，请联系站点维护者。',
    );
  if (!/^[a-z0-9-]+$/.test(values.bucket!) || !/^\w[\w-]+$/.test(values.region!))
    throw new TransitError(503, 'TRANSIT_NOT_CONFIGURED', '图片中转配置无效。');
  return values as TransitConfig;
}
function store(c: TransitConfig): ObjectStore {
  const client = new OSS({
    region: `oss-${c.region}`,
    bucket: c.bucket,
    accessKeyId: c.accessKeyId,
    accessKeySecret: c.accessKeySecret,
    secure: true,
    authorizationV4: true,
    timeout: 20_000,
  });
  return {
    head: async (key) => {
      const r = await client.head(key);
      const headers = r.res.headers as Record<string, string>;
      return { size: Number(headers['content-length']), mime: String(headers['content-type']) };
    },
    get: async (key) => {
      const r = await client.get(key);
      return new Uint8Array(r.content as Buffer);
    },
    delete: async (key) => {
      await client.delete(key);
    },
    readUrl: (key, seconds) => client.signatureUrlV4('GET', seconds, {}, key),
  };
}
export const transit = createTransitHandlers(config, store);
