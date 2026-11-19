// Exercise the real screen's React handlers with native host views stubbed.
// No device storage, authentication, network or user vault is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const exportsForTest = {};
let openedRelease;
function screenRequire(name) {
  if (name === 'react' || name === 'react/jsx-runtime') return require(name);
  if (name === 'react-native') return {
    Text: 'Text', TextInput: 'TextInput', View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable', Switch: 'Switch',
    Linking: { openURL: async (url) => { openedRelease = url; } },
    StyleSheet: { create: (styles) => styles }, Platform: { OS: 'test' },
  };
  if (name === './src/update/release.ts') return { RELEASE_PAGE: 'https://github.com/Huasushis/KryptosMobile/releases/latest' };
  return {}; // Other App imports are unused by SyncConflictScreen.
}
new Function('require', 'exports', compiled)(screenRequire, exportsForTest);
const { SyncConflictScreen } = exportsForTest;
const local = { webname: 'github.com', username: 'alice', uuid: 'device-seed', length: 16, charsetPreset: 'full' };
const conflicts = [
  { local, remote: { ...local, uuid: 'cloud-seed', length: 20 } },
  { local: { ...local, webname: 'gitlab.com' }, remote: { ...local, webname: 'gitlab.com', charsetPreset: 'alphanum' } },
];
let applied;
let cancels = 0;
let renderer;
const props = { conflicts, onResolve: (choices) => { applied = choices; }, onCancel: () => { cancels++; } };
const label = (node) => node.findByType('Text').children.join('');
const button = (text) => renderer.root.findAllByType('Pressable').find((node) => label(node) === text);
function click(text) {
  const target = button(text);
  assert(target, `missing button: ${text}`);
  assert(!target.props.disabled, `disabled button: ${text}`);
  act(() => target.props.onPress());
}
act(() => { renderer = create(React.createElement(SyncConflictScreen, props)); });
assert.equal(button('Next account').props.disabled, true);
assert(JSON.stringify(renderer.toJSON()).includes('account seeds differ'));
click('Use cloud');
assert(button('Selected: use cloud'));
click('Next account');
assert.equal(button('Apply choices and sync').props.disabled, true);
click('Keep local');
click('Previous account');
assert(button('Selected: use cloud')); // Previous choices survive navigation.
click('Keep local');
click('Next account');
click('Apply choices and sync');
assert.deepEqual(applied, ['local', 'local']);
assert.equal(button('Apply choices and sync').props.disabled, true);
act(() => renderer.unmount());
applied = undefined;
act(() => { renderer = create(React.createElement(SyncConflictScreen, props)); });
click('Use cloud'); click('Next account'); click('Keep local'); click('Apply choices and sync');
assert.deepEqual(applied, ['remote', 'local']);
act(() => renderer.unmount());
applied = undefined;
act(() => { renderer = create(React.createElement(SyncConflictScreen, props)); });
click('Use cloud'); click('Cancel sync');
assert.equal(cancels, 1);
assert.equal(applied, undefined);
act(() => renderer.unmount());
console.log('ok - Conflict screen requires every choice, preserves navigation, submits mixed choices and supports cancellation');

const { UpdateSettings } = exportsForTest;
let checked = 0, installed = 0, auto = false;
const updateProps = {
  version: '1.1.0', supported: true, autoCheck: false, onAutoCheck: (value) => { auto = value; },
  available: null, busy: false, message: '', onCheck: () => { checked++; }, onInstall: () => { installed++; },
};
act(() => { renderer = create(React.createElement(UpdateSettings, updateProps)); });
assert.equal(installed, 0); // Opening the settings must never install anything.
click('Check for updates'); assert.equal(checked, 1);
act(() => renderer.root.findByType('Switch').props.onValueChange(true)); assert.equal(auto, true);
const available = { version: '1.2.0', versionCode: 1002000, sha256: 'a'.repeat(64), url: 'unused' };
act(() => renderer.update(React.createElement(UpdateSettings, { ...updateProps, available })));
assert.equal(installed, 0); // Finding a release still requires an explicit install action.
click('Download and install 1.2.0'); assert.equal(installed, 1);
act(() => renderer.update(React.createElement(UpdateSettings, { ...updateProps, available, busy: true })));
assert.equal(button('Working...').props.disabled, true);
assert.equal(button('Download and install 1.2.0').props.disabled, true);
click('Open releases (manual download)');
assert.equal(openedRelease, 'https://github.com/Huasushis/KryptosMobile/releases/latest');
act(() => renderer.unmount());
console.log('ok - Update settings separate checking from installation and prevent duplicate actions while busy');

const { BackupScreen } = exportsForTest;
let savedPassword = 0, savedConnection = 0, clearedSettings = 0, synced = 0, rememberBackup = false;
const backupProps = {
  mode: 'merge', backupPassword: '', rememberBackupPassword: false, onRememberBackupPassword: (value) => { rememberBackup = value; },
  onSaveBackupPassword: () => { savedPassword++; }, rememberDavPassword: true, onRememberDavPassword: () => {},
  onSaveDavSettings: () => { savedConnection++; }, onClearSyncSettings: () => { clearedSettings++; }, backupText: '',
  onPasswordChange: () => {}, onExport: () => {}, onImport: () => {}, onPaste: () => {}, onCopyBackup: () => {}, onClearBackup: () => {},
  busy: false, davConfig: { url: '', directory: 'Kryptos', username: '', password: '' }, onDavChange: () => {}, onSync: () => { synced++; }, onBack: () => {},
};
act(() => { renderer = create(React.createElement(BackupScreen, backupProps)); });
assert.equal(synced, 0); // Opening Backup or saving preferences must not trigger sync.
act(() => renderer.root.findAllByType('Switch')[0].props.onValueChange(true));
assert.equal(rememberBackup, true);
act(() => renderer.update(React.createElement(BackupScreen, { ...backupProps, rememberBackupPassword: true })));
assert.equal(button('Save backup password preference').props.disabled, true);
act(() => renderer.update(React.createElement(BackupScreen, { ...backupProps, backupPassword: 'secret', rememberBackupPassword: true })));
assert.equal(renderer.root.findAllByType('TextInput')[0].props.secureTextEntry, true);
click('Save backup password preference'); assert.equal(savedPassword, 1);
click('Save WebDAV settings'); assert.equal(savedConnection, 1);
click('Clear saved connection and passwords'); assert.equal(clearedSettings, 1);
assert.equal(synced, 0);
click('Sync with WebDAV'); assert.equal(synced, 1);
act(() => renderer.update(React.createElement(BackupScreen, { ...backupProps, busy: true })));
assert.equal(button('Save backup password preference').props.disabled, true);
assert.equal(button('Clear saved connection and passwords').props.disabled, true);
act(() => renderer.unmount());
console.log('ok - Backup remembers passwords explicitly, supports separate settings/clear, and syncs only on request');
