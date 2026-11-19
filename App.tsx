import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  StatusBar as NativeStatusBar,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

import { generateEntryPassword, validateEntry } from './src/kryptos/manager.ts';
import {
  clearClipboardIfUnchanged,
  copyToClipboard,
  authenticateVault,
  preventSensitiveScreenCapture,
  randomBytes,
  readClipboardText,
  webSecurityNotice,
} from './src/platform/runtime.ts';
import {
  assertNoDuplicate,
  createVaultEntry,
  exportVaultForBackupAsync,
  importVaultBackupAsync,
  readStoredPrefix,
  resetVault,
  saveVault,
  saveStoredPrefix,
  unlockVault,
} from './src/vault/store.ts';
import { emptyVault, type VaultEntry, type VaultSettings, type VaultState } from './src/vault/types.ts';
import { syncAccountsToVaultEntries, vaultEntryToAccountEntry } from './src/vault/model.ts';
import { davPaths, syncWebDav, type WebDavConfig, type SyncChoice, type SyncConflict } from './src/sync/webdav.ts';
import { reviewSyncConflicts, type SyncReview } from './src/sync/review.ts';
import { webDavTransport } from './src/platform/webdav.ts';
import { canInstallUpdates, checkForAppUpdate, installedVersion, installAppUpdate } from './src/platform/update.ts';
import { RELEASE_PAGE, type AppUpdate } from './src/update/release.ts';

type Screen = 'unlock' | 'prefix' | 'home' | 'entry' | 'edit' | 'settings' | 'backup';

const nowIso = () => new Date().toISOString();
const waitForUi = () => new Promise<void>((resolve) => setTimeout(resolve, 50));
const MAX_BACKUP_TEXT_CHARS = 2_000_000;

function entryToGenerator(entry: VaultEntry) {
  return {
    webname: entry.webname,
    uuid: entry.uuid,
    username: entry.username,
    length: entry.length,
    charsetPreset: entry.charsetPreset,
  };
}

