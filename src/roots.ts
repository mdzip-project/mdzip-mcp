import { promises as fs } from 'fs';
import * as path from 'path';
import { MdzToolError, type ToolArgs } from './mdzToolHandlers';

/**
 * Folder limits (--root). mdzip-mcp only: the copied tool handlers know nothing about
 * roots, so the server checks every disk path in a call before passing it on.
 *
 * Disk paths in tool arguments: archivePath (every tool), sourcePath (mdz_write_entry)
 * and files[].sourcePath (mdz_create_archive). entryPath and files[].path are paths
 * inside an archive, not on disk.
 *
 * With no roots, calls pass through unchanged: any path, relative to the working folder.
 */

/** Resolves the --root folders to their real paths. Throws if one isn't a folder. */
export async function resolveRoots(rawRoots: string[], cwd: string = process.cwd()): Promise<string[]> {
  const roots: string[] = [];
  for (const raw of rawRoots) {
    const absolute = path.resolve(cwd, raw);
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      throw new Error(`--root ${raw}: no such folder (${absolute}).`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`--root ${raw}: not a folder (${absolute}).`);
    }
    const real = await fs.realpath(absolute);
    if (!roots.some((existing) => samePathOnDisk(existing, real))) {
      roots.push(real);
    }
  }
  return roots;
}

/**
 * Returns the call's arguments with every disk path made absolute (relative paths resolve
 * against the first root), or throws PATH_OUTSIDE_ROOTS if one is outside every root.
 */
export async function applyRoots(args: ToolArgs, roots: readonly string[]): Promise<ToolArgs> {
  if (!roots.length || !args) {
    return args;
  }
  const next: Record<string, unknown> = { ...args };
  if (typeof next.archivePath === 'string' && next.archivePath.trim()) {
    next.archivePath = await checkPath(next.archivePath, 'archivePath', roots);
  }
  if (typeof next.sourcePath === 'string' && next.sourcePath.trim()) {
    next.sourcePath = await checkPath(next.sourcePath, 'sourcePath', roots);
  }
  if (Array.isArray(next.files)) {
    next.files = await Promise.all(
      next.files.map(async (item, index) => {
        if (!item || typeof item !== 'object') {
          return item;
        }
        const record = item as Record<string, unknown>;
        if (typeof record.sourcePath !== 'string' || !record.sourcePath.trim()) {
          return item;
        }
        return { ...record, sourcePath: await checkPath(record.sourcePath, `files[${index}].sourcePath`, roots) };
      })
    );
  }
  return next;
}

/** A sentence for the MCP initialize result, so agents know the limits before they hit them. */
export function rootsInstructions(roots: readonly string[]): string {
  return (
    `This server can only use files inside these folders: ${roots.join(', ')}. ` +
    `Relative paths resolve against ${roots[0]}.`
  );
}

async function checkPath(rawPath: string, label: string, roots: readonly string[]): Promise<string> {
  const absolute = path.resolve(roots[0], rawPath.trim());
  // Follow symlinks, so a link inside a root can't reach a file outside it.
  const real = await realpathAllowingMissing(absolute);
  if (!roots.some((root) => isInside(root, real))) {
    throw new MdzToolError({
      code: 'PATH_OUTSIDE_ROOTS',
      message: `${label} ${rawPath} is outside the folders this server may use (resolved to ${real}).`,
      nextAction:
        `Use a path inside ${roots.join(' or ')}; relative paths resolve against ${roots[0]}. ` +
        'If the user wants another folder available, they can add --root <folder> to this server\'s configuration.',
    });
  }
  return absolute;
}

/** realpath of the nearest existing ancestor, plus the parts that don't exist yet. */
async function realpathAllowingMissing(absolute: string): Promise<string> {
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = path.dirname(current);
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || parent === current) {
        throw error;
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(normalizeCase(root), normalizeCase(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function samePathOnDisk(left: string, right: string): boolean {
  return normalizeCase(left) === normalizeCase(right);
}

// Windows paths are case-insensitive. realpath already gives the on-disk case on macOS.
function normalizeCase(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}
