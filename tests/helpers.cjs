// Shared by the mdzip-mcp-only tests. Runs the built bundle over stdio.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const SERVER = path.join(__dirname, '..', 'dist', 'mdzip-mcp-server.js');

async function connect(args = []) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER, ...args], stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'mdzip-mcp-test', version: '0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

/** Calls a tool; payload is parsed JSON, or the raw text for tools that return text. */
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0].text;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { isError: result.isError === true, payload };
}

/** A temp folder, resolved through links (macOS /var -> /private/var) so paths compare equal. */
async function makeTempDir(prefix) {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

module.exports = { SERVER, connect, call, makeTempDir, exists };
