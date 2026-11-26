// --read-only and tool annotations (mdzip-mcp only).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { connect, call, makeTempDir, exists } = require('./helpers.cjs');

const WRITE_TOOLS = ['upsert_canonical_document', 'mdz_create_archive', 'mdz_write_entry', 'mdz_remove_entry'];

let temp;
let archive;
let readOnly;
let writable;

before(async () => {
  temp = await makeTempDir('mdzip-mcp-readonly-');
  archive = path.join(temp, 'doc.mdz');
  writable = await connect([]);
  const made = await call(writable, 'mdz_create_archive', { archivePath: archive, files: [{ path: 'index.md', content: '# Doc\n' }] });
  assert.equal(made.isError, false, JSON.stringify(made.payload));
  readOnly = await connect(['--read-only']);
});

after(async () => {
  await readOnly?.close();
  await writable?.close();
  await fs.rm(temp, { recursive: true, force: true });
});

test('read-only lists only the tools that read', async () => {
  const names = (await readOnly.listTools()).tools.map((tool) => tool.name);
  for (const name of WRITE_TOOLS) {
    assert.ok(!names.includes(name), `${name} should be hidden`);
  }
  assert.ok(names.includes('mdz_review_document'));
  assert.ok(names.includes('mdz_find_archives'));
  assert.equal(names.length, 7);
});

test('read-only refuses write calls and changes nothing', async () => {
  const before = await fs.readFile(archive);
  const created = path.join(temp, 'new.mdz');
  const results = [
    await call(readOnly, 'mdz_create_archive', { archivePath: created, files: [{ path: 'index.md', content: '# New\n' }] }),
    await call(readOnly, 'mdz_write_entry', { archivePath: archive, entryPath: 'notes.md', content: 'x' }),
    await call(readOnly, 'mdz_remove_entry', { archivePath: archive, entryPath: 'AGENTS.md', expectedEntryHash: 'x' }),
    await call(readOnly, 'upsert_canonical_document', { archivePath: archive, content: '# Changed\n', expectedContentHash: 'x' }),
  ];
  for (const result of results) {
    assert.equal(result.isError, true);
    assert.equal(result.payload.error.code, 'READ_ONLY');
  }
  assert.equal(await exists(created), false);
  assert.deepEqual(await fs.readFile(archive), before);
});

test('read-only still reads', async () => {
  const result = await call(readOnly, 'mdz_read_text', { archivePath: archive, entryPath: 'index.md' });
  assert.equal(result.isError, false);
  assert.equal(result.payload, '# Doc\n');
});

test('read-only is in the instructions', () => {
  assert.match(readOnly.getInstructions() ?? '', /read-only/);
});

test('without --read-only, all tools are listed with read/write hints', async () => {
  const tools = (await writable.listTools()).tools;
  assert.equal(tools.length, 11);
  for (const tool of tools) {
    const isWrite = WRITE_TOOLS.includes(tool.name);
    assert.equal(tool.annotations?.readOnlyHint, !isWrite, tool.name);
    assert.equal(tool.annotations?.destructiveHint, isWrite ? true : undefined, tool.name);
  }
  assert.equal(writable.getInstructions(), undefined);
});
