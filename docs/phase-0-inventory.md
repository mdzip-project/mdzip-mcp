# Phase 0: inventory of the MCP code in mdzip-vscode

Date: 2026-11-25. Source: `mdzip-vscode` at 1.7.3 (branch `feat/26-merge-editor`; the MCP files are the same as `origin/main`).
Proposals: `planning/ideas/2026-10-23-mdzip-macos-linux-mcp-distribution-proposal.md` (planning#18) and `planning/ideas/2026-10-23-mdzip-windows-agent-registry-proposal.md` (planning#20), phase 0.

## Summary

The tool layer is **already host-independent**. `src/mdzToolHandlers.ts` imports only `fs`, `path`, `crypto` and `@mdzip/core-js`, and its header says it must stay free of `vscode`. The stdio server is a 41-line wrapper, and the extension already bundles it as a standalone Node script (`dist/mdz-mcp-server.js`). Extracting it is mostly a move, not a rewrite. The real work is what the proposals ask for and the current code lacks: an authorization scope, read-only mode, bounded work, atomic writes and archive discovery.

## Files

| File | Lines | Role | `vscode` import | Moves to mdzip-mcp? |
|---|---|---|---|---|
| `src/mdzToolHandlers.ts` | 1680 | Tool definitions (`TOOL_DEFINITIONS`), dispatcher (`handleToolCall`), errors (`MdzToolError`, `toToolErrorResult`), all archive logic | No | **Yes**: this is the shared tool layer |
| `src/mdzMcpServer.ts` | 41 | stdio runner: low-level SDK `Server`, `ListTools`/`CallTool` handlers | No | **Yes**: becomes the server entry/bin |
| `tests/mcp-smoke.cjs` | 737 | End-to-end test: spawns the bundle over stdio with the SDK client, builds fixtures in a temp dir | No | **Yes** |
| `media/templates/embedded-agent-guide.md` | – | AGENTS.md text that `mdz_create_archive` adds | – | Yes (or into core-js, see below) |
| `src/mdzLanguageModelTools.ts` | 147 | Adapter: `vscode.lm.registerTool` wrappers, `mdzip_*` → `mdz_*` name map, write-confirmation dialogs | Yes | No: stays in the extension, imports the shared layer |
| `src/extension.ts` (MCP parts) | ~600 of 2261 | Definition provider, config writers, launcher script, stale-config repair, setup prompt | Yes | No: but see "Client setup" |
| `package.json` `contributes.languageModelTools` | – | A second copy of every tool's name, description and schema for Copilot Chat | – | No: generate it or test it against `TOOL_DEFINITIONS` |

Build: `bundle:mcp` = `esbuild src/mdzMcpServer.ts --bundle --format=cjs --platform=node --minify`. Runtime dependencies used: `@modelcontextprotocol/sdk ^1.17.4` and `@mdzip/core-js ^2.2.1` (ESM; esbuild bundles it to CJS).

## Tools (10)

| Tool | Kind | Notes |
|---|---|---|
| `mdz_review_document` | read | Preferred first call. Markdown + referenced images (max 12, clamped 1..50) + entry point resolution + `canonicalContentHash` |
| `mdz_list_entries` | read | `includeHashes` returns size + `entryHash` per entry |
| `mdz_search_text` | read | Plain or regex, case option, max 100 results (clamped 1..1000) |
| `mdz_read_text` | read | One UTF-8 entry |
| `mdz_read_image` | read | Returns image content |
| `mdz_read_markdown_embedded_images` | read | Markdown with images as data URLs |
| `upsert_canonical_document` | write | Main document only; requires `expectedContentHash` (`CONTENT_CONFLICT`) |
| `mdz_create_archive` | write | Builds in memory, validates, writes with `wx` unless `overwrite`; adds AGENTS.md |
| `mdz_write_entry` | write | Add/replace any entry; `expectedEntryHash` to replace; content via `content`, `sourcePath` or `contentBase64` |
| `mdz_remove_entry` | write | Requires `expectedEntryHash`; can't remove manifest or entry point |

Errors are a structured JSON payload (`code`, `message`, `nextAction`, optional `candidatePaths`) with `isError: true`. Each write runs post-write validation and reports unreferenced images and unresolved references.

## Couplings to the host

1. **AGENTS.md template path.** `readAgentsGuide()` reads `path.join(__dirname, '..', 'media', 'templates', 'embedded-agent-guide.md')`. It works only because the bundle sits in `dist/` beside `media/`. If the file is missing it returns `agentsGuide: "unavailable"` and doesn't fail. mdzip-studio has its own copy (`src/assets/templates/embedded-agents-guide.md`). Either embed the text in the package at build time or move it into `@mdzip/core-js`, which would make it the single source.
2. **Relative paths resolve against the process cwd.** The schemas say "Absolute or workspace-relative", but nothing knows the workspace. Relative paths work only when the client starts the server in the workspace folder.
3. **Server identity is hardcoded:** `name: 'mdzip-mcp', version: '0.3.0'`. The version is stale (the extension is 1.7.3). Read it from package.json.
4. **Tool names differ by host:** `mdz_*` over MCP and `mdzip_*` as VS Code language model tools. The map lives in `mdzLanguageModelTools.ts`. The `package.json` descriptions are hand-copied and have already drifted (one refers to `mdzip_upsert_canonical_document`, the MCP one to `upsert_canonical_document`).
5. **Write consent exists only in the VS Code adapter.** `prepareInvocation` shows confirmation dialogs. Over MCP, consent is whatever the client does. That's normal for MCP, but the standalone server should let users turn writes off.

## Client setup and launch (stays in the extension, informs the standalone design)

- **VS Code:** `registerMcpServerDefinitionProvider('mdzip.bundled-mcp')` launches `process.execPath` (VS Code's own Node) with `dist/mdz-mcp-server.js`. Nothing to install.
- **Other clients** (commands `mdzip.enableWorkspaceMcp`, `enableUserMcp`, `enableCodexMcp`, `enableClaudeMcp`, `enableClaudeUserMcp`, `copyMcpConfigSnippet`, `copyClaudeMcpConfigSnippet`): they write a generated **launcher** (`mdzip-mcp-launcher.cjs`, in global storage or `.vscode/`). The launcher scans `~/.vscode{,-insiders,-server,-server-insiders}/extensions` for the newest `mdzip-project.mdzip-vscode-*` and runs its bundled server. It needs `node` on PATH. It doesn't look in Cursor/Windsurf/VSCodium extension folders (related: mdzip-vscode#19). It may also explain mdzip-vscode#27 (Copilot Desktop).
- `maybeRepairClaudeMcpConfig` rewrites `.mcp.json` entries that point at a deleted, version-pinned extension folder.

A standalone server makes the launcher unnecessary for non-VS Code clients: they would run `npx @mdzip/mcp-server`, or Studio's self-contained executable, without depending on where VS Code keeps extensions. The config-writing code (Codex TOML, Claude JSON, VS Code mcp.json) is what Studio's System Integration page needs. That page is Electron, so this code could also become a small shared module.

## Gaps against the proposals' requirements

| Requirement (proposals) | Current state |
|---|---|
| Access limited to authorized folders | **None.** Any absolute path can be read or written, and `sourcePath` reads any file on disk. |
| Read-only by default, writes opt-in | **Writes always on** (4 of 10 tools). |
| Discover `.mdz` files in authorized locations | **No tool.** The agent must already know the path. |
| Bound archive/entry sizes and request work | Image count and search results are capped. Archive size, entry size, decompressed size and regex cost are not. |
| Safe writes: locking, atomic replace | Optimistic hash check only. `fs.writeFile(archivePath, ...)` overwrites in place, so a crash mid-write corrupts the archive. There is no lock between the hash check and the write. |
| ZIP-slip | Not a risk today: entries are never extracted to disk, and write paths go through `MdzArchiveCore.pathProblem`. |
| Avoid logging contents | The server logs nothing except a startup failure to stderr. |
| Same tool contract across hosts | Already true for VS Code (MCP + LM tools share handlers). Obsidian has no MCP code yet. |

## Plan (decided 2026-11-25): copy, don't move

**Touch nothing outside `mdzip-mcp` for now.** mdzip-vscode, mdzip-core-js and mdzip-studio stay as they are. The standalone server starts as a **copy** of the extension's code, so the same code lives in two places for a while. Removing the duplication is a later refactor, done once the standalone server has proved itself.

### Phase 1: standalone server as a copy
1. Copy `mdzToolHandlers.ts`, `mdzMcpServer.ts`, `tests/mcp-smoke.cjs` and `media/templates/embedded-agent-guide.md` into this repo, as one package, `@mdzip/mcp-server`, with a `bin`.
2. Fix only what breaks outside the extension: where the AGENTS.md template is loaded from, and the server's version (read it from package.json). Tool names, schemas and behaviour stay identical to the extension's, so clients see the same contract.
3. Smoke test on Windows, macOS and Linux CI.
4. Additions that live only in this repo, kept off by default or matching today's behaviour: `--root` folders (done 2026-11-25), `--read-only`, archive discovery, size limits, atomic writes.

### Later refactor (not now)
- mdzip-vscode depends on `@mdzip/mcp-server` (`/tools` subpath) and deletes its copies; keep the LM adapter, definition provider and config writers there.
- Generate or test `package.json` `languageModelTools` against `TOOL_DEFINITIONS`.
- Move the AGENTS.md template into `@mdzip/core-js` to remove the Studio and VS Code copies.
- Replace the extension's launcher script with the standalone server for non-VS Code clients.

### Keeping the copies in step until then
Any change to the tools in mdzip-vscode has to be repeated here, and the reverse. Note the mdzip-vscode commit each copy was taken from, so drift is easy to diff.

## Decisions
- ~~Read-only default for the standalone server.~~ **Decided 2026-11-25: writes allowed by default**, the same as the extension. A `--read-only` flag can still be added for users who want it.
- ~~One package or two.~~ **Decided 2026-11-25: one package, `@mdzip/mcp-server`.** If another program needs the tools without the server, expose them at `@mdzip/mcp-server/tools`; split out `@mdzip/mcp` only when that becomes necessary.
