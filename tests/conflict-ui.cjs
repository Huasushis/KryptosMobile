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
function screenRequire(name) {
  if (name === 'react' || name === 'react/jsx-runtime') return require(name);
  if (name === 'react-native') return {
    Text: 'Text', View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable',
    StyleSheet: { create: (styles) => styles }, Platform: { OS: 'test' },
  };
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
