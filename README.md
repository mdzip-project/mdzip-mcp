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

### Limit it to folders

Add `--root <folder>` to restrict the server to files inside that folder. Repeat it for more folders:

```json
"args": ["-y", "@mdzip/mcp-server", "--root", "/Users/me/Documents/notes", "--root", "/Users/me/projects"]
```

With `--root`:
- every archive, and every file copied in with `sourcePath`, must be inside one of the folders, or the call fails with `PATH_OUTSIDE_ROOTS`;
- relative paths resolve against the first folder;
- links are followed before the check, so a link inside a folder can't reach a file outside it;
- the server tells the AI tool which folders it may use when it connects.

Without `--root`, the server can use any file the user running it can reach, and relative paths resolve against the folder the client starts it in.

Other options: `--help`, `--version`.

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

Without `--root`, the tools can read and write any `.mdz` the user running the server can reach.

## Development

```sh
npm install
npm run typecheck
npm test        # builds dist/mdzip-mcp-server.js, then runs the stdio smoke test and the --root tests
```

### Code shared with mdzip-vscode

`src/mdzToolHandlers.ts`, `src/mdzMcpServer.ts`, `tests/mcp-smoke.cjs` and `media/templates/embedded-agent-guide.md` are **copies** of the same files in mdzip-vscode, taken from commit `a9081c4` (files last changed in `da62294`). Until a later refactor makes the extension use this package, a fix to the tools has to be made in both repos. Lines that differ on purpose are marked `[mdzip-mcp]`. Code that exists only here (`src/cli.ts`, `src/roots.ts`, `tests/roots.test.cjs`) sits in its own files, and `mdzToolHandlers.ts` stays as close to the original as possible: `--root` is checked in the server before a call reaches the handlers. To check for drift:

```sh
git -C ../mdzip-vscode diff a9081c4 origin/main -- src/mdzToolHandlers.ts src/mdzMcpServer.ts tests/mcp-smoke.cjs media/templates/embedded-agent-guide.md
```

See [docs/phase-0-inventory.md](docs/phase-0-inventory.md) for the plan.

## License

Apache-2.0
