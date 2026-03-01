import fs from "node:fs";
import path from "node:path";

const LOCK_PATH = path.join(process.cwd(), "package-lock.json");

function parseSemver(v) {
  const main = String(v).trim().split("-")[0].split("+")[0];
  const m = main.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function gte(a, b) {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

function fail(msg) {
  console.error(`[guard:deps] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(LOCK_PATH)) fail(`Missing package-lock.json at ${LOCK_PATH}`);

const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
const pkgs = lock.packages || {};

const REQ = {
  tar: { min: "7.5.8" },
  qs: { min: "6.14.2" },
};

const violations = [];

for (const [pkgPath, meta] of Object.entries(pkgs)) {
  if (!meta?.version) continue;

  const name = pkgPath.split("node_modules/").pop();
  if (!name) continue;

  if (name === "tar" || name === "qs") {
    const min = parseSemver(REQ[name].min);
    const cur = parseSemver(meta.version);
    if (min && cur && !gte(cur, min)) {
      violations.push({ name, version: meta.version, pkgPath, min: REQ[name].min });
    }
  }
}

if (violations.length) {
  console.error("[guard:deps] Vulnerable versions detected in package-lock.json:");
  for (const v of violations) {
    console.error(` - ${v.name}@${v.version} at ${v.pkgPath} (min ${v.min})`);
  }
  console.error("\n[guard:deps] Fix: regenerate lockfile with npm install/ci so overrides apply, then commit package-lock.json.");
  process.exit(1);
}

console.log("[guard:deps] OK");
