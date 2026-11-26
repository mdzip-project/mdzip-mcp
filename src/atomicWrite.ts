import { promises as fs } from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { checkWriteSize } from './limits';

// mdzip-mcp only: archives are written to a temp file beside the target, flushed to disk,
// then renamed over it. A crash or full disk mid-write leaves the old archive intact
// instead of a half-written one. The copied tool handlers call this in place of
// fs.writeFile (marked [mdzip-mcp]).

export type AtomicWriteOptions = {
  /** Fail with an EEXIST error if the target exists, like fs.writeFile's 'wx' flag. */
  exclusive?: boolean;
};

const RENAME_RETRIES = 8;

export async function writeFileAtomic(target: string, data: Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  checkWriteSize(data.byteLength, target);

  // Write to the file a link points at, so the link stays a link.
  const finalPath = await fs.realpath(target).catch(() => path.resolve(target));
  const dir = path.dirname(finalPath);
  const temp = path.join(dir, `.${path.basename(finalPath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);

  const existingMode = options.exclusive ? undefined : await fs.stat(finalPath).then((stat) => stat.mode & 0o7777, () => undefined);

  try {
    const handle = await fs.open(temp, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (existingMode !== undefined && process.platform !== 'win32') {
      await fs.chmod(temp, existingMode);
    }
    if (options.exclusive) {
      await placeExclusive(temp, finalPath);
    } else {
      await renameWithRetry(temp, finalPath);
    }
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dir);
}

/**
 * Puts the temp file at target only if nothing is there. A hard link fails atomically with
 * EEXIST; file systems without hard links fall back to a check then rename.
 */
async function placeExclusive(temp: string, target: string): Promise<void> {
  try {
    await fs.link(temp, target);
    await fs.rm(temp, { force: true });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw error;
    }
  }
  if (await fs.lstat(target).then(() => true, () => false)) {
    throw Object.assign(new Error(`EEXIST: file already exists, '${target}'`), { code: 'EEXIST' });
  }
  await renameWithRetry(temp, target);
}

/** On Windows a rename can fail briefly while another program (an indexer, antivirus) has the file open. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (process.platform !== 'win32' || !transient || attempt >= RENAME_RETRIES) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

/** Makes the rename itself durable. Not possible (or needed) on Windows. */
async function syncDirectory(dir: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  try {
    const handle = await fs.open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some file systems don't allow it; the data itself is already flushed.
  }
}
