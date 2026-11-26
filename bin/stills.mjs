#!/usr/bin/env node
// Stills of a motlab scene without DevTools: node stills.mjs <scene.html> <outDir> <t1> <t2> ...  (run in the project folder)
import path from 'node:path';
import { browserStills } from '../src/browser-render.mjs';

const [scene, outDir, ...ts] = process.argv.slice(2);
if (!scene || !outDir || !ts.length) { console.error('usage: stills.mjs <scene.html> <outDir> <t1> [t2 ...]'); process.exit(1); }
const projectDir = process.cwd();
try {
  const files = await browserStills({ projectDir, scene: path.relative(projectDir, path.resolve(scene)), outDir: path.resolve(outDir), times: ts.map(Number) });
  for (const f of files) console.log(path.relative(projectDir, f).replaceAll('\\', '/'));
} catch (e) { console.error(`FAILED: ${e.message}`); process.exit(1); }
