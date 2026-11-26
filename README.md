# MDZip MCP Server

A standalone [MCP](https://modelcontextprotocol.io/) server that lets AI tools read, search and edit MDZip (`.mdz`) documents: Markdown plus its images in one file. It runs locally over stdio and needs only Node.js 20 or later. You don't need VS Code, Obsidian or MDZip Studio.

It offers the same tools as the MCP server bundled with the [MDZip VS Code extension](https://github.com/mdzip-project/mdzip-vscode), plus a tool to find archives, folder limits, a read-only mode and size limits.

## Set up a client

Most clients take this configuration:

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

To run a build from source instead (`npm install`, then `npm run build`), use `"command": "node"` with `"args": ["<path to>/dist/mdzip-mcp-server.js"]`.

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

### Read-only

Add `--read-only` to offer only the tools that read. The four write tools aren't listed, and a call to one fails with `READ_ONLY` without changing anything.

### Size limits

The server loads whole archives into memory, so it refuses, with `TOO_LARGE`:
- an archive larger than 100 MB, or one that unpacks to more than 10 times that (1 GB);
- a file copied in with `sourcePath`, or content passed inline, larger than 100 MB;
- a write whose resulting archive would be larger than 100 MB (the archive is left as it was).

Change the limit with `--max-file-mb <n>`; the unpacked limit stays 10 times it.

Other options: `--help`, `--version`.

## Tools

| Tool | What it does |
|---|---|
| `mdz_find_archives` | Find `.mdz` files in a folder and its subfolders (all `--root` folders by default) |
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

Write tools check a hash from your last read and refuse to overwrite changes made elsewhere. Archives are written to a temporary file beside them and then swapped in, so a crash or full disk mid-write leaves the old archive whole. Writing through a link updates the file it points to, and on macOS and Linux the archive keeps its permissions. Each tool is marked read or write (`readOnlyHint`, `destructiveHint`), so clients can ask before writes.

`mdz_find_archives` skips hidden folders and `node_modules`, doesn't follow links, searches 6 levels deep by default, and returns at most 100 archives by default. Without `--root` it needs a `folder`.

## Development

```sh
npm install
npm run typecheck
npm test        # builds dist/mdzip-mcp-server.js, then runs the stdio smoke test and the mdzip-mcp-only tests
```

### Code shared with mdzip-vscode

`src/mdzToolHandlers.ts`, `src/mdzMcpServer.ts`, `tests/mcp-smoke.cjs` and `media/templates/embedded-agent-guide.md` are **copies** of the same files in mdzip-vscode, taken from commit `a9081c4` (files last changed in `da62294`). Until a later refactor makes the extension use this package, a fix to the tools has to be made in both repos. Lines that differ on purpose are marked `[mdzip-mcp]`. Code that exists only here sits in its own files (`src/cli.ts`, `src/roots.ts`, `src/discovery.ts`, `src/limits.ts`, `src/atomicWrite.ts`, `src/serverTools.ts` and `tests/*.test.cjs`), and `mdzToolHandlers.ts` stays as close to the original as possible: `serverTools.ts` adds `mdz_find_archives`, `--root`, `--read-only` and the size limits around the copied handlers. The one change inside them: the four `fs.writeFile` calls that save an archive call `writeFileAtomic` instead. To check for drift:

```sh
git -C ../mdzip-vscode diff a9081c4 origin/main -- src/mdzToolHandlers.ts src/mdzMcpServer.ts tests/mcp-smoke.cjs media/templates/embedded-agent-guide.md
```

See [docs/phase-0-inventory.md](docs/phase-0-inventory.md) for the plan.

## License

Apache-2.0. The published server bundles its dependencies; their licenses are in `dist/THIRD_PARTY_NOTICES.md`.
