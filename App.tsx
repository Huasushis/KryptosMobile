import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { generateEntryPassword } from './src/kryptos/manager.ts';
import {
  clearClipboardIfUnchanged,
  copyToClipboard,
  preventSensitiveScreenCapture,
  randomBytes,
  webSecurityNotice,
} from './src/platform/runtime.ts';
import {
  assertNoDuplicate,
  createVaultEntry,
  exportVaultForBackup,
  importVaultBackup,
  resetVault,
  saveVault,
  unlockVault,
} from './src/vault/store.ts';
import { createPrefixSession, destroyPrefixSession, withPrefix, type PrefixSession } from './src/vault/session.ts';
import { emptyVault, type VaultEntry, type VaultSettings, type VaultState } from './src/vault/types.ts';

type Screen = 'unlock' | 'prefix' | 'home' | 'entry' | 'edit' | 'settings' | 'backup';

const nowIso = () => new Date().toISOString();

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
  const [session, setSession] = useState<PrefixSession | null>(null);
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
  const [message, setMessage] = useState('');
  const [clearConfirm, setClearConfirm] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const backgroundAt = useRef<number | null>(null);
  const sessionRef = useRef<PrefixSession | null>(null);
  const screenRef = useRef<Screen>('unlock');

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
  const sessionMsLeft = session ? Math.max(0, session.expiresAt - tick) : 0;
  const notice = webSecurityNotice();

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (session && sessionMsLeft <= 0) {
      lockPrefixOnly('Prefix session expired.');
    }
  }, [session, sessionMsLeft]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    screenRef.current = screen;
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
          lockAll('Locked after background timeout.');
        }
      }
    });
    return () => subscription.remove();
  }, [vault.settings.backgroundLockSeconds]);

  function noteActivity(): void {
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    const expiresAt = Date.now() + vault.settings.autoLockMinutes * 60 * 1000;
    if (expiresAt - current.expiresAt < 1000) {
      return;
    }
    const next = { ...current, expiresAt };
    sessionRef.current = next;
    setSession(next);
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

  function updateBackupText(value: string): void {
    noteActivity();
    setBackupText(value);
  }

  async function persist(next: VaultState): Promise<void> {
    await saveVault(next);
    setVault(next);
  }

  async function unlock(): Promise<void> {
    try {
      const next = await unlockVault();
      setVault(next);
      setScreen('prefix');
      setMessage(next.entries.length === 0 ? 'Vault ready. Add your first entry after starting a prefix session.' : 'Vault unlocked.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to unlock vault.');
    }
  }

  async function startPrefixSession(): Promise<void> {
    try {
      if (prefixInput.length === 0) {
        throw new Error('Master prefix is required for this session.');
      }
      const next = await createPrefixSession(prefixInput, vault.settings.autoLockMinutes * 60 * 1000);
      destroyPrefixSession(session);
      setSession(next);
      setPrefixInput('');
      setScreen('home');
      setMessage('Prefix session started. The prefix is encrypted in memory only.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start prefix session.');
    }
  }

  function lockPrefixOnly(nextMessage = 'Prefix session cleared.'): void {
    destroyPrefixSession(session);
    setSession(null);
    setPrefixInput('');
    setGeneratedPassword(null);
    setPasswordVisible(false);
    setScreen('prefix');
    setMessage(nextMessage);
  }

  function lockAll(nextMessage = 'Vault locked.'): void {
    destroyPrefixSession(session);
    setSession(null);
    setVault(emptyVault());
    setPrefixInput('');
    setGeneratedPassword(null);
    setPasswordVisible(false);
    setBackupPassword('');
    setBackupText('');
    setQuery('');
    setSelectedId(null);
    setClearConfirm(false);
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
    if (!session) {
      setScreen('prefix');
      setMessage('Start a prefix session first.');
      return;
    }
    try {
      const password = await withPrefix(session, (prefix) => generateEntryPassword(entryToGenerator(entry), prefix));
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
      lockPrefixOnly(error instanceof Error ? error.message : 'Prefix session expired.');
    }
  }

  async function copyPassword(entry: VaultEntry): Promise<void> {
    noteActivity();
    if (!session) {
      setScreen('prefix');
      setMessage('Start a prefix session first.');
      return;
    }
    try {
      const password = await withPrefix(session, (prefix) => generateEntryPassword(entryToGenerator(entry), prefix));
      await copyToClipboard(password);
      setGeneratedPassword(null);
      setPasswordVisible(false);
      setMessage('Password copied. Clipboard will be cleared in 30 seconds if unchanged.');
      setTimeout(() => clearClipboardIfUnchanged(password), 30000);
    } catch (error) {
      lockPrefixOnly(error instanceof Error ? error.message : 'Prefix session expired.');
    }
  }

  async function exportBackup(): Promise<void> {
    noteActivity();
    try {
      const nonce = await randomBytes(16);
      const exported = exportVaultForBackup(vault.entries, backupPassword, nonce);
      setBackupText(exported);
      setBackupPassword('');
      setMessage('Encrypted backup generated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to export backup.');
    }
  }

  async function importBackup(): Promise<void> {
    noteActivity();
    try {
      const entries = importVaultBackup(backupText.trim(), backupPassword, vault.entries, vault.settings.importMode);
      await persist({ ...vault, entries });
      setBackupPassword('');
      setBackupText('');
      setMessage('Backup imported.');
      setScreen('home');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to import backup.');
    }
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

  return (
    <SafeAreaView style={styles.safe} onTouchStart={noteActivity}>
      <StatusBar style="dark" />
      <View style={styles.shell}>
        <Header screen={screen} sessionMsLeft={sessionMsLeft} onLock={() => lockAll()} />
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}

        {screen === 'unlock' ? (
          <UnlockScreen onUnlock={unlock} />
        ) : screen === 'prefix' ? (
          <PrefixScreen
            prefix={prefixInput}
            onPrefixChange={setPrefixInput}
            onStart={startPrefixSession}
            onLock={() => lockAll()}
          />
        ) : screen === 'home' ? (
          <HomeScreen
            query={query}
            onQueryChange={updateQuery}
            entries={filteredEntries}
            onOpen={(entry) => {
              setSelectedId(entry.id);
              setGeneratedPassword(null);
              setPasswordVisible(false);
              setScreen('entry');
            }}
            onCreate={openCreate}
            onBackup={() => {
              setBackupPassword('');
              setBackupText('');
              setScreen('backup');
            }}
            onSettings={() => setScreen('settings')}
            onPrefix={() => setScreen('prefix')}
          />
        ) : screen === 'entry' && selectedEntry ? (
          <EntryScreen
            entry={selectedEntry}
            generatedPassword={generatedPassword}
            passwordVisible={passwordVisible}
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
        ) : screen === 'backup' ? (
          <BackupScreen
            mode={vault.settings.importMode}
            backupPassword={backupPassword}
            backupText={backupText}
            onPasswordChange={updateBackupPassword}
            onTextChange={updateBackupText}
            onExport={exportBackup}
            onImport={importBackup}
            onBack={() => {
              setBackupPassword('');
              setBackupText('');
              setScreen('home');
            }}
          />
        ) : (
          <SettingsScreen
            settings={vault.settings}
            onChange={updateSettings}
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
  sessionMsLeft,
  onLock,
}: {
  screen: Screen;
  sessionMsLeft: number;
  onLock: () => void;
}) {
  const minutes = Math.floor(sessionMsLeft / 60000);
  const seconds = Math.floor((sessionMsLeft % 60000) / 1000);
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.title}>Kryptos</Text>
        <Text style={styles.subtitle}>
          {sessionMsLeft > 0 ? `Prefix session ${minutes}:${String(seconds).padStart(2, '0')}` : 'Zero-stored passwords'}
        </Text>
      </View>
      {screen !== 'unlock' ? (
        <Pressable style={styles.iconButton} onPress={onLock}>
          <Text style={styles.iconButtonText}>Lock</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function UnlockScreen({ onUnlock }: { onUnlock: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.panelTitle}>Encrypted vault</Text>
      <Text style={styles.bodyText}>Unlock local metadata with the system security prompt. Passwords and prefix are not stored.</Text>
      <PrimaryButton label="Unlock vault" onPress={onUnlock} />
    </View>
  );
}

function PrefixScreen({
  prefix,
  onPrefixChange,
  onStart,
  onLock,
}: {
  prefix: string;
  onPrefixChange: (value: string) => void;
  onStart: () => void;
  onLock: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.panelTitle}>Master prefix</Text>
      <Text style={styles.bodyText}>The prefix is encrypted in memory for this session only. It is cleared on timeout, background lock, or manual lock.</Text>
      <TextInput
        value={prefix}
        onChangeText={onPrefixChange}
        secureTextEntry
        placeholder="Enter master prefix"
        placeholderTextColor="#7b8494"
        style={styles.input}
      />
      <PrimaryButton label="Start session" onPress={onStart} />
      <SecondaryButton label="Lock vault" onPress={onLock} />
    </View>
  );
}

function HomeScreen({
  query,
  onQueryChange,
  entries,
  onOpen,
  onCreate,
  onBackup,
  onSettings,
  onPrefix,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  entries: VaultEntry[];
  onOpen: (entry: VaultEntry) => void;
  onCreate: () => void;
  onBackup: () => void;
  onSettings: () => void;
  onPrefix: () => void;
}) {
  return (
    <View style={styles.flex}>
      <View style={styles.toolbar}>
        <PrimaryButton label="Add" onPress={onCreate} compact />
        <SecondaryButton label="Backup" onPress={onBackup} compact />
        <SecondaryButton label="Prefix" onPress={onPrefix} compact />
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
          <Text style={styles.empty}>No entries yet.</Text>
        ) : (
          entries.map((entry) => (
            <Pressable key={entry.id} style={styles.row} onPress={() => onOpen(entry)}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{entry.webname}</Text>
                <Text style={styles.rowSub}>{entry.username}</Text>
              </View>
              <Text style={styles.meta}>{entry.length} / {entry.charsetPreset}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function EntryScreen({
  entry,
  generatedPassword,
  passwordVisible,
  onGenerate,
  onCopy,
  onEdit,
  onDelete,
  onBack,
}: {
  entry: VaultEntry;
  generatedPassword: string | null;
  passwordVisible: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.flex}>
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
        <PrimaryButton label="Show" onPress={onGenerate} compact />
        <PrimaryButton label="Copy" onPress={onCopy} compact />
        <SecondaryButton label="Edit" onPress={onEdit} compact />
        <DangerButton label="Delete" onPress={onDelete} compact />
      </View>
    </View>
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
          style={[styles.segmentItem, form.charsetPreset === 'full' && styles.segmentActive]}
          onPress={() => onChange({ ...form, charsetPreset: 'full' })}
        >
          <Text style={styles.segmentText}>Full</Text>
        </Pressable>
        <Pressable
          style={[styles.segmentItem, form.charsetPreset === 'alphanum' && styles.segmentActive]}
          onPress={() => onChange({ ...form, charsetPreset: 'alphanum' })}
        >
          <Text style={styles.segmentText}>Alphanum</Text>
        </Pressable>
      </View>
      <PrimaryButton label="Save" onPress={onSubmit} />
      <SecondaryButton label="Cancel" onPress={onCancel} />
    </ScrollView>
  );
}

function BackupScreen({
  mode,
  backupPassword,
  backupText,
  onPasswordChange,
  onTextChange,
  onExport,
  onImport,
  onBack,
}: {
  mode: 'merge' | 'replace';
  backupPassword: string;
  backupText: string;
  onPasswordChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onExport: () => void;
  onImport: () => void;
  onBack: () => void;
}) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.form}>
      <Text style={styles.panelTitle}>Encrypted backup</Text>
      <Text style={styles.bodyText}>Export/import uses KryptosCore Base64 format encrypted with a separate backup password. Import mode: {mode}.</Text>
      <TextInput
        value={backupPassword}
        onChangeText={onPasswordChange}
        secureTextEntry
        placeholder="Backup password"
        placeholderTextColor="#7b8494"
        style={styles.input}
      />
      <TextInput
        value={backupText}
        onChangeText={onTextChange}
        multiline
        placeholder="Encrypted Base64 backup"
        placeholderTextColor="#7b8494"
        style={[styles.input, styles.textArea]}
      />
      <PrimaryButton label="Export" onPress={onExport} />
      <SecondaryButton label="Import" onPress={onImport} />
      <SecondaryButton label="Back" onPress={onBack} />
    </ScrollView>
  );
}

function SettingsScreen({
  settings,
  onChange,
  onClear,
  clearConfirm,
  onBack,
}: {
  settings: VaultSettings;
  onChange: (settings: Partial<VaultSettings>) => void;
  onClear: () => void;
  clearConfirm: boolean;
  onBack: () => void;
}) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.form}>
      <Text style={styles.panelTitle}>Settings</Text>
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
      <Text style={styles.label}>Auto lock minutes</Text>
      <TextInput
        value={String(settings.autoLockMinutes)}
        keyboardType="number-pad"
        style={styles.input}
        onChangeText={(value) => onChange({ autoLockMinutes: Math.max(1, Number.parseInt(value, 10) || 1) })}
      />
      <Text style={styles.label}>Background lock seconds</Text>
      <TextInput
        value={String(settings.backgroundLockSeconds)}
        keyboardType="number-pad"
        style={styles.input}
        onChangeText={(value) => onChange({ backgroundLockSeconds: Math.max(5, Number.parseInt(value, 10) || 30) })}
      />
      <DangerButton label={clearConfirm ? 'Confirm clear' : 'Clear vault'} onPress={onClear} />
      <SecondaryButton label="Back" onPress={onBack} />
    </ScrollView>
  );
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

function PrimaryButton({ label, onPress, compact = false }: { label: string; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable style={[styles.button, styles.primaryButton, compact && styles.compactButton]} onPress={onPress}>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, compact = false }: { label: string; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable style={[styles.button, styles.secondaryButton, compact && styles.compactButton]} onPress={onPress}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

function DangerButton({ label, onPress, compact = false }: { label: string; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable style={[styles.button, styles.dangerButton, compact && styles.compactButton]} onPress={onPress}>
      <Text style={styles.dangerText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f5f7fb',
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
    flex: 1,
    justifyContent: 'center',
    gap: 14,
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
  textArea: {
    minHeight: 150,
    textAlignVertical: 'top',
    fontFamily: 'monospace',
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
  rowMain: {
    flex: 1,
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
