import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_DEFINITIONS, handleToolCall, toToolErrorResult, type ToolArgs } from './mdzToolHandlers';
// [mdzip-mcp] Differs from mdzip-vscode, which hardcodes the version.
import { version } from '../package.json';
// [mdzip-mcp] Command-line options and --root folder limits; mdzip-vscode has neither.
import { CliError, USAGE, parseArgs } from './cli';
import { applyRoots, resolveRoots, rootsInstructions } from './roots';

// [mdzip-mcp] The server is created in main(), after --root is read, so its
// instructions can name the allowed folders.
function createServer(roots: string[]): Server {
  const server = new Server(
    {
      name: 'mdzip-mcp',
      version,
    },
    {
      capabilities: {
        tools: {},
      },
      ...(roots.length ? { instructions: rootsInstructions(roots) } : {}),
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFINITIONS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      return await handleToolCall(name, await applyRoots(args as ToolArgs, roots));
    } catch (error) {
      return toToolErrorResult(name, error);
    }
  });

  return server;
}

async function main(): Promise<void> {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`mdzip-mcp-server: ${error.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw error;
  }
  if (options.kind === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  if (options.kind === 'version') {
    process.stdout.write(`${version}\n`);
    return;
  }

  let roots: string[];
  try {
    roots = await resolveRoots(options.roots);
  } catch (error) {
    process.stderr.write(`mdzip-mcp-server: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
  const server = createServer(roots);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`mdzip-mcp failed to start: ${detail}\n`);
  process.exit(1);
});
