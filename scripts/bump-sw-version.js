#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function writeText(p, s) {
  fs.writeFileSync(p, s, "utf8");
}

function getShortSha() {
  const envSha =
    process.env.COMMIT_REF ||
    process.env.GITHUB_SHA ||
    process.env.SHA ||
    "";
  if (envSha) return String(envSha).slice(0, 8);

  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "nogit";
  }
}

function utcStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function findServiceWorker() {
  const candidates = [
    path.join(ROOT, "service-worker.js"),
    path.join(ROOT, "sw.js"),
    path.join(ROOT, "js", "service-worker.js"),
    path.join(ROOT, "js", "sw.js"),
    path.join(ROOT, "src", "service-worker.js"),
    path.join(ROOT, "src", "sw.js"),
  ];
  for (const p of candidates) if (exists(p)) return p;
  return null;
}

const swPath = findServiceWorker();
if (!swPath) {
  console.error("bump-sw-version: service worker file not found");
  process.exit(1);
}

const buildId = `${utcStamp()}-${getShortSha()}`;
const token = "__CACHE_VERSION__";

const before = readText(swPath);

if (before.includes(token)) {
  const after = before.split(token).join(buildId);
  writeText(swPath, after);
  console.log(`bump-sw-version: updated token in ${path.relative(ROOT, swPath)} -> ${buildId}`);
  process.exit(0);
}

const re = /(const\s+SW_BUILD_ID\s*=\s*['"])([^'"]*)(['"])/;
if (re.test(before)) {
  const after = before.replace(re, `$1${buildId}$3`);
  writeText(swPath, after);
  console.log(`bump-sw-version: updated SW_BUILD_ID in ${path.relative(ROOT, swPath)} -> ${buildId}`);
  process.exit(0);
}

console.error(`bump-sw-version: no token or SW_BUILD_ID assignment found in ${path.relative(ROOT, swPath)}`);
process.exit(1);
