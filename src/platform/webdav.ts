import { NativeModules, Platform } from 'react-native';
import { MAX_DAV_BYTES, type DavResponse, type DavTransport } from '../sync/webdav.ts';

let requestSequence = 0;
const native = NativeModules.KryptosWebDav as {
  request: (id: string, url: string, method: string, headers: Record<string, string>, body: string | null) => Promise<DavResponse>;
  cancel: (id: string) => void;
} | undefined;

export const webDavTransport: DavTransport = async (url, method, headers, body, signal) => {
  const controller = new AbortController();
  const id = String(++requestSequence);
  const cancel = () => { controller.abort(); native?.cancel(id); };
  signal.addEventListener('abort', cancel);
  const timer = setTimeout(cancel, 30_000);
  try {
    if (signal.aborted) throw new Error('WebDAV sync cancelled.');
    if (Platform.OS === 'android') {
      if (!native) throw new Error('Rebuild the Android app to enable WebDAV.');
      return await native.request(id, url, method, headers, body ?? null);
    }
    const response = await fetch(url, { method, headers, body, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
    if (Number(response.headers.get('Content-Length')) > MAX_DAV_BYTES) throw new Error('WebDAV response is too large.');
    // Browser streams let us enforce the limit before allocating the entire response.
    const reader = response.body?.getReader();
    let text = '';
    if (reader) {
      const decoder = new TextDecoder();
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_DAV_BYTES) { await reader.cancel(); throw new Error('WebDAV response is too large.'); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = await response.text();
    }
    return { status: response.status, body: text, etag: response.headers.get('ETag') ?? undefined };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
};
