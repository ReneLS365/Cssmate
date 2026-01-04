#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const publishDir = path.join(ROOT, ".netlify_publish");
const indexPath = path.join(publishDir, "index.html");

try {
  fs.accessSync(indexPath, fs.constants.F_OK);
  console.log(`[verify-publish-root] OK: ${path.relative(ROOT, indexPath)}`);
} catch {
  console.error(`[verify-publish-root] FAIL: Missing ${path.relative(ROOT, indexPath)}`);
  process.exit(1);
}
