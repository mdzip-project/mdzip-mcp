// --root folder limits (mdzip-mcp only). Runs the built bundle over stdio.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { SERVER, connect, call: callOn, exists } = require('./helpers.cjs');

let temp;
let rootA;
let rootB;
let outside;
let outsideArchive;
let outsideImage;
let client;

function call(name, args) {
  return callOn(client, name, args);
}

function assertOutside(result) {
  assert.equal(result.isError, true, JSON.stringify(result.payload));
  assert.equal(result.payload.error.code, 'PATH_OUTSIDE_ROOTS');
}

before(async () => {
  // realpath so comparisons hold where the temp folder is a symlink (macOS /var -> /private/var).
  temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mdzip-mcp-roots-')));
  rootA = path.join(temp, 'rootA');
  rootB = path.join(temp, 'rootB');
  outside = path.join(temp, 'outside');
  await Promise.all([rootA, rootB, outside].map((dir) => fs.mkdir(dir)));

  // Make the outside archive with a server that has no roots.
  const unrestricted = await connect([]);
  outsideArchive = path.join(outside, 'secret.mdz');
  const made = await unrestricted.callTool({
    name: 'mdz_create_archive',
    arguments: { archivePath: outsideArchive, files: [{ path: 'index.md', content: '# Secret\n' }] },
  });
  assert.notEqual(made.isError, true, made.content[0].text);
  await unrestricted.close();
  outsideImage = path.join(outside, 'image.svg');
  await fs.writeFile(outsideImage, '<svg xmlns="http://www.w3.org/2000/svg"/>');

  client = await connect(['--root', rootA, `--root=${rootB}`]);
});

after(async () => {
  await client?.close();
  await fs.rm(temp, { recursive: true, force: true });
});

test('instructions name the allowed folders', () => {
  const instructions = client.getInstructions() ?? '';
  assert.match(instructions, /rootA/);
  assert.match(instructions, /rootB/);
});

test('relative archivePath resolves against the first root', async () => {
  const result = await call('mdz_create_archive', {
    archivePath: 'docs/new.mdz',
    files: [{ path: 'index.md', content: '# New\n' }],
  });
  assert.equal(result.isError, false, JSON.stringify(result.payload));
  assert.ok(await exists(path.join(rootA, 'docs', 'new.mdz')));
  const read = await call('mdz_read_text', { archivePath: 'docs/new.mdz', entryPath: 'index.md' });
  assert.equal(read.isError, false);
});

test('absolute path in the second root is allowed', async () => {
  const archivePath = path.join(rootB, 'b.mdz');
  const result = await call('mdz_create_archive', { archivePath, files: [{ path: 'index.md', content: '# B\n' }] });
  assert.equal(result.isError, false, JSON.stringify(result.payload));
  const list = await call('mdz_list_entries', { archivePath });
  assert.equal(list.isError, false);
});

test('reading an archive outside the roots is refused', async () => {
  assertOutside(await call('mdz_review_document', { archivePath: outsideArchive }));
  assertOutside(await call('mdz_search_text', { archivePath: outsideArchive, query: 'Secret' }));
});

test('".." cannot climb out of a root', async () => {
  assertOutside(await call('mdz_read_text', { archivePath: '../outside/secret.mdz', entryPath: 'index.md' }));
});

test('creating an archive outside the roots is refused and writes nothing', async () => {
  const archivePath = path.join(outside, 'made.mdz');
  assertOutside(await call('mdz_create_archive', { archivePath, files: [{ path: 'index.md', content: '# X\n' }] }));
  assert.equal(await exists(archivePath), false);
});

test('writing to an archive outside the roots is refused', async () => {
  assertOutside(await call('mdz_write_entry', { archivePath: outsideArchive, entryPath: 'notes.md', content: 'x' }));
  assertOutside(await call('mdz_remove_entry', { archivePath: outsideArchive, entryPath: 'index.md', expectedEntryHash: 'x' }));
});

test('sourcePath outside the roots is refused', async () => {
  assertOutside(
    await call('mdz_write_entry', { archivePath: 'docs/new.mdz', entryPath: 'images/x.svg', sourcePath: outsideImage })
  );
});

test('files[].sourcePath outside the roots is refused', async () => {
  const archivePath = path.join(rootA, 'from-source.mdz');
  const result = await call('mdz_create_archive', {
    archivePath,
    files: [
      { path: 'index.md', content: '# S\n\n![x](images/x.svg)\n' },
      { path: 'images/x.svg', sourcePath: outsideImage },
    ],
  });
  assertOutside(result);
  assert.match(result.payload.error.message, /files\[1\]\.sourcePath/);
  assert.equal(await exists(archivePath), false);
});

test('sourcePath inside a root is allowed', async () => {
  const image = path.join(rootA, 'inside.svg');
  await fs.writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const result = await call('mdz_write_entry', { archivePath: 'docs/new.mdz', entryPath: 'images/inside.svg', sourcePath: image });
  assert.equal(result.isError, false, JSON.stringify(result.payload));
});

test('a link inside a root that points outside is refused', async (t) => {
  const link = path.join(rootA, 'link-out');
  try {
    // 'junction' needs no special rights on Windows; elsewhere it's an ordinary symlink.
    await fs.symlink(outside, link, 'junction');
  } catch (error) {
    t.skip(`can't create a link here: ${error.code}`);
    return;
  }
  assertOutside(await call('mdz_review_document', { archivePath: path.join(link, 'secret.mdz') }));
  assertOutside(await call('mdz_review_document', { archivePath: 'link-out/secret.mdz' }));
});

test('a missing --root stops the server at startup', () => {
  const result = spawnSync(process.execPath, [SERVER, '--root', path.join(temp, 'nope')], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no such folder/);
});

test('a file given as --root stops the server at startup', () => {
  const result = spawnSync(process.execPath, [SERVER, '--root', outsideImage], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not a folder/);
});

test('--version and unknown options', () => {
  const version = spawnSync(process.execPath, [SERVER, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), require('../package.json').version);
  const bad = spawnSync(process.execPath, [SERVER, '--bogus'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Unknown option: --bogus/);
});
