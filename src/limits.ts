import { promises as fs } from 'fs';
import type { ToolArgs } from './mdzToolHandlers';

// mdzip-mcp only: size limits for one server process, which loads whole archives into memory.
// @mdzip/core-js has its own, looser limits against ZIP bombs (100,000 entries, 1 GiB per entry,
// 4 GiB in total, 1000:1 compression); these are tighter and checked before a handler runs.
//
// No imports from the tool handlers: atomicWrite.ts (which the handlers import) uses this
// module, so LimitError is plain and serverTools.ts turns it into a tool error.

const MB = 1024 * 1024;
export const DEFAULT_MAX_FILE_MB = 100;
/** The total uncompressed size of an archive may be this many times the file limit. */
const UNCOMPRESSED_FACTOR = 10;

let maxFileBytes = DEFAULT_MAX_FILE_MB * MB;

export function configureLimits(maxFileMb: number): void {
  maxFileBytes = Math.floor(maxFileMb * MB);
}

export function maxUncompressedBytes(): number {
  return maxFileBytes * UNCOMPRESSED_FACTOR;
}

export class LimitError extends Error {
  public readonly code = 'TOO_LARGE';
  public constructor(message: string, public readonly nextAction: string) {
    super(message);
  }
}

const RAISE_LIMIT = 'If the user needs larger files, they can raise --max-file-mb in this server\'s configuration.';

/** Rejects a write whose result would be larger than the limit. Used by atomicWrite.ts. */
export function checkWriteSize(bytes: number, target: string): void {
  if (bytes > maxFileBytes) {
    throw new LimitError(
      `The archive wasn't written: ${target} would be ${formatBytes(bytes)}, over the ${formatBytes(maxFileBytes)} limit.`,
      `Make the change smaller, or split the content across several archives. ${RAISE_LIMIT}`
    );
  }
}

/**
 * Checks the sizes in a call before the handler runs: the archive file and its declared
 * uncompressed size, files copied in with sourcePath, and content passed inline.
 * Paths are already absolute here when --root is set (applyRoots runs first).
 */
export async function checkCallSizes(toolName: string, args: ToolArgs): Promise<void> {
  if (!args) {
    return;
  }
  // mdz_create_archive replaces archivePath rather than reading it.
  if (toolName !== 'mdz_create_archive' && typeof args.archivePath === 'string' && args.archivePath.trim()) {
    await checkArchive(args.archivePath);
  }
  await checkContent(args, '');
  if (Array.isArray(args.files)) {
    for (const [index, item] of args.files.entries()) {
      if (item && typeof item === 'object') {
        await checkContent(item as Record<string, unknown>, `files[${index}].`);
      }
    }
  }
}

async function checkContent(record: Record<string, unknown>, prefix: string): Promise<void> {
  if (typeof record.content === 'string') {
    checkInline(Buffer.byteLength(record.content, 'utf8'), `${prefix}content`);
  }
  if (typeof record.contentBase64 === 'string') {
    checkInline(Buffer.byteLength(record.contentBase64, 'base64'), `${prefix}contentBase64`);
  }
  if (typeof record.sourcePath === 'string' && record.sourcePath.trim()) {
    const size = await fileSize(record.sourcePath);
    if (size !== undefined && size > maxFileBytes) {
      throw new LimitError(
        `${prefix}sourcePath ${record.sourcePath} is ${formatBytes(size)}, over the ${formatBytes(maxFileBytes)} limit.`,
        `Use a smaller file. ${RAISE_LIMIT}`
      );
    }
  }
}

function checkInline(bytes: number, label: string): void {
  if (bytes > maxFileBytes) {
    throw new LimitError(`${label} is ${formatBytes(bytes)}, over the ${formatBytes(maxFileBytes)} limit.`, `Send less content in one call. ${RAISE_LIMIT}`);
  }
}

async function checkArchive(archivePath: string): Promise<void> {
  const size = await fileSize(archivePath);
  if (size === undefined) {
    return; // Missing or not a file: the handler reports it.
  }
  if (size > maxFileBytes) {
    throw new LimitError(
      `${archivePath} is ${formatBytes(size)}, over the ${formatBytes(maxFileBytes)} limit.`,
      `Tell the user the archive is too large for this server. ${RAISE_LIMIT}`
    );
  }
  const declared = await declaredUncompressedSize(archivePath, size);
  if (declared !== undefined && declared > maxUncompressedBytes()) {
    throw new LimitError(
      `${archivePath} unpacks to ${formatBytes(declared)}, over the ${formatBytes(maxUncompressedBytes())} limit (${UNCOMPRESSED_FACTOR}x the file limit).`,
      `Tell the user the archive is too large for this server. ${RAISE_LIMIT}`
    );
  }
}

async function fileSize(filePath: string): Promise<number | undefined> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sum of the uncompressed sizes the ZIP central directory declares, read from the end of
 * the file only. Returns undefined for anything unusual (not a ZIP, ZIP64, malformed) and
 * leaves it to core-js, which checks again, and checks actual sizes while inflating.
 */
async function declaredUncompressedSize(archivePath: string, fileBytes: number): Promise<number | undefined> {
  const EOCD_SIZE = 22;
  const MAX_COMMENT = 0xffff;
  if (fileBytes < EOCD_SIZE) {
    return undefined;
  }
  const handle = await fs.open(archivePath, 'r');
  try {
    const tailLength = Math.min(fileBytes, EOCD_SIZE + MAX_COMMENT);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, fileBytes - tailLength);
    let eocd = -1;
    for (let i = tailLength - EOCD_SIZE; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) {
      return undefined;
    }
    const entries = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize > fileBytes) {
      return undefined;
    }
    const central = Buffer.alloc(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    let total = 0;
    let pos = 0;
    for (let index = 0; index < entries; index += 1) {
      if (pos + 46 > central.length || central.readUInt32LE(pos) !== 0x02014b50) {
        return undefined;
      }
      total += central.readUInt32LE(pos + 24);
      pos += 46 + central.readUInt16LE(pos + 28) + central.readUInt16LE(pos + 30) + central.readUInt16LE(pos + 32);
    }
    return total;
  } finally {
    await handle.close();
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= MB) {
    return `${(bytes / MB).toFixed(1).replace(/\.0$/, '')} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  }
  return `${bytes} bytes`;
}
