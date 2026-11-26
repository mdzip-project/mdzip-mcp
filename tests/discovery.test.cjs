// mdz_find_archives (mdzip-mcp only).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { connect, call, makeTempDir } = require('./helpers.cjs');

let temp;
let rootA;
let rootB;
let outside;
let client;
let unrestricted;

// Discovery only looks at names, so the files don't need to be real archives.
async function touch(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'not really a zip');
}

function paths(result) {
  assert.equal(result.isError, false, JSON.stringify(result.payload));
  return result.payload.archives.map((archive) => archive.path);
}

before(async () => {
  temp = await makeTempDir('mdzip-mcp-find-');
  rootA = path.join(temp, 'rootA');
  rootB = path.join(temp, 'rootB');
  outside = path.join(temp, 'outside');
  await touch(path.join(rootA, 'top.mdz'));
  await touch(path.join(rootA, 'Notes', 'Meeting Notes.MDZ'));
  await touch(path.join(rootA, 'a', 'b', 'c', 'deep.mdz'));
  await touch(path.join(rootA, '.hidden', 'secret.mdz'));
  await touch(path.join(rootA, 'node_modules', 'pkg', 'dep.mdz'));
  await touch(path.join(rootA, 'readme.md'));
  await touch(path.join(rootB, 'b.mdz'));
  await touch(path.join(outside, 'outside.mdz'));
  client = await connect(['--root', rootA, '--root', rootB]);
  unrestricted = await connect([]);
});

after(async () => {
  await client?.close();
  await unrestricted?.close();
  await fs.rm(temp, { recursive: true, force: true });
});

test('with no folder, searches every root', async () => {
  const found = paths(await call(client, 'mdz_find_archives', {}));
  assert.deepEqual(new Set(found), new Set([
    path.join(rootA, 'top.mdz'),
    path.join(rootA, 'Notes', 'Meeting Notes.MDZ'),
    path.join(rootA, 'a', 'b', 'c', 'deep.mdz'),
    path.join(rootB, 'b.mdz'),
  ]));
});

test('skips hidden folders and node_modules', async () => {
  const found = paths(await call(client, 'mdz_find_archives', {})).join('\n');
  assert.doesNotMatch(found, /secret\.mdz|dep\.mdz/);
});

test('returns size and modified time, nearest folders first', async () => {
  const result = await call(client, 'mdz_find_archives', { folder: rootA });
  const [first] = result.payload.archives;
  assert.equal(first.path, path.join(rootA, 'top.mdz'));
  assert.equal(first.bytes, 'not really a zip'.length);
  assert.ok(!Number.isNaN(Date.parse(first.modified)));
  assert.equal(result.payload.truncated, false);
});

test('nameContains filters by file name, ignoring case', async () => {
  const found = paths(await call(client, 'mdz_find_archives', { nameContains: 'meeting' }));
  assert.deepEqual(found, [path.join(rootA, 'Notes', 'Meeting Notes.MDZ')]);
});

test('maxDepth limits how far down it looks', async () => {
  const found = paths(await call(client, 'mdz_find_archives', { folder: rootA, maxDepth: 0 }));
  assert.deepEqual(found, [path.join(rootA, 'top.mdz')]);
});

test('maxResults cuts the list short and says so', async () => {
  const result = await call(client, 'mdz_find_archives', { maxResults: 2 });
  assert.equal(result.payload.archives.length, 2);
  assert.equal(result.payload.truncated, true);
  assert.ok(result.payload.hint);
});

test('a relative folder resolves against the first root', async () => {
  const found = paths(await call(client, 'mdz_find_archives', { folder: 'Notes' }));
  assert.deepEqual(found, [path.join(rootA, 'Notes', 'Meeting Notes.MDZ')]);
});

test('a folder outside the roots is refused', async () => {
  const result = await call(client, 'mdz_find_archives', { folder: outside });
  assert.equal(result.isError, true);
  assert.equal(result.payload.error.code, 'PATH_OUTSIDE_ROOTS');
});

test('a missing folder is reported', async () => {
  const result = await call(client, 'mdz_find_archives', { folder: path.join(rootA, 'nope') });
  assert.equal(result.isError, true);
  assert.equal(result.payload.error.code, 'FOLDER_NOT_FOUND');
});

test('a link to a folder outside a root is not followed', async (t) => {
  const link = path.join(rootB, 'link-out');
  try {
    await fs.symlink(outside, link, 'junction');
  } catch (error) {
    t.skip(`can't create a link here: ${error.code}`);
    return;
  }
  try {
    const found = paths(await call(client, 'mdz_find_archives', { folder: rootB })).join('\n');
    assert.doesNotMatch(found, /outside\.mdz/);
  } finally {
    await fs.rm(link, { recursive: false, force: true }).catch(() => fs.unlink(link));
  }
});

test('without --root, folder is required', async () => {
  const result = await call(unrestricted, 'mdz_find_archives', {});
  assert.equal(result.isError, true);
  assert.equal(result.payload.error.code, 'MISSING_FOLDER');
});

test('without --root, any folder can be searched', async () => {
  const found = paths(await call(unrestricted, 'mdz_find_archives', { folder: outside }));
  assert.deepEqual(found, [path.join(outside, 'outside.mdz')]);
});
