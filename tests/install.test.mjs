import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { run, updatePatch } from '../scripts/desktop.mjs';

const execute = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const row = '    - id: ui-ascii-ocean\n      name: "@local/dsh-client-ui-ascii-ocean"\n';
const registered = `# fixture configuration\n- insert:\n${row}`;
const original = '# keep this byte-for-byte\n- id: existing\n  config: !!js "({ untouched: true })"\n';
const noWait = async () => {};
async function fixture(t, patch = original) {
  const root = await fs.mkdtemp(join(tmpdir(), 'ascii-ocean-install-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profile = join(root, 'profile');
  await fs.mkdir(profile);
  const patchPath = join(profile, 'cordis.patch.yml');
  await fs.writeFile(patchPath, patch, { mode: 0o600 });
  const destination = join(profile, 'node_modules/@local/dsh-client-ui-ascii-ocean');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(join(destination, 'old-build.txt'), 'previous working build');
  return { root, profile, patchPath, destination, readPatch: () => fs.readFile(patchPath, 'utf8') };
}
async function has(path) { try { await fs.stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function assertOriginal(f, patch = original) {
  assert.equal(await f.readPatch(), patch);
  assert.equal(await fs.readFile(join(f.destination, 'old-build.txt'), 'utf8'), 'previous working build');
  assert.equal(await has(join(f.profile, '.ascii-ocean-install.lock')), false);
  const parents = await fs.readdir(dirname(f.destination));
  assert.equal(parents.some(name => name.startsWith('.ascii-ocean-stage-')), false);
}

test('exact direct id handling preserves shared siblings, comments, order, CRLF and !!js without evaluation', () => {
  const sibling = '    # untouched sibling\r\n    - id: another\r\n      config:\r\n        note: ui-ascii-ocean\r\n        expression: !!js "process.exit(99)"\r\n        id: ui-ascii-ocean\r\n';
  const target = '    - name: "@local/dsh-client-ui-ascii-ocean"\r\n      id: "ui-ascii-ocean" # exact direct id\r\n';
  const before = '# id: ui-ascii-ocean is only documentation\r\n- insert:\r\n' + sibling + target + '    # keep following comment\r\n    - id: last\r\n      name: last\r\n';
  assert.equal(updatePatch(before, 'install'), before);
  assert.equal(updatePatch(before, 'uninstall'), before.replace(target, ''));
});

test('comment-only and prefix ids do not hide a missing registration; installation is idempotent', () => {
  const before = '# id: ui-ascii-ocean\n- insert:\n    - id: ui-ascii-ocean-other\n      name: other\n';
  const installed = updatePatch(before, 'install');
  assert.ok(installed.startsWith(before));
  assert.ok(installed.endsWith('- insert:\n' + row));
  assert.equal(updatePatch(installed, 'install'), installed);
  assert.equal(updatePatch(installed, 'uninstall'), before);
});

test('first-line and flow-style registrations preserve shared insert siblings', () => {
  assert.equal(updatePatch('- insert:\n' + row, 'uninstall'), '[]\n');
  const before = '- insert: [{id: first}, {name: "@local/dsh-client-ui-ascii-ocean", id: ui-ascii-ocean}, {id: last}]\n';
  assert.equal(updatePatch(before, 'uninstall'), '- insert: [{id: first}, {id: last}]\n');
  const rootFlow = '[{insert: [{id: ui-ascii-ocean, name: "@local/dsh-client-ui-ascii-ocean"}]}, {id: keep}]\n';
  assert.equal(updatePatch(rootFlow, 'uninstall'), '[ {id: keep}]\n');
});

test('duplicate registration is rejected on update and safely removed on uninstall', () => {
  const before = '- insert:\n' + row + row + '    - id: other\n      name: other\n';
  assert.throws(() => updatePatch(before, 'install'), /Duplicate/);
  assert.equal(updatePatch(before, 'uninstall'), '- insert:\n    - id: other\n      name: other\n');
});

test('an emptied insertion does not delete other operations in the same outer patch', () => {
  const before = '- id: target\n  config: {keep: true} # preserve this operation\n  insert:\n' + row + '  disabled: false\n';
  assert.equal(updatePatch(before, 'uninstall'), '- id: target\n  config: {keep: true} # preserve this operation\n  insert:\n    []\n  disabled: false\n');
  const flow = '- {id: target, insert: [{id: ui-ascii-ocean, name: "@local/dsh-client-ui-ascii-ocean"}], disabled: false}\n';
  assert.equal(updatePatch(flow, 'uninstall'), '- {id: target, insert: [], disabled: false}\n');
});

test('UTF-8 BOM is retained and aliases cannot be left dangling by uninstall', () => {
  assert.equal(updatePatch('\uFEFF- insert:\n' + row, 'uninstall'), '\uFEFF[]\n');
  const before = '- insert:\n    - &ocean {id: ui-ascii-ocean, name: "@local/dsh-client-ui-ascii-ocean"}\n    - id: sibling\n      config: *ocean\n';
  assert.throws(() => updatePatch(before, 'uninstall'), /alias would lose its anchor/);
});

test('malformed YAML, a foreign package id and dynamic insert lists fail before writes', async t => {
  for (const patch of ['- insert: [broken\n', '- insert:\n    - id: ui-ascii-ocean\n      name: other\n', '- insert: !!js createPlugins()\n']) {
    const f = await fixture(t, patch);
    await assert.rejects(run({ action: 'install', profile: f.profile, source: repo }));
    await assertOriginal(f, patch);
    assert.equal(await has(join(f.profile, '.ascii-ocean-backups')), false);
  }
});

test('missing source leaves the previous package and configuration intact before creating backups', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'incomplete');
  await fs.mkdir(source);
  await assert.rejects(run({ action: 'install', profile: f.profile, source }), /Missing or invalid installation source/);
  await assertOriginal(f);
  assert.equal(await has(join(f.profile, '.ascii-ocean-backups')), false);
});

test('staging failure leaves the old package intact and cleans temporary paths', async t => {
  const f = await fixture(t);
  const io = { ...fs, async copyFile() { throw new Error('injected disk failure while staging'); } };
  await assert.rejects(run({ action: 'install', profile: f.profile, source: repo, io }), /injected disk failure/);
  await assertOriginal(f);
});

test('failed package activation rolls back the renamed old package', async t => {
  const f = await fixture(t);
  const io = { ...fs, async rename(from, to) { if (from.includes('.ascii-ocean-stage-')) throw new Error('injected activation failure'); return fs.rename(from, to); } };
  await assert.rejects(run({ action: 'install', profile: f.profile, source: repo, io }), /injected activation failure/);
  await assertOriginal(f);
});

test('failed atomic patch write rolls back the newly activated package', async t => {
  const f = await fixture(t);
  const io = { ...fs, async rename(from, to) { if (to === f.patchPath) throw new Error('injected patch replacement failure'); return fs.rename(from, to); } };
  await assert.rejects(run({ action: 'install', profile: f.profile, source: repo, io }), /injected patch replacement failure/);
  await assertOriginal(f);
});

test('a concurrent config edit is preserved while installation rolls back its package', async t => {
  const f = await fixture(t);
  const changed = original + '# an external editor changed this\n';
  const io = { ...fs, async rename(from, to) { await fs.rename(from, to); if (from.includes('.ascii-ocean-stage-')) await fs.writeFile(f.patchPath, changed); } };
  await assert.rejects(run({ action: 'install', profile: f.profile, source: repo, io }), /changed during/);
  await assertOriginal(f, changed);
});

test('uninstall removes config first, retains importable package while waiting, then archives it', async t => {
  const f = await fixture(t, registered);
  const result = await run({ action: 'uninstall', profile: f.profile, waitForUnload: async () => {
    assert.equal(await f.readPatch(), '# fixture configuration\n[]\n');
    assert.equal(await has(join(f.destination, 'old-build.txt')), true);
  } });
  assert.equal(await has(f.destination), false);
  assert.equal(await fs.readFile(join(result.backup, 'package/old-build.txt'), 'utf8'), 'previous working build');
  assert.equal(await fs.readFile(join(result.backup, 'cordis.patch.yml'), 'utf8'), registered);
  assert.equal((await fs.stat(result.backup)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(f.patchPath)).mode & 0o777, 0o600);
  assert.equal((await run({ action: 'uninstall', profile: f.profile, waitForUnload: noWait })).changed, false);
});

test('uninstall package-archive failure restores config and retains the old package', async t => {
  const f = await fixture(t, registered);
  const io = { ...fs, async rename(from, to) { if (from === f.destination) throw new Error('injected package archive failure'); return fs.rename(from, to); } };
  await assert.rejects(run({ action: 'uninstall', profile: f.profile, io, waitForUnload: noWait }), /injected package archive failure/);
  await assertOriginal(f, registered);
});

test('Bash install/update/uninstall entry points work offline against a real temporary profile', async t => {
  const f = await fixture(t);
  const env = { ...process.env, DSH_PROFILE_DIR: f.profile, DSH_NODE_BIN: process.execPath };
  await execute('bash', [join(repo, 'install-desktop.sh')], { env });
  const installedPatch = await f.readPatch();
  assert.equal(updatePatch(installedPatch, 'install'), installedPatch);
  for (const name of ['lib/client.js', 'lib/index.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'scripts/desktop.mjs', 'scripts/vendor/yaml.LICENSE']) {
    assert.deepEqual(await fs.readFile(join(f.destination, name)), await fs.readFile(join(repo, name)));
  }
  await execute('bash', [join(repo, 'install-desktop.sh')], { env });
  assert.equal(await f.readPatch(), installedPatch);
  const backupDirs = await fs.readdir(join(f.profile, '.ascii-ocean-backups'));
  assert.equal(backupDirs.length, 2);
  // Run from the installed package too: helper + parser are deployed alongside it.
  await execute('bash', [join(f.destination, 'uninstall-desktop.sh')], { env });
  assert.equal(await f.readPatch(), original);
  assert.equal(await has(f.destination), false);
});

test('standalone copied shell entry point fails clearly before touching a profile', async t => {
  const f = await fixture(t);
  const isolated = join(f.root, 'install-desktop.sh');
  await fs.copyFile(join(repo, 'install-desktop.sh'), isolated);
  await assert.rejects(execute('bash', [isolated], { env: { ...process.env, DSH_PROFILE_DIR: f.profile } }), error => /support files are missing/.test(error.stderr));
  await assertOriginal(f);
});

test('explicit missing Node executable fails without changing the profile', async t => {
  const f = await fixture(t);
  await assert.rejects(execute('bash', [join(repo, 'install-desktop.sh')], { env: { ...process.env, DSH_PROFILE_DIR: f.profile, DSH_NODE_BIN: join(f.root, 'no-node') } }), error => /Node.js 18\+/.test(error.stderr));
  await assertOriginal(f);
});

test('macOS entry point can use DSH bundled Node when system Node is not on PATH', async t => {
  const bundledNode = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node';
  if (process.platform !== 'darwin' || !await has(bundledNode)) { t.skip('DSH macOS bundled runtime is unavailable'); return; }
  const f = await fixture(t);
  const env = { ...process.env, PATH: '/usr/bin:/bin', DSH_PROFILE_DIR: f.profile };
  delete env.DSH_NODE_BIN;
  await execute('/bin/bash', [join(repo, 'install-desktop.sh')], { env });
  assert.equal(await has(join(f.destination, 'lib/client.js')), true);
  assert.equal(updatePatch(await f.readPatch(), 'install'), await f.readPatch());
});
