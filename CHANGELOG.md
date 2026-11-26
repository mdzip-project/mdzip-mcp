# Changelog

## 0.1.0 (2026-11-25)

First release: a standalone MCP server for MDZip (`.mdz`) documents that runs over stdio with only Node.js 20 or later.

- The same 10 tools as the server bundled with the MDZip VS Code extension: review, list, search and read archives, and create, write and remove files in them, with content-hash checks against overwriting changes made elsewhere.
- `mdz_find_archives`: find `.mdz` files in a folder and its subfolders.
- `--root <folder>`: limit the server to chosen folders (links are followed before the check).
- `--read-only`: offer only the tools that read.
- `--max-file-mb <n>`: size limits on archives, copied files and inline content (default 100 MB; archives may unpack to 10 times that).
- Archives are written atomically, so a crash or full disk mid-write leaves the old archive whole.
- Tools carry read/write hints (`readOnlyHint`, `destructiveHint`) so clients can ask before writes.
