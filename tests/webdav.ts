import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { davPaths, mergeForSync, planSyncMerge, resolveSyncMerge, syncWebDav, type DavTransport, type WebDavConfig } from '../src/sync/webdav.ts';
import { reviewSyncConflicts } from '../src/sync/review.ts';
import { accountEntryToVaultEntry, syncAccountsToVaultEntries } from '../src/vault/model.ts';
import { exportEntriesBase64Async, importEntriesBase64Async, type AccountEntry } from '../src/kryptos/manager.ts';

const cipherOptions = { kdfIterations: 32, yieldEveryIterations: 4 };
const local: AccountEntry = { webname: 'local.example', username: 'alice', uuid: 'local-uuid', length: 16, charsetPreset: 'full' };
const remote: AccountEntry = { ...local, webname: 'remote.example', username: 'bob', uuid: 'remote-uuid' };
const config: WebDavConfig = { url: 'https://dav.example/dav/', directory: 'Backups/My vault', username: 'user', password: 'token' };
assert.equal(davPaths(config).file, 'https://dav.example/dav/Backups/My%20vault/kryptos-sync.txt');
for (const directory of ['', '../escape', 'a/./b', 'bad\\path']) assert.throws(() => davPaths({ ...config, directory }));
for (const url of ['file:///bad', 'https://user:pass@dav.example/', 'https://dav.example/?x=1']) assert.throws(() => davPaths({ ...config, url }));
assert.throws(() => mergeForSync([local], [{ ...local, uuid: 'different' }]), /conflict/);
assert.throws(() => mergeForSync([local], [{ ...local, webname: 'LOCAL.EXAMPLE' }]), /conflict/);
assert.equal(mergeForSync([local], [local, remote]).length, 2);
assert.throws(() => planSyncMerge([local, local], []), /Duplicate/);
const plan = planSyncMerge([local], [{ ...local, uuid: 'cloud-uuid', length: 20 }]);
assert.throws(() => resolveSyncMerge(plan, []), /every sync conflict/);
assert.throws(() => resolveSyncMerge(plan, new Array(1)), /every sync conflict/);
assert.deepEqual(resolveSyncMerge(plan, ['local']), [local]);
const selectedCloud = resolveSyncMerge(plan, ['remote'])[0];
assert.equal(selectedCloud.uuid, 'cloud-uuid');
assert.equal(selectedCloud.length, 20);
const oldVault = accountEntryToVaultEntry(local);
const updatedVault = syncAccountsToVaultEntries([selectedCloud], [oldVault])[0];
assert.equal(updatedVault.uuid, 'cloud-uuid');
assert.equal(updatedVault.length, 20);
assert.equal(updatedVault.id, oldVault.id);
assert.equal(updatedVault.createdAt, oldVault.createdAt);
assert.equal(oldVault.uuid, local.uuid);
assert.equal(syncAccountsToVaultEntries([local], [oldVault])[0], oldVault);

const reviewAbort = new AbortController();
let dismissed = false;
let lateComplete: ((choices: readonly ('local' | 'remote')[]) => void) | undefined;
const cancelledReview = reviewSyncConflicts(reviewAbort.signal, (complete) => {
  lateComplete = complete;
  return () => { dismissed = true; };
});
reviewAbort.abort();
await assert.rejects(() => cancelledReview, /cancelled/);
assert.equal(dismissed, true);
lateComplete!(['remote']); // A late button event cannot revive the cancelled review.
assert.deepEqual(await reviewSyncConflicts(new AbortController().signal, (complete) => {
  complete(['local']); return () => {};
}), ['local']);

