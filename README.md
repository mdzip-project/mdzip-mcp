# MDZip MCP Server

A standalone [MCP](https://modelcontextprotocol.io/) server that lets AI tools read, search and edit MDZip (`.mdz`) documents: Markdown plus its images in one file. It runs locally over stdio and needs only Node.js 20 or later. You don't need VS Code, Obsidian or MDZip Studio.

> **Status: early (0.1.0), not yet published to npm.** It offers the same tools as the MCP server bundled with the [MDZip VS Code extension](https://github.com/mdzip-project/mdzip-vscode).

## Set up a client

Once the package is published, most clients take this configuration:

```json
{
  "mcpServers": {
    "MDZip": {
      "command": "npx",
      "args": ["-y", "@mdzip/mcp-server"]
    }
  }
}
```

Until then, build it from source (`npm install`, then `npm run build`) and use `"command": "node"` with `"args": ["<path to>/dist/mdzip-mcp-server.js"]`.

Relative archive paths resolve against the folder the client starts the server in. Use absolute paths when in doubt.

## Tools

| Tool | What it does |
|---|---|
| `mdz_review_document` | Best first call: the main Markdown document, its images, and a content hash for safe writes |
| `mdz_list_entries` | Every file in the archive, optionally with hashes |
| `mdz_search_text` | Search text files in the archive (plain text or regex) |
| `mdz_read_text` | Read one text file |
| `mdz_read_image` | Read one image |
| `mdz_read_markdown_embedded_images` | Markdown with its images inlined as data URLs |
| `upsert_canonical_document` | Replace the main document; refused if it changed since it was read |
| `mdz_create_archive` | Create a new, validated `.mdz` from files |
| `mdz_write_entry` | Add or replace any file in an archive |
| `mdz_remove_entry` | Remove a file from an archive |

Write tools check a hash from your last read and refuse to overwrite changes made elsewhere.

> **Note:** the server can currently read and write any `.mdz` the user running it can reach. Limiting it to chosen folders, and a read-only mode, are planned.

## Development

```sh
npm install
npm run typecheck
npm test        # builds dist/mdzip-mcp-server.js and runs the stdio smoke test
```

### Code shared with mdzip-vscode

`src/mdzToolHandlers.ts`, `src/mdzMcpServer.ts`, `tests/mcp-smoke.cjs` and `media/templates/embedded-agent-guide.md` are **copies** of the same files in mdzip-vscode, taken from commit `a9081c4` (files last changed in `da62294`). Until a later refactor makes the extension use this package, a fix to the tools has to be made in both repos. Lines that differ on purpose are marked `[mdzip-mcp]`. To check for drift:

```sh
git -C ../mdzip-vscode diff a9081c4 origin/main -- src/mdzToolHandlers.ts src/mdzMcpServer.ts tests/mcp-smoke.cjs media/templates/embedded-agent-guide.md
```

See [docs/phase-0-inventory.md](docs/phase-0-inventory.md) for the plan.

## License

Apache-2.0
