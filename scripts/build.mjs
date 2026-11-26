// Builds dist/mdzip-mcp-server.js (one file, dependencies bundled) and
// dist/THIRD_PARTY_NOTICES.md with the license of every bundled package,
// which their licenses require to ship alongside the code.
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const result = await build({
  entryPoints: ['src/mdzMcpServer.ts'],
  outfile: 'dist/mdzip-mcp-server.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  minify: true,
  loader: { '.md': 'text' },
  banner: { js: '#!/usr/bin/env node' },
  metafile: true,
  logLevel: 'info',
});

// The innermost node_modules/<package> of every bundled input.
const packageDirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const matches = input.replace(/\\/g, '/').match(/node_modules\/(?:@[^/]+\/)?[^/]+/g);
  if (matches) {
    packageDirs.add(matches[matches.length - 1]);
  }
}

const sections = [...packageDirs].sort().map((dir) => {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const licenseFile = readdirSync(dir).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
  if (!licenseFile) {
    throw new Error(`${pkg.name} has no license file; check its license before bundling it.`);
  }
  const text = readFileSync(path.join(dir, licenseFile), 'utf8').trim();
  return `## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license ?? 'see below'}\n\n\`\`\`text\n${text}\n\`\`\``;
});

writeFileSync(
  'dist/THIRD_PARTY_NOTICES.md',
  `# Third-party notices\n\ndist/mdzip-mcp-server.js bundles the following packages. Their licenses follow.\n\n${sections.join('\n\n')}\n`
);
console.log(`dist/THIRD_PARTY_NOTICES.md: ${sections.length} packages`);
