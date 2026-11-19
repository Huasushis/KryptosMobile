import { bytesToBase64, utf8Bytes } from '../kryptos/bytes.ts';
import { exportEntriesBase64Async, importEntriesBase64Async, normalizedIdentityKey, type AccountEntry } from '../kryptos/manager.ts';
import type { KryptosCipherOptions } from '../kryptos/crypto.ts';

export interface WebDavConfig {
  url: string;
  directory: string;
  username: string;
  password: string;
}

export interface DavResponse {
  status: number;
  body: string;
  etag?: string;
}

export type DavTransport = (url: string, method: string, headers: Record<string, string>, body: string | undefined, signal: AbortSignal) => Promise<DavResponse>;
export const MAX_DAV_BYTES = 2_000_000;
export const SYNC_FILENAME = 'kryptos-sync.txt';

export function davPaths(config: WebDavConfig): { directories: string[]; file: string } {
  const base = new URL(config.url.trim());
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('Use an HTTP(S) WebDAV URL without credentials, query or fragment.');
  }
  const parts = config.directory.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/.test(part))) {
    throw new Error('Specify a sync directory, for example Kryptos or Backups/Kryptos.');
  }
  if (config.username.includes(':')) throw new Error('WebDAV username cannot contain a colon.');
  let path = base.href.replace(/\/+$/, '');
  const directories = parts.map((part) => (path += `/${encodeURIComponent(part)}`) + '/');
  return { directories, file: `${path}/${SYNC_FILENAME}` };
}

export function mergeForSync(local: readonly AccountEntry[], remote: readonly AccountEntry[]): AccountEntry[] {
  const merged = [...local];
  const seen = new Map(local.map((entry) => [normalizedIdentityKey(entry), entry]));
  for (const entry of remote) {
    const key = normalizedIdentityKey(entry);
    const previous = seen.get(key);
    if (previous) {
      if (previous.webname !== entry.webname || previous.username !== entry.username || previous.uuid !== entry.uuid || previous.length !== entry.length || previous.charsetPreset !== entry.charsetPreset) {
        throw new Error('Sync conflict: the same site/account has different password generation data. Resolve using encrypted backup import before syncing.');
      }
    } else {
      merged.push(entry);
      seen.set(key, entry);
    }
  }
  return merged;
}

export async function syncWebDav(options: {
  config: WebDavConfig;
  entries: readonly AccountEntry[];
  backupPassword: string;
  nonce: () => Promise<Uint8Array>;
  transport: DavTransport;
  signal: AbortSignal;
  cipherOptions?: KryptosCipherOptions;
}): Promise<AccountEntry[]> {
  const { config, backupPassword, signal } = options;
  if (!backupPassword) throw new Error('A separate backup password is required for sync.');
  const paths = davPaths(config);
  const authorization = `Basic ${bytesToBase64(utf8Bytes(`${config.username}:${config.password}`))}`;
  const active = () => { if (signal.aborted) throw new Error('WebDAV sync cancelled.'); };
  async function request(url: string, method: string, headers: Record<string, string> = {}, body?: string): Promise<DavResponse> {
    active();
    const response = await options.transport(url, method, { Authorization: authorization, ...headers }, body, signal);
    active();
    if (utf8Bytes(response.body).length > MAX_DAV_BYTES) throw new Error('WebDAV response is too large.');
    if (response.status === 401 || response.status === 403) throw new Error('WebDAV authentication or permission denied.');
    return response;
  }
  for (const directory of paths.directories) {
    const made = await request(directory, 'MKCOL');
    if (made.status === 405) {
      const existing = await request(directory, 'PROPFIND', { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' }, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>');
      if (existing.status !== 207 || !/<(?:[\w.-]+:)?collection(?:\s|\/|>)/.test(existing.body)) {
        throw new Error('The WebDAV sync path is not an accessible directory.');
      }
    } else if (made.status !== 201) {
      throw new Error(`Cannot create WebDAV directory (HTTP ${made.status}).`);
    }
  }
  const remote = await request(paths.file, 'GET');
  let merged = [...options.entries];
  let condition: Record<string, string>;
  if (remote.status === 404) {
    condition = { 'If-None-Match': '*' };
  } else if (remote.status === 200) {
    if (!remote.etag || !/^"[^"\r\n]*"$/.test(remote.etag)) throw new Error('WebDAV must provide a strong ETag for safe sync.');
    const incoming = await importEntriesBase64Async(remote.body, backupPassword, options.cipherOptions);
    active();
    merged = mergeForSync(merged, incoming);
    condition = { 'If-Match': remote.etag };
  } else {
    throw new Error(`Cannot read WebDAV backup (HTTP ${remote.status}).`);
  }
  const encrypted = await exportEntriesBase64Async(merged, backupPassword, await options.nonce(), options.cipherOptions);
  active();
  if (encrypted.length > MAX_DAV_BYTES) throw new Error('Encrypted sync backup is too large.');
  const uploaded = await request(paths.file, 'PUT', { ...condition, 'Content-Type': 'text/plain; charset=utf-8' }, encrypted);
  if (uploaded.status === 412) throw new Error('Remote data changed during sync. Retry to merge the latest version.');
  if (![200, 201, 204].includes(uploaded.status)) throw new Error(`Cannot write WebDAV backup (HTTP ${uploaded.status}).`);
  return merged;
}
