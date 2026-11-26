import { promises as fs } from 'fs';
import * as path from 'path';
import { MdzToolError, type ToolArgs, type ToolDefinition, type ToolResult } from './mdzToolHandlers';
import { checkPath } from './roots';

// mdzip-mcp only: mdz_find_archives, so agents can find .mdz files instead of
// needing their paths up front.

export const FIND_ARCHIVES_TOOL = 'mdz_find_archives';

const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_MAX_DEPTH = 6;
/** Stops a search of a huge tree; the result says it was cut short. */
const MAX_FOLDERS_VISITED = 10_000;
const SKIPPED_FOLDERS = new Set(['node_modules']);

export const FIND_ARCHIVES_DEFINITION: ToolDefinition = {
  name: FIND_ARCHIVES_TOOL,
  description:
    'Find .mdz files in a folder and its subfolders, to get the archivePath for the other mdz_ tools. Use it when the user names a document but not its path. Skips hidden folders and node_modules, and doesn\'t follow links. Without folder, searches every folder this server may use; if the server has no folder limits, folder is required. Returns each archive\'s absolute path, size and last-modified time, nearest folders first.',
  inputSchema: {
    type: 'object',
    properties: {
      folder: {
        type: 'string',
        description: 'Folder to search. Absolute, or relative to the first folder this server may use.',
      },
      nameContains: {
        type: 'string',
        description: 'Only return archives whose file name contains this text (case-insensitive).',
      },
      maxResults: {
        type: 'number',
        description: `Maximum archives to return. Defaults to ${DEFAULT_MAX_RESULTS} and is clamped to 1..1000.`,
      },
      maxDepth: {
        type: 'number',
        description: `How many subfolder levels to search below each folder (0 = only the folder itself). Defaults to ${DEFAULT_MAX_DEPTH} and is clamped to 0..20.`,
      },
    },
    required: [],
  },
};

type FoundArchive = { path: string; bytes: number; modified: string };

export async function findArchives(args: ToolArgs, roots: readonly string[]): Promise<ToolResult> {
  const folderArg = typeof args?.folder === 'string' && args.folder.trim() ? args.folder.trim() : undefined;
  const nameContains = typeof args?.nameContains === 'string' ? args.nameContains.trim().toLowerCase() : '';
  const maxResults = clamp(numberArg(args, 'maxResults') ?? DEFAULT_MAX_RESULTS, 1, 1000);
  const maxDepth = clamp(numberArg(args, 'maxDepth') ?? DEFAULT_MAX_DEPTH, 0, 20);

  let folders: string[];
  if (folderArg) {
    folders = [roots.length ? await checkPath(folderArg, 'folder', roots) : path.resolve(folderArg)];
  } else if (roots.length) {
    folders = [...roots];
  } else {
    throw new MdzToolError({
      code: 'MISSING_FOLDER',
      message: 'folder is required: this server has no folder limits, so there is no default place to search.',
      nextAction: 'Retry mdz_find_archives with folder set to an absolute path, such as the user\'s documents or project folder.',
    });
  }

  for (const folder of folders) {
    const stat = await fs.stat(folder).catch(() => undefined);
    if (!stat?.isDirectory()) {
      throw new MdzToolError({
        code: 'FOLDER_NOT_FOUND',
        message: `No folder at ${folder}.`,
        nextAction: 'Check the path and retry mdz_find_archives, or leave folder out to search every folder this server may use.',
      });
    }
  }

  const archives: FoundArchive[] = [];
  let foldersVisited = 0;
  let unreadableFolders = 0;
  let truncated = false;

  // Breadth-first, so if the search is cut short the nearest archives are the ones returned.
  const queue: Array<{ dir: string; depth: number }> = folders.map((dir) => ({ dir, depth: 0 }));
  search: while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (foldersVisited >= MAX_FOLDERS_VISITED) {
      truncated = true;
      break;
    }
    foldersVisited += 1;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      unreadableFolders += 1;
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      // Links are skipped, so the search can't leave the folder or loop.
      if (entry.isDirectory()) {
        if (depth < maxDepth && !entry.name.startsWith('.') && !SKIPPED_FOLDERS.has(entry.name)) {
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.mdz') {
        continue;
      }
      if (nameContains && !entry.name.toLowerCase().includes(nameContains)) {
        continue;
      }
      const filePath = path.join(dir, entry.name);
      const stat = await fs.stat(filePath).catch(() => undefined);
      if (!stat) {
        continue;
      }
      if (archives.length >= maxResults) {
        truncated = true;
        break search;
      }
      archives.push({ path: filePath, bytes: stat.size, modified: stat.mtime.toISOString() });
    }
  }

  const result = {
    searched: folders,
    archives,
    truncated,
    ...(truncated
      ? { hint: 'More archives may exist. Narrow the search with folder or nameContains, or raise maxResults.' }
      : {}),
    ...(unreadableFolders ? { unreadableFolders } : {}),
  };
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function numberArg(args: ToolArgs, key: string): number | undefined {
  const value = args?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
