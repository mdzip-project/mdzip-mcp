// Atomic archive writes (mdzip-mcp only).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { connect, call, makeTempDir } = require('./helpers.cjs');

let temp;
let client;

async function createArchive(archivePath) {
  const result = await call(client, 'mdz_create_archive', { archivePath, files: [{ path: 'index.md', content: '# Doc\n' }] });
  assert.equal(result.isError, false, JSON.stringify(result.payload));
  return result.payload;
}

async function tempFiles(dir) {
  return (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
}

before(async () => {
  temp = await makeTempDir('mdzip-mcp-atomic-');
  client = await connect([]);
});

after(async () => {
  await client?.close();
  await fs.rm(temp, { recursive: true, force: true });
});

test('every write tool replaces the archive and leaves no temp files', async () => {
  const archivePath = path.join(temp, 'doc.mdz');
  await createArchive(archivePath);

  const added = await call(client, 'mdz_write_entry', { archivePath, entryPath: 'notes.md', content: '# Notes\n' });
  assert.equal(added.isError, false, JSON.stringify(added.payload));

  const review = await call(client, 'mdz_review_document', { archivePath });
  const hash = JSON.parse(JSON.stringify(review.payload)).canonicalContentHash;
  const upsert = await call(client, 'upsert_canonical_document', { archivePath, content: '# Changed\n', expectedContentHash: hash });
  assert.equal(upsert.isError, false, JSON.stringify(upsert.payload));

  const removed = await call(client, 'mdz_remove_entry', { archivePath, entryPath: 'notes.md', expectedEntryHash: added.payload.entryHash });
  assert.equal(removed.isError, false, JSON.stringify(removed.payload));

  const replaced = await call(client, 'mdz_create_archive', {
    archivePath,
    overwrite: true,
    files: [{ path: 'index.md', content: '# Replaced\n' }],
  });
  assert.equal(replaced.isError, false, JSON.stringify(replaced.payload));

  const read = await call(client, 'mdz_read_text', { archivePath, entryPath: 'index.md' });
  assert.equal(read.payload, '# Replaced\n');
  assert.deepEqual(await tempFiles(temp), []);
});

test('creating over an existing archive without overwrite is refused and changes nothing', async () => {
  const archivePath = path.join(temp, 'exists.mdz');
  await createArchive(archivePath);
  const before = await fs.readFile(archivePath);
  const result = await call(client, 'mdz_create_archive', { archivePath, files: [{ path: 'index.md', content: '# Other\n' }] });
  assert.equal(result.isError, true);
  assert.equal(result.payload.error.code, 'ARCHIVE_EXISTS');
  assert.deepEqual(await fs.readFile(archivePath), before);
  assert.deepEqual(await tempFiles(temp), []);
});

test('a failed write leaves the old archive whole', async (t) => {
  if (process.platform === 'win32') {
    t.skip('read-only folders don\'t block new files on Windows');
    return;
  }
  if (process.getuid?.() === 0) {
    t.skip('root ignores folder permissions');
    return;
  }
  const dir = path.join(temp, 'locked');
  await fs.mkdir(dir);
  const archivePath = path.join(dir, 'doc.mdz');
  await createArchive(archivePath);
  const before = await fs.readFile(archivePath);
  await fs.chmod(dir, 0o555); // The temp file can't be created, so the write fails.
  try {
    const result = await call(client, 'mdz_write_entry', { archivePath, entryPath: 'notes.md', content: '# Notes\n' });
    assert.equal(result.isError, true);
  } finally {
    await fs.chmod(dir, 0o755);
  }
  assert.deepEqual(await fs.readFile(archivePath), before);
  assert.deepEqual(await tempFiles(dir), []);
});

test('writing through a link updates the target and keeps the link', async (t) => {
  const target = path.join(temp, 'target.mdz');
  const link = path.join(temp, 'link.mdz');
  await createArchive(target);
  try {
    await fs.symlink(target, link, 'file');
  } catch (error) {
    t.skip(`can't create a file link here: ${error.code}`);
    return;
  }
  const result = await call(client, 'mdz_write_entry', { archivePath: link, entryPath: 'notes.md', content: '# Via link\n' });
  assert.equal(result.isError, false, JSON.stringify(result.payload));
  assert.ok((await fs.lstat(link)).isSymbolicLink());
  const read = await call(client, 'mdz_read_text', { archivePath: target, entryPath: 'notes.md' });
  assert.equal(read.payload, '# Via link\n');
});

test('file permissions are kept', async (t) => {
  if (process.platform === 'win32') {
    t.skip('no Unix permissions on Windows');
    return;
  }
  const archivePath = path.join(temp, 'mode.mdz');
  await createArchive(archivePath);
  await fs.chmod(archivePath, 0o640);
  const result = await call(client, 'mdz_write_entry', { archivePath, entryPath: 'notes.md', content: '# Notes\n' });
  assert.equal(result.isError, false, JSON.stringify(result.payload));
  assert.equal((await fs.stat(archivePath)).mode & 0o777, 0o640);
});