export default function App() {
  const [vault, setVault] = useState<VaultState>(emptyVault());
  const [screen, setScreen] = useState<Screen>('unlock');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    webname: '',
    username: '',
    length: '16',
    charsetPreset: 'full' as 'full' | 'alphanum',
  });
  const [prefixInput, setPrefixInput] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupText, setBackupText] = useState('');
  const [davConfig, setDavConfig] = useState<WebDavConfig>({ url: '', directory: 'Kryptos', username: '', password: '' });
  const [syncReview, setSyncReview] = useState<SyncReview | null>(null);
  const [message, setMessage] = useState('');
  const [clearConfirm, setClearConfirm] = useState(false);
  const [recoveryClearConfirm, setRecoveryClearConfirm] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [workingEntryId, setWorkingEntryId] = useState<string | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdate | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const updateInFlight = useRef(false);
  const autoUpdateChecked = useRef(false);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const backgroundAt = useRef<number | null>(null);
  const screenRef = useRef<Screen>('unlock');
  const autoUnlockAttempted = useRef(false);
  const unlockInFlight = useRef(false);
  const backupInFlight = useRef(false);
  const passwordActionInFlight = useRef(false);
  const operationGeneration = useRef(0);
  const syncController = useRef<AbortController | null>(null);

  const selectedEntry = useMemo(
    () => vault.entries.find((entry) => entry.id === selectedId) ?? null,
    [selectedId, vault.entries],
  );
  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return vault.entries;
    }
    return vault.entries.filter(
      (entry) =>
        entry.webname.toLowerCase().includes(needle) ||
        entry.username.toLowerCase().includes(needle),
    );
  }, [query, vault.entries]);
  const notice = webSecurityNotice();

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    if (screen === 'unlock' || !vault.settings.autoCheckUpdates || !canInstallUpdates || autoUpdateChecked.current) return;
    autoUpdateChecked.current = true;
    void checkUpdates();
  }, [screen, vault.settings.autoCheckUpdates]);

  async function checkUpdates(): Promise<void> {
    if (updateInFlight.current) return;
    updateInFlight.current = true; setUpdateBusy(true); setUpdateMessage('Checking stable releases...');
    try {
      const next = await checkForAppUpdate();
      setAppUpdate(next);
      setUpdateMessage(next ? `Version ${next.version} is available. Install it from Settings.` : 'Already up to date.');
    } catch (error) { setUpdateMessage(error instanceof Error ? error.message : 'Unable to check updates.'); }
    finally { updateInFlight.current = false; setUpdateBusy(false); }
  }
  async function installUpdate(): Promise<void> {
    if (!appUpdate || updateInFlight.current) return;
    updateInFlight.current = true; setUpdateBusy(true); setUpdateMessage('Downloading and verifying update...');
    try {
      const result = await installAppUpdate(appUpdate);
      setUpdateMessage(result === 'permission' ? 'Allow installs from Kryptos in system settings, then tap Download and install again.' : 'Confirm the update in the Android installer. Your vault stays on this device.');
    } catch (error) { setUpdateMessage(error instanceof Error ? error.message : 'Unable to install update.'); }
    finally { updateInFlight.current = false; setUpdateBusy(false); }
  }

  useEffect(() => {
    if (screen !== 'unlock' || autoUnlockAttempted.current) {
      return;
    }
    autoUnlockAttempted.current = true;
    void unlock();
  }, [screen]);

  useEffect(() => {
    preventSensitiveScreenCapture(vault.settings.preventScreenshots).catch(() => undefined);
    return () => {
      preventSensitiveScreenCapture(false).catch(() => undefined);
    };
  }, [vault.settings.preventScreenshots]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        backgroundAt.current = Date.now();
      } else if (state === 'active' && backgroundAt.current) {
        const elapsed = (Date.now() - backgroundAt.current) / 1000;
        backgroundAt.current = null;
        if (elapsed >= vault.settings.backgroundLockSeconds && screenRef.current !== 'unlock') {
          lockAll('Locked after background timeout.', true);
        }
      }
    });
    return () => subscription.remove();
  }, [vault.settings.backgroundLockSeconds]);

  function noteActivity(): void {
    // Activity no longer extends a prefix session; sensitive operations prompt
    // system authentication when they need the stored prefix.
  }

  function isCurrentOperation(token: number): boolean {
    return token === operationGeneration.current && screenRef.current !== 'unlock';
  }

  function updateQuery(value: string): void {
    noteActivity();
    setQuery(value);
  }

  function updateForm(next: typeof form): void {
    noteActivity();
    setForm(next);
  }

  function updateBackupPassword(value: string): void {
    noteActivity();
    setBackupPassword(value);
  }

  async function persist(next: VaultState): Promise<void> {
    await saveVault(next);
    setVault(next);
  }

  async function unlock(): Promise<void> {
    if (syncController.current) {
      setMessage('Finishing WebDAV cancellation. Retry unlock in a moment.');
      return;
    }
    if (unlockInFlight.current) {
      return;
    }
    unlockInFlight.current = true;
    setUnlocking(true);
    setMessage('Waiting for system authentication...');
    try {
      const next = await unlockVault();
      const storedPrefix = await readStoredPrefix();
      const hasStoredPrefix = storedPrefix !== null;
      const syncedVault =
        next.settings.hasStoredPrefix === hasStoredPrefix
          ? next
          : { ...next, settings: { ...next.settings, hasStoredPrefix } };
      if (syncedVault !== next) {
        await saveVault(syncedVault);
      }
      setVault(syncedVault);
      setRecoveryClearConfirm(false);
      setScreen(hasStoredPrefix ? 'home' : 'prefix');
      setMessage(
        hasStoredPrefix
          ? 'Vault unlocked. Tap an entry to copy after system authentication.'
          : 'Vault ready. Save a prefix for this device; empty is allowed.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to unlock vault.');
    } finally {
      unlockInFlight.current = false;
      setUnlocking(false);
    }
  }

  async function savePrefixForDevice(): Promise<void> {
    try {
      setMessage('Authenticate to save the device prefix...');
      const authenticated = await authenticateVault();
      if (!authenticated) {
        setMessage('Prefix save cancelled.');
        return;
      }
      await saveStoredPrefix(prefixInput);
      const next = { ...vault, settings: { ...vault.settings, hasStoredPrefix: true } };
      await persist(next);
      setPrefixInput('');
      setScreen('home');
      setMessage(prefixInput.length === 0 ? 'Empty prefix saved. System authentication is still required for each password action.' : 'Prefix saved locally. System authentication is required for each password action.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save prefix.');
    }
  }

  function lockAll(nextMessage = 'Vault locked.', autoUnlock = false): void {
    syncController.current?.abort();
    setSyncReview(null);
    setDavConfig({ url: '', directory: 'Kryptos', username: '', password: '' });
    operationGeneration.current += 1;
    autoUnlockAttempted.current = !autoUnlock;
    setVault(emptyVault());
    setPrefixInput('');
    setGeneratedPassword(null);
    setPasswordVisible(false);
    setBackupPassword('');
    setBackupText('');
    setQuery('');
    setSelectedId(null);
    setSwipedId(null);
    setClearConfirm(false);
    setRecoveryClearConfirm(false);
    setScreen('unlock');
    setMessage(nextMessage);
  }

  function openCreate(): void {
    setSelectedId(null);
    setForm({ webname: '', username: '', length: '16', charsetPreset: 'full' });
    setScreen('edit');
  }

  function openEdit(entry: VaultEntry): void {
    setSelectedId(entry.id);
    setForm({
      webname: entry.webname,
      username: entry.username,
      length: String(entry.length),
      charsetPreset: entry.charsetPreset,
    });
    setScreen('edit');
  }

  async function submitEntry(): Promise<void> {
    noteActivity();
    try {
      const length = Number.parseInt(form.length, 10);
      const candidate =
        selectedEntry ??
        (await createVaultEntry({
          webname: form.webname,
          username: form.username,
          length,
          charsetPreset: form.charsetPreset,
        }));
      const updated: VaultEntry = {
        ...candidate,
        webname: form.webname.trim(),
        username: form.username.trim(),
        length,
        charsetPreset: form.charsetPreset,
        updatedAt: nowIso(),
      };
      validateEntry(entryToGenerator(updated));
      assertNoDuplicate(vault.entries, updated, selectedEntry?.id);
      const entries = selectedEntry
        ? vault.entries.map((entry) => (entry.id === selectedEntry.id ? updated : entry))
        : [updated, ...vault.entries];
      await persist({ ...vault, entries });
      setSelectedId(updated.id);
      setScreen('entry');
      setMessage(selectedEntry ? 'Entry updated.' : 'Entry added.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save entry.');
    }
  }

  async function deleteEntry(entry: VaultEntry): Promise<void> {
    noteActivity();
    try {
      const entries = vault.entries.filter((candidate) => candidate.id !== entry.id);
      await persist({ ...vault, entries });
      setSelectedId(null);
      setGeneratedPassword(null);
      setScreen('home');
      setMessage('Entry deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete entry.');
    }
  }

  async function generateFor(entry: VaultEntry, reveal = false): Promise<void> {
    noteActivity();
    if (passwordActionInFlight.current) {
      setMessage('Finish the current authentication first.');
      return;
    }
    passwordActionInFlight.current = true;
    setWorkingEntryId(entry.id);
    setMessage('Authenticate to reveal password...');
    try {
      const authenticated = await authenticateVault();
      if (!authenticated) {
        setMessage('Password action cancelled.');
        return;
      }
      const prefix = await readStoredPrefix();
      if (prefix === null) {
        const next = { ...vault, settings: { ...vault.settings, hasStoredPrefix: false } };
        await persist(next);
        setScreen('prefix');
        setMessage('Save a prefix on this device first. Empty is allowed.');
        return;
      }
      const password = generateEntryPassword(entryToGenerator(entry), prefix);
      setGeneratedPassword(password);
      setPasswordVisible(reveal);
      if (reveal) {
        setTimeout(() => {
          setPasswordVisible(false);
          setGeneratedPassword(null);
        }, 15000);
      } else {
        setGeneratedPassword(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate password.');
    } finally {
      passwordActionInFlight.current = false;
      setWorkingEntryId(null);
    }
  }

  async function copyPassword(entry: VaultEntry): Promise<void> {
    noteActivity();
    if (passwordActionInFlight.current) {
      setMessage('Finish the current authentication first.');
      return;
    }
    passwordActionInFlight.current = true;
    setWorkingEntryId(entry.id);
    setMessage(`Authenticate to copy ${entry.webname}...`);
    try {
      const authenticated = await authenticateVault();
      if (!authenticated) {
        setMessage('Password action cancelled.');
        return;
      }
      const prefix = await readStoredPrefix();
      if (prefix === null) {
        const next = { ...vault, settings: { ...vault.settings, hasStoredPrefix: false } };
        await persist(next);
        setScreen('prefix');
        setMessage('Save a prefix on this device first. Empty is allowed.');
        return;
      }
      const password = generateEntryPassword(entryToGenerator(entry), prefix);
      await copyToClipboard(password);
      setGeneratedPassword(null);
      setPasswordVisible(false);
      setMessage(`Copied ${entry.webname}. Clipboard will be cleared in 30 seconds if unchanged.`);
      setTimeout(() => clearClipboardIfUnchanged(password), 30000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to copy password.');
    } finally {
      passwordActionInFlight.current = false;
      setWorkingEntryId(null);
    }
  }

  async function runWebDavSync(): Promise<void> {
    if (backupInFlight.current) return;
    const token = operationGeneration.current;
    const controller = new AbortController();
    syncController.current = controller;
    backupInFlight.current = true;
    setBackupBusy(true);
    let timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      davPaths(davConfig);
      if (!backupPassword) throw new Error('Enter the same backup password on all devices.');
      if (!await authenticateVault() || !isCurrentOperation(token)) return;
      // Persist the connection inside the encrypted local vault, never in the remote export.
      const configured = { ...vault, webdav: { ...davConfig } };
      await saveVault(configured);
      if (!isCurrentOperation(token)) return;
      setVault(configured);
      setMessage('Syncing encrypted metadata with WebDAV...');
      await waitForUi();
      const accounts = await syncWebDav({
        config: davConfig, entries: vault.entries.map(vaultEntryToAccountEntry), backupPassword,
        nonce: () => randomBytes(16), transport: webDavTransport, signal: controller.signal,
        resolveConflicts: async (conflicts) => {
          if (!isCurrentOperation(token)) throw new Error('WebDAV sync cancelled.');
          // Give the user time to inspect each account. Lock/cancel still aborts.
          clearTimeout(timeout);
          setMessage('Choose which version to keep for each account.');
          try {
            return await reviewSyncConflicts(controller.signal, (complete) => {
              setSyncReview({ conflicts, complete });
              return () => setSyncReview(null);
            });
          } finally {
            timeout = setTimeout(() => controller.abort(), 120_000);
            if (isCurrentOperation(token)) setMessage('Applying choices and syncing encrypted metadata...');
          }
        },
      });
      if (!isCurrentOperation(token) || controller.signal.aborted) return;
      const entries = syncAccountsToVaultEntries(accounts, vault.entries);
      const next = { ...configured, entries };
      await saveVault(next);
      if (!isCurrentOperation(token)) return;
      setVault(next);
      setMessage(`WebDAV sync complete. ${entries.length} entries. Local deletions are not propagated.`);
    } catch (error) {
      if (isCurrentOperation(token)) setMessage(error instanceof Error ? error.message : 'WebDAV sync failed.');
    } finally {
      clearTimeout(timeout);
      syncController.current = null;
      setSyncReview(null);
      backupInFlight.current = false;
      setBackupBusy(false);
      setBackupPassword('');
    }
  }

  async function exportBackup(): Promise<void> {
    noteActivity();
    if (backupInFlight.current) {
      return;
    }
    const token = operationGeneration.current;
    backupInFlight.current = true;
    setBackupBusy(true);
    setMessage('Authenticate to export encrypted backup metadata...');
    try {
      const authenticated = await authenticateVault();
      if (!authenticated) {
        setMessage('Backup export cancelled.');
        return;
      }
      if (!isCurrentOperation(token)) {
        return;
      }
      setMessage('Encrypting backup. This can take a moment, but the UI should stay responsive.');
      await waitForUi();
      const nonce = await randomBytes(16);
      const exported = await exportVaultForBackupAsync(vault.entries, backupPassword, nonce);
      if (!isCurrentOperation(token)) {
        return;
      }
      setBackupText(exported);
      setBackupPassword('');
      await copyToClipboard(exported);
      if (!isCurrentOperation(token)) {
        return;
      }
      setMessage(`Encrypted backup generated and copied to clipboard (${exported.length} characters).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to export backup.');
    } finally {
      backupInFlight.current = false;
      setBackupBusy(false);
    }
  }

  async function importBackup(): Promise<void> {
    noteActivity();
    if (backupInFlight.current) {
      return;
    }
    const token = operationGeneration.current;
    const incomingText = backupText.trim();
    if (incomingText.length > MAX_BACKUP_TEXT_CHARS) {
      setMessage('Backup text is too large for mobile import. Use a smaller encrypted backup.');
      return;
    }
    backupInFlight.current = true;
    setBackupBusy(true);
    setMessage('Authenticate to import encrypted backup metadata...');
    try {
      const authenticated = await authenticateVault();
      if (!authenticated) {
        setMessage('Backup import cancelled.');
        return;
      }
      if (!isCurrentOperation(token)) {
        return;
      }
      setMessage('Decrypting and validating backup. Existing data will not change unless this succeeds.');
      await waitForUi();
      const entries = await importVaultBackupAsync(incomingText, backupPassword, vault.entries, vault.settings.importMode);
      if (!isCurrentOperation(token)) {
        return;
      }
      const next = { ...vault, entries };
      await saveVault(next);
      if (!isCurrentOperation(token)) {
        return;
      }
      setVault(next);
      setBackupPassword('');
      setBackupText('');
      setMessage(`Backup imported. Vault now has ${entries.length} entries.`);
      setScreen('home');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to import backup.');
    } finally {
      backupInFlight.current = false;
      setBackupBusy(false);
    }
  }

  async function pasteBackupFromClipboard(): Promise<void> {
    if (backupInFlight.current) {
      return;
    }
    try {
      const text = (await readClipboardText()).trim();
      if (text.length === 0) {
        setMessage('Clipboard does not contain backup text.');
        return;
      }
      if (text.length > MAX_BACKUP_TEXT_CHARS) {
        setMessage('Clipboard backup text is too large for mobile import.');
        return;
      }
      setBackupText(text);
      setMessage(`Backup loaded from clipboard (${text.length} characters).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to read clipboard.');
    }
  }

  async function copyBackupToClipboard(): Promise<void> {
    if (backupText.length === 0) {
      setMessage('No backup text is loaded.');
      return;
    }
    try {
      await copyToClipboard(backupText);
      setMessage(`Backup copied to clipboard (${backupText.length} characters).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to copy backup.');
    }
  }

  function clearBackupText(): void {
    setBackupText('');
    setMessage('Backup text cleared from this screen.');
  }

  async function updateSettings(settings: Partial<VaultSettings>): Promise<void> {
    noteActivity();
    try {
      const next = { ...vault, settings: { ...vault.settings, ...settings } };
      await persist(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save settings.');
    }
  }

  async function clearAllData(): Promise<void> {
    if (!clearConfirm) {
      setClearConfirm(true);
      setMessage('Tap Clear vault again to permanently delete local vault data.');
      return;
    }
    try {
      await resetVault();
      lockAll('Vault data cleared.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to clear vault.');
    }
  }

  async function clearLocalDataFromUnlock(): Promise<void> {
    if (syncController.current) {
      setMessage('Finishing WebDAV cancellation. Retry in a moment.');
      return;
    }
    if (!recoveryClearConfirm) {
      setRecoveryClearConfirm(true);
      setMessage('Tap Confirm clear on this screen to permanently delete the local vault and device key.');
      return;
    }
    try {
      await resetVault();
      setVault(emptyVault());
      setRecoveryClearConfirm(false);
      autoUnlockAttempted.current = true;
      setMessage('Local vault data cleared. Retry unlock to create a fresh vault, then import an encrypted backup if needed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to clear local vault data.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} onTouchStart={noteActivity}>
      <ExpoStatusBar style="dark" backgroundColor="#f5f7fb" translucent={false} />
      <View style={styles.shell}>
        <Header screen={screen} onLock={() => lockAll()} />
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {screen !== 'unlock' && appUpdate ? <Text style={styles.notice}>Update {appUpdate.version} available · open Settings to install.</Text> : null}

        {screen === 'unlock' ? (
          <UnlockScreen
            onUnlock={unlock}
            unlocking={unlocking}
            onClearLocalData={clearLocalDataFromUnlock}
            clearConfirm={recoveryClearConfirm}
          />
        ) : screen === 'prefix' ? (
          <PrefixScreen
            prefix={prefixInput}
            onPrefixChange={setPrefixInput}
            onSave={savePrefixForDevice}
            onLock={() => lockAll()}
          />
        ) : screen === 'home' ? (
          <HomeScreen
            query={query}
            onQueryChange={updateQuery}
            entries={filteredEntries}
            workingEntryId={workingEntryId}
            passwordBusy={passwordActionInFlight.current}
            swipedId={swipedId}
            onSwipe={setSwipedId}
            onCopy={copyPassword}
            onDetails={(entry) => {
              setSelectedId(entry.id);
              setGeneratedPassword(null);
              setPasswordVisible(false);
              setScreen('entry');
            }}
            onDelete={deleteEntry}
            onCreate={openCreate}
            onBackup={() => {
              setDavConfig(vault.webdav ?? { url: '', directory: 'Kryptos', username: '', password: '' });
              setBackupPassword('');
              setBackupText('');
              setScreen('backup');
            }}
            onSettings={() => setScreen('settings')}
          />
        ) : screen === 'entry' && selectedEntry ? (
          <EntryScreen
            entry={selectedEntry}
            generatedPassword={generatedPassword}
            passwordVisible={passwordVisible}
            working={workingEntryId === selectedEntry.id}
            onGenerate={() => generateFor(selectedEntry, true)}
            onCopy={() => copyPassword(selectedEntry)}
            onEdit={() => openEdit(selectedEntry)}
            onDelete={() => deleteEntry(selectedEntry)}
            onBack={() => setScreen('home')}
          />
        ) : screen === 'edit' ? (
          <EditScreen
            form={form}
            isEditing={Boolean(selectedEntry)}
            onChange={updateForm}
            onSubmit={submitEntry}
            onCancel={() => setScreen(selectedEntry ? 'entry' : 'home')}
          />
        ) : screen === 'backup' && syncReview ? (
          <SyncConflictScreen conflicts={syncReview.conflicts} onResolve={syncReview.complete}
            onCancel={() => syncController.current?.abort()} />
        ) : screen === 'backup' ? (
          <BackupScreen
            mode={vault.settings.importMode}
            backupPassword={backupPassword}
            backupText={backupText}
            onPasswordChange={updateBackupPassword}
            onExport={exportBackup}
            onImport={importBackup}
            onPaste={pasteBackupFromClipboard}
            onCopyBackup={copyBackupToClipboard}
            onClearBackup={clearBackupText}
            busy={backupBusy}
            davConfig={davConfig}
            onDavChange={setDavConfig}
            onSync={runWebDavSync}
            onBack={() => {
              setDavConfig({ url: '', directory: 'Kryptos', username: '', password: '' });
              setBackupPassword('');
              setBackupText('');
              setScreen('home');
            }}
          />
        ) : (
          <SettingsScreen
            update={{ available: appUpdate, busy: updateBusy, message: updateMessage, onCheck: () => void checkUpdates(), onInstall: () => void installUpdate() }}
            settings={vault.settings}
            onChange={updateSettings}
            onPrefix={() => {
              setPrefixInput('');
              setScreen('prefix');
            }}
            onClear={clearAllData}
            clearConfirm={clearConfirm}
            onBack={() => setScreen('home')}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function Header({
  screen,
  onLock,
}: {
  screen: Screen;
  onLock: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.title}>Kryptos</Text>
        <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
          {screen === 'unlock' ? 'Encrypted local vault' : 'System-auth gated password actions'}
        </Text>
      </View>
      {screen !== 'unlock' ? (
        <Pressable
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          onPress={onLock}
          android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
        >
          <Text style={styles.iconButtonText}>Lock</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function UnlockScreen({
  onUnlock,
  unlocking,
  onClearLocalData,
  clearConfirm,
}: {
  onUnlock: () => void;
  unlocking: boolean;
  onClearLocalData: () => void;
  clearConfirm: boolean;
}) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <Text style={styles.panelTitle}>Encrypted vault</Text>
        <Text style={styles.bodyText}>
          {unlocking
            ? 'Waiting for the system security prompt. Passwords are never stored; the prefix is protected by system authentication.'
            : 'Unlock local metadata with the system security prompt. Passwords are never stored; the prefix is protected by system authentication.'}
        </Text>
        <PrimaryButton label={unlocking ? 'Unlocking...' : 'Retry unlock'} onPress={onUnlock} disabled={unlocking} />
        <DangerButton
          label={clearConfirm ? 'Confirm clear' : 'Clear local vault'}
          onPress={onClearLocalData}
          disabled={unlocking}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PrefixScreen({
  prefix,
  onPrefixChange,
  onSave,
  onLock,
}: {
  prefix: string;
  onPrefixChange: (value: string) => void;
  onSave: () => void;
  onLock: () => void;
}) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <Text style={styles.panelTitle}>Device prefix</Text>
        <Text style={styles.bodyText}>The prefix is encrypted locally with system authentication. Empty is allowed; use a non-empty prefix for stronger generated passwords.</Text>
        <TextInput
          value={prefix}
          onChangeText={onPrefixChange}
          secureTextEntry
          placeholder="Master prefix (empty allowed)"
          placeholderTextColor="#7b8494"
          style={styles.input}
        />
        <PrimaryButton label={prefix.length === 0 ? 'Save empty prefix' : 'Save prefix'} onPress={onSave} />
        <SecondaryButton label="Lock vault" onPress={onLock} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function HomeScreen({
  query,
  onQueryChange,
  entries,
  workingEntryId,
  passwordBusy,
  swipedId,
  onSwipe,
  onCopy,
  onDetails,
  onDelete,
  onCreate,
  onBackup,
  onSettings,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  entries: VaultEntry[];
  workingEntryId: string | null;
  passwordBusy: boolean;
  swipedId: string | null;
  onSwipe: (id: string | null) => void;
  onCopy: (entry: VaultEntry) => void;
  onDetails: (entry: VaultEntry) => void;
  onDelete: (entry: VaultEntry) => void;
  onCreate: () => void;
  onBackup: () => void;
  onSettings: () => void;
}) {
  return (
    <View style={styles.flex}>
      <View style={styles.toolbar}>
        <PrimaryButton label="Add" onPress={onCreate} compact />
        <SecondaryButton label="Backup" onPress={onBackup} compact />
        <SecondaryButton label="Settings" onPress={onSettings} compact />
      </View>
      <TextInput
        value={query}
        onChangeText={onQueryChange}
        placeholder="Search site or username"
        placeholderTextColor="#7b8494"
        style={styles.input}
      />
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {entries.length === 0 ? (
          <Text style={styles.empty}>No entries yet. Add one, or import an encrypted backup from the Backup screen.</Text>
        ) : (
          entries.map((entry) => (
            <VaultRow
              key={entry.id}
              entry={entry}
              revealed={swipedId === entry.id}
              working={workingEntryId === entry.id}
              disabled={passwordBusy}
              onSwipe={onSwipe}
              onCopy={onCopy}
              onDetails={onDetails}
              onDelete={onDelete}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function VaultRow({
  entry,
  revealed,
  working,
  disabled,
  onSwipe,
  onCopy,
  onDetails,
  onDelete,
}: {
  entry: VaultEntry;
  revealed: boolean;
  working: boolean;
  disabled: boolean;
  onSwipe: (id: string | null) => void;
  onCopy: (entry: VaultEntry) => void;
  onDetails: (entry: VaultEntry) => void;
  onDelete: (entry: VaultEntry) => void;
}) {
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < -48) {
            onSwipe(entry.id);
          } else if (gesture.dx > 36) {
            onSwipe(null);
          }
        },
      }),
    [entry.id, onSwipe],
  );

  return (
    <View style={styles.rowWrap} {...responder.panHandlers}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.pressed, (working || disabled) && styles.rowWorking]}
        onPress={() => onCopy(entry)}
        onLongPress={() => onDetails(entry)}
        disabled={working || disabled}
      >
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle} numberOfLines={1} ellipsizeMode="tail">{entry.webname}</Text>
          <Text style={styles.rowSub} numberOfLines={1} ellipsizeMode="tail">
            {working ? 'Authenticating...' : disabled ? 'Wait for current action...' : entry.username}
          </Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>{entry.length} / {entry.charsetPreset}</Text>
      </Pressable>
      {revealed ? (
        <View style={styles.rowActions}>
          <SecondaryButton label="Details" onPress={() => onDetails(entry)} compact />
          <DangerButton label="Delete" onPress={() => onDelete(entry)} compact />
        </View>
      ) : null}
    </View>
  );
}

function EntryScreen({
  entry,
  generatedPassword,
  passwordVisible,
  working,
  onGenerate,
  onCopy,
  onEdit,
  onDelete,
  onBack,
}: {
  entry: VaultEntry;
  generatedPassword: string | null;
  passwordVisible: boolean;
  working: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.entryContent}>
      <SecondaryButton label="Back" onPress={onBack} compact />
      <View style={styles.detail}>
        <Text style={styles.panelTitle}>{entry.webname}</Text>
        <Text style={styles.bodyText}>{entry.username}</Text>
        <Text style={styles.meta}>Length {entry.length} / {entry.charsetPreset}</Text>
        <View style={styles.passwordBox}>
          <Text style={styles.passwordText}>
            {generatedPassword ? (passwordVisible ? generatedPassword : 'Generated password hidden') : 'Generate or copy password'}
          </Text>
        </View>
      </View>
      <View style={styles.toolbar}>
        <PrimaryButton label={working ? 'Working...' : 'Show'} onPress={onGenerate} compact disabled={working} />
        <PrimaryButton label="Copy" onPress={onCopy} compact disabled={working} />
        <SecondaryButton label="Edit" onPress={onEdit} compact disabled={working} />
        <DangerButton label="Delete" onPress={onDelete} compact disabled={working} />
      </View>
    </ScrollView>
  );
}

function EditScreen({
  form,
  isEditing,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: { webname: string; username: string; length: string; charsetPreset: 'full' | 'alphanum' };
  isEditing: boolean;
  onChange: (next: { webname: string; username: string; length: string; charsetPreset: 'full' | 'alphanum' }) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.form}>
      <Text style={styles.panelTitle}>{isEditing ? 'Edit entry' : 'New entry'}</Text>
      <Field label="Site" value={form.webname} onChangeText={(webname) => onChange({ ...form, webname })} />
      <Field label="Username" value={form.username} onChangeText={(username) => onChange({ ...form, username })} />
      <Field label="Length" value={form.length} keyboardType="number-pad" onChangeText={(length) => onChange({ ...form, length })} />
      <View style={styles.segment}>
        <Pressable
          style={({ pressed }) => [
            styles.segmentItem,
            form.charsetPreset === 'full' && styles.segmentActive,
            pressed && styles.segmentPressed,
          ]}
          onPress={() => onChange({ ...form, charsetPreset: 'full' })}
          android_ripple={{ color: 'rgba(20,83,45,0.08)' }}
        >
          <Text style={styles.segmentText}>Full</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.segmentItem,
            form.charsetPreset === 'alphanum' && styles.segmentActive,
            pressed && styles.segmentPressed,
          ]}
          onPress={() => onChange({ ...form, charsetPreset: 'alphanum' })}
          android_ripple={{ color: 'rgba(20,83,45,0.08)' }}
        >
          <Text style={styles.segmentText}>Alphanum</Text>
        </Pressable>
      </View>
      <PrimaryButton label="Save" onPress={onSubmit} />
      <SecondaryButton label="Cancel" onPress={onCancel} />
    </ScrollView>
  );
}

function backupPreview(text: string): string {
  if (text.length === 0) {
    return 'No backup loaded. Export to copy one, or paste an encrypted backup from the clipboard before importing.';
  }
  const compact = text.replace(/\s+/g, '');
  const head = compact.slice(0, 28);
  const tail = compact.length > 56 ? compact.slice(-28) : '';
  return tail.length > 0
    ? `${compact.length} characters: ${head}...${tail}`
    : `${compact.length} characters: ${head}`;
}

function BackupScreen({
  mode,
  backupPassword,
  backupText,
  onPasswordChange,
  onExport,
  onImport,
  onPaste,
  onCopyBackup,
  onClearBackup,
  busy,
  davConfig,
  onDavChange,
  onSync,
  onBack,
}: {
  mode: 'merge' | 'replace';
  backupPassword: string;
  backupText: string;
  onPasswordChange: (value: string) => void;
  onExport: () => void;
  onImport: () => void;
  onPaste: () => void;
  onCopyBackup: () => void;
  onClearBackup: () => void;
  busy: boolean;
  davConfig: WebDavConfig;
  onDavChange: (config: WebDavConfig) => void;
  onSync: () => void;
  onBack: () => void;
}) {
  const hasBackupText = backupText.length > 0;
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.form}>
      <Text style={styles.panelTitle}>Encrypted backup</Text>
      <Text style={styles.bodyText}>Export/import uses KryptosCore Base64 format encrypted with a separate backup password. Export copies the backup to the clipboard; import reads backup text loaded from the clipboard. Import mode: {mode}.</Text>
      <TextInput
        value={backupPassword}
        editable={!busy}
        onChangeText={onPasswordChange}
        secureTextEntry
        placeholder="Backup password"
        placeholderTextColor="#7b8494"
        style={styles.input}
      />
      <View style={styles.backupSummary}>
        <Text style={styles.label}>Loaded backup</Text>
        <Text style={styles.monoPreview} selectable>{backupPreview(backupText)}</Text>
      </View>
      {busy ? <Text style={styles.bodyText}>Working...</Text> : null}
      <PrimaryButton label={busy ? 'Working...' : 'Export'} onPress={onExport} disabled={busy} />
      <SecondaryButton label="Copy loaded backup" onPress={onCopyBackup} disabled={busy || !hasBackupText} />
      <SecondaryButton label="Paste backup from clipboard" onPress={onPaste} disabled={busy} />
      <SecondaryButton label="Import loaded backup" onPress={onImport} disabled={busy || !hasBackupText} />
      <SecondaryButton label="Clear loaded backup" onPress={onClearBackup} disabled={busy || !hasBackupText} />
      <Text style={styles.panelTitle}>WebDAV sync</Text>
      <Text style={styles.bodyText}>Use the same directory and backup password on every device. Missing directories are created automatically. Sync merges additions; deletions are not propagated. If versions differ, choose local or cloud for each account before syncing. Connection settings are saved encrypted on this device when syncing.</Text>
      {(['url', 'directory', 'username', 'password'] as const).map((key) => (
        <View key={key}>
          <Text style={styles.label}>{({ url: 'WebDAV root URL', directory: 'Sync directory (relative to root URL)', username: 'WebDAV username', password: 'WebDAV password / app token' })[key]}</Text>
          <TextInput value={davConfig[key]} editable={!busy} onChangeText={(value) => onDavChange({ ...davConfig, [key]: value })} secureTextEntry={key === 'password'} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        </View>
      ))}
      <PrimaryButton label="Sync with WebDAV" onPress={onSync} disabled={busy} />
      <SecondaryButton label="Back" onPress={onBack} disabled={busy} />
    </ScrollView>
  );
}

export function SyncConflictScreen({ conflicts, onResolve, onCancel }: {
  conflicts: readonly SyncConflict[];
  onResolve: (choices: readonly SyncChoice[]) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<(SyncChoice | undefined)[]>(() => conflicts.map(() => undefined));
  const [submitting, setSubmitting] = useState(false);
  const conflict = conflicts[index];
  const choice = choices[index];
  function choose(value: SyncChoice): void {
    setChoices((previous) => previous.map((current, position) => position === index ? value : current));
  }
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.form}>
      <Text style={styles.panelTitle}>Resolve sync conflicts</Text>
      <Text style={styles.label}>Account {index + 1} of {conflicts.length}</Text>
      <Text style={styles.bodyText}>Choose the version that generates the password you currently use. Your choice updates both this device and the cloud after you confirm all accounts. Other accounts are merged automatically.</Text>
      {(['local', 'remote'] as const).map((side) => (
        <View key={side} style={styles.backupSummary}>
          <Text style={styles.label}>{side === 'local' ? 'Local version (this device)' : 'Cloud version'}</Text>
          <Text style={styles.bodyText}>Site: {conflict[side].webname}</Text>
          <Text style={styles.bodyText}>Username: {conflict[side].username}</Text>
          <Text style={styles.bodyText}>Password length: {conflict[side].length}</Text>
          <Text style={styles.bodyText}>Character set: {conflict[side].charsetPreset}</Text>
        </View>
      ))}
      {conflict.local.uuid !== conflict.remote.uuid ? (
        <Text style={styles.notice}>The account seeds differ. Even with the same length and character set, these versions generate different passwords.</Text>
      ) : null}
      <SecondaryButton label={choice === 'local' ? 'Selected: keep local' : 'Keep local'} onPress={() => choose('local')} disabled={submitting} />
      <SecondaryButton label={choice === 'remote' ? 'Selected: use cloud' : 'Use cloud'} onPress={() => choose('remote')} disabled={submitting} />
      {index > 0 ? <SecondaryButton label="Previous account" onPress={() => setIndex(index - 1)} disabled={submitting} /> : null}
      {index < conflicts.length - 1 ? (
        <PrimaryButton label="Next account" onPress={() => setIndex(index + 1)} disabled={!choice || submitting} />
      ) : (
        <PrimaryButton label="Apply choices and sync" disabled={choices.some((value) => !value) || submitting} onPress={() => {
          if (choices.some((value) => !value) || submitting) return;
          setSubmitting(true);
          onResolve(choices as SyncChoice[]);
        }} />
      )}
      <SecondaryButton label="Cancel sync" onPress={onCancel} disabled={submitting} />
    </ScrollView>
  );
}

function SettingsScreen({
  update,
  settings,
  onChange,
  onPrefix,
  onClear,
  clearConfirm,
  onBack,
}: {
  update: { available: AppUpdate | null; busy: boolean; message: string; onCheck: () => void; onInstall: () => void };
  settings: VaultSettings;
  onChange: (settings: Partial<VaultSettings>) => void;
  onPrefix: () => void;
  onClear: () => void;
  clearConfirm: boolean;
  onBack: () => void;
}) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.form}>
      <Text style={styles.panelTitle}>Settings</Text>
      <UpdateSettings version={installedVersion} supported={canInstallUpdates} autoCheck={settings.autoCheckUpdates}
        onAutoCheck={(autoCheckUpdates) => onChange({ autoCheckUpdates })} {...update} />
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Block screenshots</Text>
        <Switch
          value={settings.preventScreenshots}
          onValueChange={(preventScreenshots) => onChange({ preventScreenshots })}
        />
      </View>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Merge imports</Text>
        <Switch
          value={settings.importMode === 'merge'}
          onValueChange={(merge) => onChange({ importMode: merge ? 'merge' : 'replace' })}
        />
      </View>
      <SecondaryButton label="Change prefix" onPress={onPrefix} />
      <Text style={styles.label}>Background lock seconds (5-30)</Text>
      <TextInput
        value={String(settings.backgroundLockSeconds)}
        keyboardType="number-pad"
        style={styles.input}
        onChangeText={(value) => onChange({ backgroundLockSeconds: Math.max(5, Math.min(30, Number.parseInt(value, 10) || 30)) })}
      />
      <DangerButton label={clearConfirm ? 'Confirm clear' : 'Clear vault'} onPress={onClear} />
      <SecondaryButton label="Back" onPress={onBack} />
    </ScrollView>
  );
}

export function UpdateSettings({ version, supported, autoCheck, onAutoCheck, available, busy, message, onCheck, onInstall }: {
  version: string; supported: boolean; autoCheck: boolean; onAutoCheck: (enabled: boolean) => void;
  available: AppUpdate | null; busy: boolean; message: string; onCheck: () => void; onInstall: () => void;
}) {
  return <View>
    <Text style={styles.label}>App updates · installed {version}</Text>
    <Text style={styles.bodyText}>Checks use GitHub Releases. Installation requires your confirmation and the same signing key. Your vault is preserved during an upgrade.</Text>
    {supported ? <>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Check for updates after unlock</Text>
        <Switch value={autoCheck} onValueChange={onAutoCheck} />
      </View>
      <SecondaryButton label={busy ? 'Working...' : 'Check for updates'} onPress={onCheck} disabled={busy} />
      {available ? <PrimaryButton label={`Download and install ${available.version}`} onPress={onInstall} disabled={busy} /> : null}
    </> : null}
    {message ? <Text style={styles.bodyText}>{message}</Text> : null}
    <SecondaryButton label="Open releases (manual download)" onPress={() => { void Linking.openURL(RELEASE_PAGE).catch(() => undefined); }} />
  </View>;
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'number-pad';
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} style={styles.input} />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  compact = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        styles.primaryButton,
        compact && styles.compactButton,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabledButton,
      ]}
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
    >
      <Text style={styles.primaryText} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
  compact = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        styles.secondaryButton,
        compact && styles.compactButton,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabledButton,
      ]}
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(17,24,39,0.08)' }}
    >
      <Text style={styles.secondaryText} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </Pressable>
  );
}

function DangerButton({
  label,
  onPress,
  compact = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        styles.dangerButton,
        compact && styles.compactButton,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabledButton,
      ]}
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(153,27,27,0.08)' }}
    >
      <Text style={styles.dangerText} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f5f7fb',
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
  },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: 16,
    gap: 12,
  },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#111827',
  },
  subtitle: {
    fontSize: 14,
    color: '#5b6472',
    marginTop: 2,
  },
  notice: {
    backgroundColor: '#fff7ed',
    color: '#9a3412',
    borderWidth: 1,
    borderColor: '#fed7aa',
    padding: 10,
    borderRadius: 8,
    lineHeight: 20,
  },
  message: {
    backgroundColor: '#eef6ff',
    color: '#1e3a8a',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    padding: 10,
    borderRadius: 8,
    lineHeight: 20,
  },
  center: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 14,
    paddingBottom: 28,
  },
  flex: {
    flex: 1,
  },
  panelTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  bodyText: {
    color: '#4b5563',
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  backupSummary: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  monoPreview: {
    color: '#374151',
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  button: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  compactButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryButton: {
    backgroundColor: '#14532d',
  },
  disabledButton: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  dangerButton: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  primaryText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  secondaryText: {
    color: '#111827',
    fontWeight: '700',
  },
  dangerText: {
    color: '#991b1b',
    fontWeight: '700',
  },
  iconButton: {
    minWidth: 64,
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  iconButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingBottom: 28,
  },
  rowWrap: {
    gap: 8,
  },
  row: {
    minHeight: 74,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowWorking: {
    opacity: 0.7,
  },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingRight: 2,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 17,
  },
  rowSub: {
    color: '#5b6472',
    marginTop: 4,
  },
  meta: {
    color: '#5b6472',
    fontSize: 13,
    flexShrink: 0,
  },
  empty: {
    padding: 24,
    color: '#5b6472',
    textAlign: 'center',
  },
  detail: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 16,
    gap: 10,
    marginVertical: 12,
  },
  passwordBox: {
    minHeight: 60,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    padding: 14,
    justifyContent: 'center',
  },
  passwordText: {
    color: '#111827',
    fontSize: 16,
    fontFamily: 'monospace',
    lineHeight: 22,
  },
  entryContent: {
    paddingBottom: 28,
  },
  form: {
    gap: 12,
    paddingBottom: 28,
  },
  label: {
    color: '#374151',
    fontWeight: '700',
    marginBottom: 6,
  },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  segmentItem: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: '#dcfce7',
  },
  segmentPressed: {
    opacity: 0.78,
  },
  segmentText: {
    color: '#111827',
    fontWeight: '700',
  },
  settingRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  settingLabel: {
    color: '#111827',
    fontWeight: '700',
  },
});
