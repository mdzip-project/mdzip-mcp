// --max-file-mb size limits (mdzip-mcp only).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { SERVER, connect, call, makeTempDir, exists } = require('./helpers.cjs');

// 0.01 MB: files up to 10,485 bytes, archives unpacking to up to 104,857 bytes.
const LIMIT_MB = '0.01';
const LIMIT_BYTES = Math.floor(0.01 * 1024 * 1024);

let temp;
let small;
let bigFile;
let bomb;
let limited;
let unlimited;

function assertTooLarge(result) {
  assert.equal(result.isError, true, JSON.stringify(result.payload));
  assert.equal(result.payload.error.code, 'TOO_LARGE');
}

async function create(client, archivePath, files) {
  const result = await call(client, 'mdz_create_archive', { archivePath, files, includeAgentsGuide: false });
  assert.equal(result.isError, false, JSON.stringify(result.payload));
}

before(async () => {
  temp = await makeTempDir('mdzip-mcp-limits-');
  unlimited = await connect([]);
  limited = await connect(['--max-file-mb', LIMIT_MB]);

  small = path.join(temp, 'small.mdz');
  // Random image bytes don't compress (images are stored), so the archive is ~3 KB.
  await create(unlimited, small, [
    { path: 'index.md', content: '# Small\n\n![x](images/a.png)\n' },
    { path: 'images/a.png', contentBase64: randomBytes(3000).toString('base64') },
  ]);

  bigFile = path.join(temp, 'big.bin');
  await fs.writeFile(bigFile, randomBytes(LIMIT_BYTES + 1));

  // Small on disk, but unpacks to 500 KB.
  bomb = path.join(temp, 'bomb.mdz');
  await create(unlimited, bomb, [{ path: 'index.md', content: `# Bomb\n\n${'a'.repeat(500_000)}\n` }]);
  assert.ok((await fs.stat(bomb)).size < LIMIT_BYTES);
});

after(async () => {
  await limited?.close();
  await unlimited?.close();
  await fs.rm(temp, { recursive: true, force: true });
});

test('archives under the limit work', async () => {
  const result = await call(limited, 'mdz_review_document', { archivePath: small });
  assert.equal(result.isError, false, JSON.stringify(result.payload));
});

test('an archive file over the limit is refused', async () => {
  const large = path.join(temp, 'large.mdz');
  await create(unlimited, large, [
    { path: 'index.md', content: '# Large\n' },
    { path: 'images/a.png', contentBase64: randomBytes(LIMIT_BYTES + 100).toString('base64') },
  ]);
  const result = await call(limited, 'mdz_list_entries', { archivePath: large });
  assertTooLarge(result);
  assert.match(result.payload.error.message, /over the 10\.2 KB limit/);
  assert.match(result.payload.error.nextAction, /--max-file-mb/);
});

test('an archive that unpacks to over 10x the limit is refused', async () => {
  const result = await call(limited, 'mdz_search_text', { archivePath: bomb, query: 'a' });
  assertTooLarge(result);
  assert.match(result.payload.error.message, /unpacks to/);
});

test('a sourcePath over the limit is refused', async () => {
  assertTooLarge(await call(limited, 'mdz_write_entry', { archivePath: small, entryPath: 'images/b.bin', sourcePath: bigFile }));
  assertTooLarge(
    await call(limited, 'mdz_create_archive', {
      archivePath: path.join(temp, 'from-big.mdz'),
      files: [{ path: 'index.md', content: '# X\n' }, { path: 'images/b.png', sourcePath: bigFile }],
    })
  );
  assert.equal(await exists(path.join(temp, 'from-big.mdz')), false);
});

test('inline content over the limit is refused', async () => {
  const big = 'x'.repeat(LIMIT_BYTES + 1);
  assertTooLarge(await call(limited, 'mdz_write_entry', { archivePath: small, entryPath: 'notes.md', content: big }));
  assertTooLarge(
    await call(limited, 'mdz_write_entry', {
      archivePath: small,
      entryPath: 'images/b.png',
      contentBase64: randomBytes(LIMIT_BYTES + 1).toString('base64'),
    })
  );
});

test('a write whose result would be over the limit leaves the archive as it was', async () => {
  const before = await fs.readFile(small);
  // 9 KB fits on its own, but not added to the ~3 KB archive.
  const result = await call(limited, 'mdz_write_entry', {
    archivePath: small,
    entryPath: 'images/c.png',
    contentBase64: randomBytes(9000).toString('base64'),
  });
  assertTooLarge(result);
  assert.match(result.payload.error.message, /wasn't written/);
  assert.deepEqual(await fs.readFile(small), before);
  assert.deepEqual((await fs.readdir(temp)).filter((name) => name.endsWith('.tmp')), []);
});

test('the default limit allows normal archives', async () => {
  const result = await call(unlimited, 'mdz_search_text', { archivePath: bomb, query: 'Bomb' });
  assert.equal(result.isError, false, JSON.stringify(result.payload));
});

test('--max-file-mb must be a number above 0', () => {
  for (const value of ['0', '-1', 'abc', '']) {
    const result = spawnSync(process.execPath, [SERVER, `--max-file-mb=${value}`], { encoding: 'utf8' });
    assert.equal(result.status, 2, value);
    assert.match(result.stderr, /--max-file-mb needs a number above 0/);
  }
});
