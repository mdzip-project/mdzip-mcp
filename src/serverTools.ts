import { TOOL_DEFINITIONS, handleToolCall, MdzToolError, type ToolArgs, type ToolDefinition, type ToolResult } from './mdzToolHandlers';
import { FIND_ARCHIVES_DEFINITION, FIND_ARCHIVES_TOOL, findArchives } from './discovery';
import { applyRoots } from './roots';
import { LimitError, checkCallSizes } from './limits';

// mdzip-mcp only: the tool set this server offers. It wraps the copied tool handlers
// (mdzToolHandlers.ts) with mdz_find_archives, --root, --read-only and size limits.

export type ServerToolOptions = {
  roots: readonly string[];
  readOnly: boolean;
};

/**
 * Tools that only read. Anything not listed counts as a write, so a tool added to the
 * copied handlers later stays hidden in --read-only mode until it's listed here.
 */
const READ_TOOLS = new Set([
  'mdz_review_document',
  'mdz_list_entries',
  'mdz_search_text',
  'mdz_read_text',
  'mdz_read_image',
  'mdz_read_markdown_embedded_images',
  FIND_ARCHIVES_TOOL,
]);

type AnnotatedTool = ToolDefinition & {
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; openWorldHint: boolean };
};

export function listTools(options: ServerToolOptions): AnnotatedTool[] {
  return [FIND_ARCHIVES_DEFINITION, ...TOOL_DEFINITIONS]
    .filter((tool) => !options.readOnly || READ_TOOLS.has(tool.name))
    .map((tool) => ({
      ...tool,
      // Hints for clients, e.g. to ask before a write. Writes can replace or remove files.
      annotations: READ_TOOLS.has(tool.name)
        ? { readOnlyHint: true, openWorldHint: false }
        : { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    }));
}

export async function callTool(name: string, args: ToolArgs, options: ServerToolOptions): Promise<ToolResult> {
  try {
    return await dispatch(name, args, options);
  } catch (error) {
    if (error instanceof LimitError) {
      throw new MdzToolError({ code: error.code, message: error.message, nextAction: error.nextAction });
    }
    throw error;
  }
}

async function dispatch(name: string, args: ToolArgs, options: ServerToolOptions): Promise<ToolResult> {
  if (options.readOnly && !READ_TOOLS.has(name)) {
    throw new MdzToolError({
      code: 'READ_ONLY',
      message: `${name} changes files, and this server was started with --read-only.`,
      nextAction:
        'Tell the user the change wasn\'t made. If they want MDZip tools to edit files, they can remove --read-only from this server\'s configuration.',
    });
  }
  if (name === FIND_ARCHIVES_TOOL) {
    return findArchives(args, options.roots);
  }
  const resolved = await applyRoots(args, options.roots);
  await checkCallSizes(name, resolved);
  return handleToolCall(name, resolved);
}
