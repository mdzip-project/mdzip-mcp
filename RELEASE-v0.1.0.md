First release of `@mdzip/mcp-server`: a standalone MCP server that lets AI tools read, search and edit MDZip (`.mdz`) documents. It runs locally over stdio and needs only Node.js 20 or later; you don't need VS Code, Obsidian or MDZip Studio.

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

**What's in it**

- The same 10 tools as the server bundled with the MDZip VS Code extension: review, list, search and read archives, and create, write and remove files in them. Writes check a content hash from the last read and refuse to overwrite changes made elsewhere.
- `mdz_find_archives` finds `.mdz` files in a folder and its subfolders.
- `--root <folder>` limits the server to chosen folders. Links are followed before the check, so a link can't reach a file outside them.
- `--read-only` offers only the tools that read.
- `--max-file-mb <n>` sets size limits on archives, copied files and inline content (default 100 MB; archives may unpack to 10 times that).
- Archives are written atomically: a crash or full disk mid-write leaves the old archive whole.

**Compatibility**

Tool names, inputs and outputs match the MDZip VS Code extension's server, so instructions written for one work with the other.

**Validation**

CI runs the server's stdio smoke tests plus 44 tests of the features above on Windows, macOS and Linux with Node 20 and 22. The published tarball was installed in a fresh folder and run through `npx` before release.