let stored: string | undefined;
let tag = 0;
let forceStatus = 0;
let race = false;
let directoryIsFile = false;
let weakTag = false;
let puts = 0;
const directories = new Set<string>();
const server = createServer(async (request, response) => {
  if (forceStatus) { response.writeHead(forceStatus).end(); return; }
  if (request.headers.authorization !== 'Basic dXNlcjp0b2tlbg==') { response.writeHead(401).end(); return; }
  const path = request.url!;
  if (request.method === 'MKCOL') {
    const existed = directories.has(path);
    directories.add(path);
    response.writeHead(existed ? 405 : 201).end();
  } else if (request.method === 'PROPFIND') {
    assert.equal(request.headers.depth, '0');
    response.writeHead(207).end(directoryIsFile ? '<d:resourcetype/>' : '<d:collection/>');
  } else if (request.method === 'GET') {
    response.writeHead(stored === undefined ? 404 : 200, { ETag: weakTag ? 'W/"weak"' : `"${tag}"` }).end(stored);
  } else if (request.method === 'PUT') {
    puts++;
    if (race || (stored === undefined ? request.headers['if-none-match'] !== '*' : request.headers['if-match'] !== `"${tag}"`)) {
      response.writeHead(412).end(); return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    stored = body;
    tag++;
    response.writeHead(204).end();
  } else response.writeHead(405).end();
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const liveConfig = { ...config, url: `http://127.0.0.1:${address.port}/dav/` };
const transport: DavTransport = async (url, method, headers, body, signal) => {
  const response = await fetch(url, { method, headers, body, signal, redirect: 'error' });
  return { status: response.status, body: await response.text(), etag: response.headers.get('etag') ?? undefined };
};
const sync = (entries = [local], password = 'backup-password', signal = new AbortController().signal) => syncWebDav({
  config: liveConfig, entries, backupPassword: password, nonce: async () => new Uint8Array(16).fill(110), transport, signal, cipherOptions,
});
try {
  assert.equal((await sync()).length, 1);
  assert.equal(directories.size, 2);
  assert.equal(stored!.includes('local.example'), false);
  const merged = await sync([remote]);
  assert.equal(merged.length, 2);
  assert.equal((await importEntriesBase64Async(stored!, 'backup-password', cipherOptions)).length, 2);
  const before = stored;
  const beforePuts = puts;
  await assert.rejects(() => sync([local], 'wrong-password'));
  assert.equal(stored, before);
  assert.equal(puts, beforePuts);
  await assert.rejects(() => sync([{ ...local, uuid: 'changed' }]), /conflict/);
  assert.equal(puts, beforePuts);
  weakTag = true;
  await assert.rejects(() => sync(), /strong ETag/);
  weakTag = false;
  race = true;
  await assert.rejects(() => sync(), /Remote data changed/);
  assert.equal(stored, before);
  race = false;
  forceStatus = 401;
  await assert.rejects(() => sync(), /permission denied/);
  forceStatus = 500;
  await assert.rejects(() => sync(), /HTTP 500/);
  forceStatus = 302;
  await assert.rejects(() => sync()); // Transport rejects redirects before following them.
  forceStatus = 0;
  directoryIsFile = true;
  await assert.rejects(() => sync(), /not an accessible directory/);
  directoryIsFile = false;
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(() => sync([local], 'backup-password', cancelled.signal), /cancelled/);
  await assert.rejects(() => sync([local], ''), /password is required/);
  stored = 'corrupt';
  await assert.rejects(() => sync());
  assert.equal(stored, 'corrupt');
  // A cancelled decryption must never be followed by an upload.
  stored = await exportEntriesBase64Async([local], 'backup-password', new Uint8Array(16), cipherOptions);
  const abort = new AbortController();
  const count = puts;
  await assert.rejects(() => syncWebDav({
    config: liveConfig, entries: [remote], backupPassword: 'backup-password', nonce: async () => new Uint8Array(16),
    signal: abort.signal, cipherOptions,
    transport: async (...args) => { const result = await transport(...args); if (args[1] === 'GET') abort.abort(); return result; },
  }), /cancelled/);
  assert.equal(puts, count);
  // Resolve two conflicts differently while preserving additions from both devices.
  const otherLocal = { ...remote, length: 24 };
  const cloudLocal = { ...local, uuid: 'cloud-uuid', length: 20 };
  const cloudOther = { ...remote, charsetPreset: 'alphanum' as const };
  const cloudOnly = { ...remote, webname: 'cloud-only.example' };
  const localOnly = { ...local, webname: 'local-only.example' };
  stored = await exportEntriesBase64Async([cloudLocal, cloudOther, cloudOnly], 'backup-password', new Uint8Array(16), cipherOptions);
  const input = [local, otherLocal, localOnly];
  const inputBefore = JSON.stringify(input);
  const resolvingOptions = {
    config: liveConfig, entries: input, backupPassword: 'backup-password', nonce: async () => new Uint8Array(16).fill(8),
    transport, signal: new AbortController().signal, cipherOptions,
  };
  const resolved = await syncWebDav({ ...resolvingOptions, resolveConflicts: async (conflicts) => {
    assert.equal(conflicts.length, 2);
    assert.equal(conflicts[0].remote.uuid, 'cloud-uuid');
    return ['remote', 'local'];
  } });
  assert.deepEqual(resolved, [cloudLocal, otherLocal, localOnly, cloudOnly]);
  assert.deepEqual(await importEntriesBase64Async(stored!, 'backup-password', cipherOptions), resolved);
  assert.equal(JSON.stringify(input), inputBefore);
  const resolvedPuts = puts;
  const resolvedBody = stored;
  await assert.rejects(() => syncWebDav({ ...resolvingOptions, resolveConflicts: async () => [] }), /every sync conflict/);
  await assert.rejects(() => syncWebDav({ ...resolvingOptions, resolveConflicts: async () => { throw new Error('Cancelled by user'); } }), /Cancelled/);
  assert.equal(puts, resolvedPuts);
  assert.equal(stored, resolvedBody);
  // Another device changes the remote while the user is reviewing. Never reuse the old choice.
  const newer = { ...cloudLocal, length: 32 };
  const newerBody = await exportEntriesBase64Async([newer, otherLocal, cloudOnly], 'backup-password', new Uint8Array(16), cipherOptions);
  await assert.rejects(() => syncWebDav({ ...resolvingOptions, resolveConflicts: async () => {
    stored = newerBody; tag++;
    return ['local'];
  } }), /Remote data changed/);
  assert.equal(stored, newerBody);
  const retried = await syncWebDav({ ...resolvingOptions, resolveConflicts: async (conflicts) => {
    assert.equal(conflicts[0].remote.length, 32);
    return ['remote'];
  } });
  assert.equal(retried[0].length, 32);
  const lock = new AbortController();
  const beforeLockPuts = puts;
  await assert.rejects(() => syncWebDav({ ...resolvingOptions, signal: lock.signal, resolveConflicts: async () => {
    lock.abort(); return ['local'];
  } }), /cancelled/);
  assert.equal(puts, beforeLockPuts);
  console.log('ok - WebDAV HTTP integration, encrypted merge, conflicts, races, errors and cancellation');
  console.log('ok - Per-account conflict choices, cloud persistence, review cancellation and stale-choice rejection');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
