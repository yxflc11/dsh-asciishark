#!/usr/bin/env node
// Offline installer shared by the Bash and PowerShell entry points.
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseDocument, isMap, isSeq, isScalar, isAlias } from './vendor/yaml.mjs';

const ID = 'ui-ascii-ocean';
const PACKAGE = '@local/dsh-client-ui-ascii-ocean';
const SOURCE_FILES = [
  'lib/client.js', 'lib/index.js', 'package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'install-desktop.sh', 'uninstall-desktop.sh', 'install-desktop.ps1', 'uninstall-desktop.ps1',
  'scripts/desktop.mjs', 'scripts/vendor/yaml.mjs', 'scripts/vendor/yaml.LICENSE', 'scripts/vendor/README.md',
];

function parsePatch(text) {
  text = text.replace(/^\uFEFF/, '');
  const doc = parseDocument(text, { keepSourceTokens: true, prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length) throw new Error(`Invalid profile YAML: ${doc.errors[0].message}`);
  if (doc.contents !== null && !isSeq(doc.contents)) throw new Error('Profile patch must be a YAML sequence. No files were changed.');
  const checkAliases = node => {
    if (isAlias(node) && !node.resolve(doc)) throw new Error('A YAML alias would lose its anchor. No files were changed.');
    if (isSeq(node)) node.items.forEach(checkAliases);
    if (isMap(node)) node.items.forEach(pair => { checkAliases(pair.key); checkAliases(pair.value); });
  };
  checkAliases(doc.contents);
  return doc;
}

const scalar = (map, key) => {
  const node = isMap(map) ? map.get(key, true) : null;
  return isScalar(node) ? node.value : undefined;
};

function registrations(doc) {
  const rows = [];
  for (const [outerIndex, patch] of (doc.contents?.items ?? []).entries()) {
    const insert = isMap(patch) ? patch.get('insert', true) : null;
    if (insert && !isSeq(insert)) throw new Error('An insert list uses an alias or dynamic value. Expand it to an explicit YAML sequence before using this installer. No files were changed.');
    if (!isSeq(insert)) continue;
    for (const [index, entry] of insert.items.entries()) {
      if (scalar(entry, 'id') !== ID) continue;
      if (scalar(entry, 'name') !== PACKAGE) throw new Error(`The id ${ID} belongs to a different or unspecified package. No files were changed.`);
      rows.push({ outerIndex, patch, insert, index, entry });
    }
  }
  return rows;
}

// Source slices retain every unrelated byte, including comments, line endings,
// quoting and unknown !!js tags. Nothing in the YAML is evaluated.
function itemSpan(text, sequence, index) {
  const node = sequence.items[index];
  const token = sequence.srcToken?.items[index];
  if (sequence.srcToken?.type === 'block-seq') {
    const dash = token.start.find(part => part.type === 'seq-item-ind');
    if (!dash || !node?.range) throw new Error('Cannot safely locate the plugin YAML entry. No files were changed.');
    const start = text.lastIndexOf('\n', dash.offset - 1) + 1;
    if (!/^\s*$/.test(text.slice(start, dash.offset))) throw new Error('Unsupported inline sequence indentation. No files were changed.');
    return [start, node.range[2]];
  }
  if (sequence.srcToken?.type === 'flow-collection') {
    if (!node?.range) throw new Error('Cannot safely locate a flow YAML entry. No files were changed.');
    // Keep adjacent comments, removing only the item and its separating comma.
    const previousComma = token.start?.find(part => part.type === 'comma');
    if (previousComma) return [previousComma.offset, node.range[1]];
    const nextComma = sequence.srcToken.items[index + 1]?.start?.find(part => part.type === 'comma');
    return [node.range[0], nextComma ? nextComma.offset + 1 : node.range[1]];
  }
  throw new Error('Unsupported YAML sequence representation. No files were changed.');
}

export function updatePatch(text, action) {
  if (text.startsWith('\uFEFF')) return '\uFEFF' + updatePatch(text.slice(1), action);
  let doc = parsePatch(text);
  let rows = registrations(doc);
  if (action === 'install') {
    if (rows.length > 1) throw new Error(`Duplicate ${ID} registrations; resolve them before updating. No files were changed.`);
    if (rows.length === 1) return text;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let next;
    if (doc.contents?.srcToken?.type === 'flow-collection') {
      const end = doc.contents.srcToken.end.find(part => part.type === 'flow-seq-end').offset;
      const comma = doc.contents.items.length ? ',' : '';
      next = text.slice(0, end) + `${comma} { insert: [{ id: ${ID}, name: "${PACKAGE}" }] }` + text.slice(end);
    } else {
      const offset = doc.contents?.range[2] ?? text.length;
      const prefix = text.slice(0, offset);
      const snippet = `- insert:${eol}    - id: ${ID}${eol}      name: "${PACKAGE}"${eol}`;
      next = prefix + (prefix && !prefix.endsWith('\n') ? eol : '') + snippet + text.slice(offset);
    }
    if (registrations(parsePatch(next)).length !== 1) throw new Error('Could not validate the new plugin registration. No files were changed.');
    return next;
  }
  if (action !== 'uninstall') throw new Error(`Unknown action: ${action}`);
  // Reparse after each deletion: source offsets and comma ownership then stay
  // correct for duplicates and mixed block/flow collections.
  while (rows.length) {
    const row = rows.at(-1);
    if (row.insert.items.length === 1 && row.patch.items.length > 1) {
      // A patch can carry other operations/metadata alongside insert. Keep that
      // complete mapping and only empty this insertion list.
      const [start, , end] = row.insert.range;
      const removed = text.slice(start, end);
      const eol = removed.endsWith('\r\n') ? '\r\n' : removed.endsWith('\n') ? '\n' : '';
      text = text.slice(0, start) + '[]' + eol + text.slice(end);
    } else {
      const sequence = row.insert.items.length === 1 ? doc.contents : row.insert;
      const index = row.insert.items.length === 1 ? row.outerIndex : row.index;
      const [start, end] = itemSpan(text, sequence, index);
      const replacement = sequence === doc.contents && sequence.items.length === 1 && sequence.srcToken.type === 'block-seq' ? '[]' + (text.includes('\r\n') ? '\r\n' : '\n') : '';
      text = text.slice(0, start) + replacement + text.slice(end);
    }
    doc = parsePatch(text);
    rows = registrations(doc);
  }
  return text;
}

async function optionalStat(path, io) {
  try { return await io.lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function atomicPatch(path, expected, next, mode, io) {
  if ((await io.readFile(path, 'utf8')) !== expected) throw new Error('The profile patch changed during this operation; refusing to overwrite it.');
  if (expected === next) return;
  const temporary = `${path}.ascii-ocean-${randomUUID()}.tmp`;
  try {
    const file = await io.open(temporary, 'wx', mode);
    try { await file.writeFile(next, 'utf8'); await file.sync(); } finally { await file.close(); }
    // A second check narrows the race with DSH Settings or another editor.
    if ((await io.readFile(path, 'utf8')) !== expected) throw new Error('The profile patch changed during this operation; refusing to overwrite it.');
    await io.rename(temporary, path);
  } finally {
    await io.rm(temporary, { force: true });
  }
}

export async function run({ action, profile, source = resolve(dirname(fileURLToPath(import.meta.url)), '..'), io = fs, waitForUnload = () => new Promise(done => setTimeout(done, 8000)) }) {
  if (!['install', 'uninstall'].includes(action)) throw new Error('Expected install or uninstall.');
  profile = resolve(profile);
  source = resolve(source);
  const patch = join(profile, 'cordis.patch.yml');
  const destination = join(profile, 'node_modules', PACKAGE);
  const patchStat = await optionalStat(patch, io);
  if (!patchStat?.isFile() || patchStat.isSymbolicLink()) throw new Error(`Expected a regular profile patch at ${patch}. Initialize the DSH profile first; symbolic links are not replaced.`);
  const packageStat = await optionalStat(destination, io);
  if (packageStat && (!packageStat.isDirectory() || packageStat.isSymbolicLink())) throw new Error(`Refusing to replace a non-directory or linked package: ${destination}`);
  const original = await io.readFile(patch, 'utf8');
  const next = updatePatch(original, action);
  if (action === 'install') {
    for (const name of SOURCE_FILES) {
      const stat = await optionalStat(join(source, name), io);
      if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`Missing or invalid installation source: ${name}. The previous installation is unchanged.`);
    }
    const manifest = JSON.parse(await io.readFile(join(source, 'package.json'), 'utf8'));
    if (manifest.name !== PACKAGE) throw new Error('The source package name does not match this installer.');
  } else if (!packageStat && next === original) {
    return { action, changed: false, destination, backup: null };
  }

  const lockPath = join(profile, '.ascii-ocean-install.lock');
  let lock;
  try { lock = await io.open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Another installation may be running (${lockPath}). If it was interrupted, verify it has stopped before removing this lock.`); throw error; }
  let staging;
  let backup;
  let oldMoved = false;
  let installed = false;
  let patchWritten = false;
  try {
    await lock.writeFile(`${process.pid}\n`);
    // All content checks above happen before the first write. Keep the exact
    // original patch and previous package for recovery after successful updates.
    if ((await io.readFile(patch, 'utf8')) !== original) throw new Error('The profile patch changed before the transaction started.');
    const backupRoot = join(profile, '.ascii-ocean-backups');
    await io.mkdir(backupRoot, { recursive: true, mode: 0o700 });
    backup = await io.mkdtemp(join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-`));
    await io.chmod(backup, 0o700);
    const patchBackup = join(backup, 'cordis.patch.yml');
    await io.writeFile(patchBackup, original, { flag: 'wx', mode: patchStat.mode & 0o777 });
    if ((await io.readFile(patchBackup, 'utf8')) !== original) throw new Error('Could not verify the configuration backup.');

    if (action === 'install') {
      await io.mkdir(dirname(destination), { recursive: true });
      staging = await io.mkdtemp(join(dirname(destination), '.ascii-ocean-stage-'));
      for (const name of SOURCE_FILES) {
        await io.mkdir(dirname(join(staging, name)), { recursive: true });
        await io.copyFile(join(source, name), join(staging, name), constants.COPYFILE_EXCL);
        const [before, copied] = await Promise.all([io.readFile(join(source, name)), io.readFile(join(staging, name))]);
        if (!before.equals(copied)) throw new Error(`Staged file verification failed: ${name}`);
      }
      if (packageStat) { await io.rename(destination, join(backup, 'package')); oldMoved = true; }
      await io.rename(staging, destination);
      staging = undefined;
      installed = true;
      await atomicPatch(patch, original, next, patchStat.mode & 0o777, io);
      patchWritten = original !== next;
    } else {
      await atomicPatch(patch, original, next, patchStat.mode & 0o777, io);
      patchWritten = original !== next;
      if (packageStat) {
        // Keep the package importable while DSH's patch watcher settles. The
        // removed package is archived, not irreversibly deleted.
        await waitForUnload();
        if (registrations(parsePatch(await io.readFile(patch, 'utf8'))).length) throw new Error('The plugin was registered again during uninstall; its package has been retained.');
        await io.rename(destination, join(backup, 'package'));
        oldMoved = true;
      }
    }
    return { action, changed: true, destination, backup };
  } catch (error) {
    const recovery = [];
    if (patchWritten) {
      try { await atomicPatch(patch, next, original, patchStat.mode & 0o777, io); }
      catch (restoreError) { recovery.push(`configuration recovery: ${restoreError.message}`); }
    }
    if (installed) {
      try { await io.rm(destination, { recursive: true, force: true }); }
      catch (restoreError) { recovery.push(`new package cleanup: ${restoreError.message}`); }
    }
    if (oldMoved) {
      try { await io.rename(join(backup, 'package'), destination); }
      catch (restoreError) { recovery.push(`previous package recovery: ${restoreError.message}`); }
    }
    throw new Error(`${error.message}${recovery.length ? ` Recovery needs attention: ${recovery.join('; ')}. Backup: ${backup}` : ' The previous package and configuration have been preserved.'}`, { cause: error });
  } finally {
    if (staging) await io.rm(staging, { recursive: true, force: true });
    await lock.close();
    await io.rm(lockPath, { force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === await fs.realpath(process.argv[1]).catch(() => null)) {
  try {
    if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node.js 18 or newer is required. No files were changed.');
    const [action, profile] = process.argv.slice(2);
    if (!profile) throw new Error('Usage: node scripts/desktop.mjs install|uninstall <profile-directory>');
    const result = await run({ action, profile });
    console.log(`${result.changed ? action === 'install' ? 'installed' : 'uninstalled' : 'already uninstalled'}: ${result.destination}`);
    if (result.backup) console.log(`recovery backup: ${result.backup}`);
    if (action === 'install') console.log('If an open DSH window still shows the previous build, reload its page once (Cmd+R / Ctrl+R).');
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
