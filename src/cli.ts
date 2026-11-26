// mdzip-mcp only: command-line options for the standalone server.

export type CliOptions =
  | { kind: 'run'; roots: string[]; readOnly: boolean }
  | { kind: 'help' }
  | { kind: 'version' };

export const USAGE = `Usage: mdzip-mcp-server [--root <folder>]... [--read-only]

Runs the MDZip MCP server over stdio. MCP clients start it; you don't run it by hand.

Options:
  --root <folder>  Only allow files inside this folder. Repeat for more folders.
                   Relative paths in tool calls resolve against the first one.
                   Without --root, any path the user can reach is allowed, and
                   relative paths resolve against the working folder.
  --read-only      Offer only the tools that read; nothing can be changed.
  -h, --help       Show this help.
  -v, --version    Show the version.
`;

export class CliError extends Error {}

export function parseArgs(argv: readonly string[]): CliOptions {
  const roots: string[] = [];
  let readOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      return { kind: 'help' };
    }
    if (arg === '-v' || arg === '--version') {
      return { kind: 'version' };
    }
    if (arg === '--read-only') {
      readOnly = true;
      continue;
    }
    if (arg === '--root') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new CliError('--root needs a folder.');
      }
      roots.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--root=')) {
      const value = arg.slice('--root='.length);
      if (!value) {
        throw new CliError('--root needs a folder.');
      }
      roots.push(value);
      continue;
    }
    throw new CliError(`Unknown option: ${arg}`);
  }
  return { kind: 'run', roots, readOnly };
}
