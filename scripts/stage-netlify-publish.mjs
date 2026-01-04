#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".netlify_publish");

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function rmDir(p) {
  if (exists(p)) fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function findWebRoot() {
  const candidates = [
    path.join(ROOT, "dist"),
    path.join(ROOT, "public"),
    ROOT,
  ];
  for (const dir of candidates) {
    if (exists(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

const ROOT_ALLOW = new Set([
  "index.html",
  "main.js",
  "main.min.js",
  "app-main.js",
  "boot-inline.js",
  "style.css",
  "print.css",
  "service-worker.js",
  "manifest.webmanifest",
  "dataset.js",
  "js",
  "src",
  "css",
  "icons",
  "placeholders",
  "assets",
  "debug",
]);

const ROOT_DENY_PREFIX = [
  ".git",
  ".github",
  ".netlify",
  ".vscode",
  "node_modules",
  "tests",
  "tools",
  "scripts",
  "coverage",
  "reports",
  "dist",
];

function shouldCopyFromRoot(rel) {
  if (!rel || rel === ".") return false;
  if (ROOT_DENY_PREFIX.some(p => rel === p || rel.startsWith(p + path.sep))) return false;
  const top = rel.split(path.sep)[0];
  return ROOT_ALLOW.has(top);
}

function copyDirFiltered(srcDir, dstDir, filterFn) {
  ensureDir(dstDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const src = path.join(srcDir, ent.name);
    const dst = path.join(dstDir, ent.name);
    const rel = path.relative(ROOT, src);

    if (filterFn && !filterFn(rel, ent)) continue;

    if (ent.isDirectory()) {
      copyDirFiltered(src, dst, filterFn);
    } else if (ent.isFile()) {
      ensureDir(path.dirname(dst));
      fs.copyFileSync(src, dst);
    }
  }
}

function main() {
  rmDir(OUT_DIR);
  ensureDir(OUT_DIR);

  const webroot = findWebRoot();
  if (!webroot) {
    throw new Error("[stage-netlify] Could not find index.html in dist/, public/ or repo root.");
  }

  if (webroot === ROOT) {
    copyDirFiltered(ROOT, OUT_DIR, (rel) => shouldCopyFromRoot(rel));
  } else {
    copyDirFiltered(webroot, OUT_DIR, () => true);
  }

  const outIndex = path.join(OUT_DIR, "index.html");
  if (!exists(outIndex)) {
    throw new Error(`[stage-netlify] index.html missing in ${OUT_DIR}. Aborting.`);
  }

  console.log(`[stage-netlify] staged from: ${path.relative(ROOT, webroot) || "."}`);
  console.log(`[stage-netlify] OK: ${path.relative(ROOT, outIndex)}`);
}

main();
