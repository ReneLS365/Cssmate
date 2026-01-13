import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPORTS_ROOT = path.join(process.cwd(), "reports", "repo-scan");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const REPORT_DIR = path.join(REPORTS_ROOT, TIMESTAMP);
const LATEST_DIR = path.join(REPORTS_ROOT, "latest");
const TOP_REPORT_PATH = path.join(REPORTS_ROOT, "REPORT.md");

const MAX_LOG_LINES = 4000;
const MAX_MATCHES = 500;
const MAX_FILE_BYTES = 1024 * 1024;

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function truncateLines(text, maxLines) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return { text, truncated: false, totalLines: lines.length };
  }
  const truncatedText = lines.slice(0, maxLines).join("\n");
  const note = `\n\nTRUNCATED after ${maxLines} lines (original ${lines.length} lines).`;
  return { text: `${truncatedText}${note}`, truncated: true, totalLines: lines.length };
}

async function runCommand(command, label) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code, signal) => {
      const exitCode = code ?? (signal ? 1 : 0);
      resolve({ label, command, exitCode, signal, stdout, stderr });
    });
  });
}

async function writeLog(baseName, content) {
  const { text, truncated, totalLines } = truncateLines(content, MAX_LOG_LINES);
  await fs.writeFile(baseName, text, "utf8");
  return { truncated, totalLines };
}

async function loadPackageScripts() {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const data = JSON.parse(raw);
  return data.scripts ?? {};
}

function hasScript(scripts, name) {
  return Object.prototype.hasOwnProperty.call(scripts, name);
}

function findScriptByPrefix(scripts, prefixes) {
  return Object.keys(scripts).find((name) =>
    prefixes.some((prefix) => name.startsWith(prefix))
  );
}

function findScriptsByKeyword(scripts, keywords) {
  return Object.keys(scripts).filter((name) =>
    keywords.some((keyword) => name.includes(keyword))
  );
}

async function summarizeGitLsFiles(fileList) {
  const extCounts = new Map();
  for (const file of fileList) {
    const ext = path.extname(file) || "no-ext";
    extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
  }
  const sorted = Array.from(extCounts.entries()).sort((a, b) => b[1] - a[1]);
  return {
    totalFiles: fileList.length,
    topExtensions: sorted.slice(0, 12).map(([ext, count]) => ({ ext, count })),
  };
}

function makeSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function scanCodePatterns(fileList, reportDir) {
  const patterns = [
    { key: "TODO", regex: /\bTODO\b/g },
    { key: "FIXME", regex: /\bFIXME\b/g },
    { key: "HACK", regex: /\bHACK\b/g },
    { key: "console.error", regex: /\bconsole\.error\b/g },
    { key: "console.warn", regex: /\bconsole\.warn\b/g },
    { key: "eval(", regex: /\beval\(/g },
    { key: "dangerouslySetInnerHTML", regex: /\bdangerouslySetInnerHTML\b/g },
    { key: "apiKey", regex: /\bapiKey\b/gi },
  ];

  const results = [];
  const totals = Object.fromEntries(patterns.map((pattern) => [pattern.key, 0]));

  for (const file of fileList) {
    if (file.startsWith("reports/repo-scan/")) {
      continue;
    }
    const filePath = path.join(process.cwd(), file);
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
      continue;
    }
    const content = await fs.readFile(filePath, "utf8").catch(() => "");
    if (!content) {
      continue;
    }
    if (content.includes("\u0000")) {
      continue;
    }
    const lines = content.split("\n");
    patterns.forEach((pattern) => {
      lines.forEach((line, index) => {
        if (pattern.regex.test(line)) {
          totals[pattern.key] += 1;
          if (results.length < MAX_MATCHES) {
            results.push({
              file,
              line: index + 1,
              pattern: pattern.key,
              excerpt: line.trim().slice(0, 200),
            });
          }
        }
        pattern.regex.lastIndex = 0;
      });
    });
  }

  const jsonPath = path.join(reportDir, "code-patterns.json");
  const mdPath = path.join(reportDir, "code-patterns.md");

  await fs.writeFile(
    jsonPath,
    JSON.stringify({ totals, matches: results, maxMatches: MAX_MATCHES }, null, 2),
    "utf8"
  );

  const summaryLines = [
    "# Code pattern scan",
    "",
    "## Totals",
    "",
    ...Object.entries(totals).map(([key, count]) => `- **${key}**: ${count}`),
    "",
    `Showing up to ${MAX_MATCHES} matches in JSON output.`,
    "",
  ];

  await fs.writeFile(mdPath, summaryLines.join("\n"), "utf8");

  return { totals, jsonPath, mdPath };
}

async function writeReport({
  reportDir,
  summary,
  scans,
  codePatterns,
  gitSummary,
  envInfo,
}) {
  const lines = [
    `# Repo Scan Report (${TIMESTAMP})`,
    "",
    "## Environment",
    "",
    `- OS: ${envInfo.os}`,
    `- Node: ${envInfo.node}`,
    `- npm: ${envInfo.npm}`,
    `- CPU: ${envInfo.cpu}`,
    "",
    "## Repo inventory",
    "",
    `- Tracked files: ${gitSummary.totalFiles}`,
    "### Top extensions",
    ...gitSummary.topExtensions.map((entry) => `- ${entry.ext}: ${entry.count}`),
    "",
    "## Commands executed",
    "",
    "| Scan | Command | Exit code | Output |",
    "| --- | --- | --- | --- |",
    ...scans.map((scan) => {
      const output = scan.outputFiles.length
        ? scan.outputFiles.map((file) => `\`${file}\``).join("<br>")
        : scan.note || "SKIPPED";
      return `| ${scan.label} | \`${scan.command || "SKIPPED"}\` | ${scan.exitCode ?? "—"} | ${output} |`;
    }),
    "",
    "## Key findings",
    "",
  ];

  const failures = scans.filter((scan) => scan.exitCode && scan.exitCode !== 0);
  if (failures.length) {
    lines.push("### Non-zero exit codes");
    failures.forEach((scan) => {
      lines.push(`- ${scan.label}: exit ${scan.exitCode}`);
    });
    lines.push("");
  }

  if (codePatterns) {
    lines.push("### Code pattern totals");
    Object.entries(codePatterns.totals).forEach(([key, count]) => {
      lines.push(`- ${key}: ${count}`);
    });
    lines.push("");
  }

  if (!failures.length && codePatterns) {
    lines.push("No non-zero exits detected.");
    lines.push("");
  }

  lines.push("## Raw logs");
  lines.push("");
  lines.push(`See \`${path.relative(process.cwd(), reportDir)}\` for full logs.`);
  lines.push("");

  await fs.writeFile(path.join(reportDir, "REPORT.md"), lines.join("\n"), "utf8");
}

async function copyLatest(reportDir) {
  await fs.rm(LATEST_DIR, { recursive: true, force: true });
  await fs.cp(reportDir, LATEST_DIR, { recursive: true });
}

async function main() {
  await ensureDir(REPORT_DIR);
  await ensureDir(REPORTS_ROOT);

  const scripts = await loadPackageScripts();
  const scans = [];

  const gitStatus = await runCommand("git status --porcelain", "Repo status");
  const gitStatusOut = await writeLog(path.join(REPORT_DIR, "01-repo-status.stdout.log"), gitStatus.stdout);
  const gitStatusErr = await writeLog(path.join(REPORT_DIR, "01-repo-status.stderr.log"), gitStatus.stderr);
  scans.push({
    label: gitStatus.label,
    command: gitStatus.command,
    exitCode: gitStatus.exitCode,
    outputFiles: [
      "01-repo-status.stdout.log",
      "01-repo-status.stderr.log",
    ],
    truncated: gitStatusOut.truncated || gitStatusErr.truncated,
  });

  const gitLsFiles = await runCommand("git ls-files", "Repo inventory");
  await writeLog(path.join(REPORT_DIR, "02-git-ls-files.stdout.log"), gitLsFiles.stdout);
  await writeLog(path.join(REPORT_DIR, "02-git-ls-files.stderr.log"), gitLsFiles.stderr);
  const fileList = gitLsFiles.stdout.split("\n").filter(Boolean);
  const gitSummary = await summarizeGitLsFiles(fileList);
  scans.push({
    label: gitLsFiles.label,
    command: gitLsFiles.command,
    exitCode: gitLsFiles.exitCode,
    outputFiles: [
      "02-git-ls-files.stdout.log",
      "02-git-ls-files.stderr.log",
    ],
  });

  const npmCiAllowed = process.env.CI === "true" || process.env.REPO_SCAN_NPM_CI === "true";
  if (npmCiAllowed) {
    const npmCi = await runCommand("npm ci", "Install integrity (npm ci)");
    await writeLog(path.join(REPORT_DIR, "03-npm-ci.stdout.log"), npmCi.stdout);
    await writeLog(path.join(REPORT_DIR, "03-npm-ci.stderr.log"), npmCi.stderr);
    scans.push({
      label: npmCi.label,
      command: npmCi.command,
      exitCode: npmCi.exitCode,
      outputFiles: ["03-npm-ci.stdout.log", "03-npm-ci.stderr.log"],
    });
  } else {
    scans.push({
      label: "Install integrity (npm ci)",
      command: "npm ci",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not running in CI; set REPO_SCAN_NPM_CI=true to enable)",
    });
  }

  if (hasScript(scripts, "build")) {
    const build = await runCommand("npm run build", "Build");
    await writeLog(path.join(REPORT_DIR, "04-build.stdout.log"), build.stdout);
    await writeLog(path.join(REPORT_DIR, "04-build.stderr.log"), build.stderr);
    scans.push({
      label: build.label,
      command: build.command,
      exitCode: build.exitCode,
      outputFiles: ["04-build.stdout.log", "04-build.stderr.log"],
    });
  } else {
    scans.push({
      label: "Build",
      command: "npm run build",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  const testScript = hasScript(scripts, "test") ? "npm test" : hasScript(scripts, "test:unit") ? "npm run test:unit" : null;
  if (testScript) {
    const unitTests = await runCommand(testScript, "Unit tests");
    await writeLog(path.join(REPORT_DIR, "05-tests.stdout.log"), unitTests.stdout);
    await writeLog(path.join(REPORT_DIR, "05-tests.stderr.log"), unitTests.stderr);
    scans.push({
      label: unitTests.label,
      command: unitTests.command,
      exitCode: unitTests.exitCode,
      outputFiles: ["05-tests.stdout.log", "05-tests.stderr.log"],
    });
  } else {
    scans.push({
      label: "Unit tests",
      command: "npm test",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  if (hasScript(scripts, "lint")) {
    const lint = await runCommand("npm run lint", "Lint");
    await writeLog(path.join(REPORT_DIR, "06-lint.stdout.log"), lint.stdout);
    await writeLog(path.join(REPORT_DIR, "06-lint.stderr.log"), lint.stderr);
    scans.push({
      label: lint.label,
      command: lint.command,
      exitCode: lint.exitCode,
      outputFiles: ["06-lint.stdout.log", "06-lint.stderr.log"],
    });
  } else {
    scans.push({
      label: "Lint",
      command: "npm run lint",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  const formatScript = hasScript(scripts, "format:check")
    ? "npm run format:check"
    : hasScript(scripts, "prettier:check")
    ? "npm run prettier:check"
    : null;
  if (formatScript) {
    const format = await runCommand(formatScript, "Formatting check");
    await writeLog(path.join(REPORT_DIR, "07-format.stdout.log"), format.stdout);
    await writeLog(path.join(REPORT_DIR, "07-format.stderr.log"), format.stderr);
    scans.push({
      label: format.label,
      command: format.command,
      exitCode: format.exitCode,
      outputFiles: ["07-format.stdout.log", "07-format.stderr.log"],
    });
  } else {
    scans.push({
      label: "Formatting check",
      command: "npm run format:check",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  const audit = await runCommand("npm audit --json", "Dependency audit");
  await writeLog(path.join(REPORT_DIR, "08-audit.stdout.log"), audit.stdout);
  await writeLog(path.join(REPORT_DIR, "08-audit.stderr.log"), audit.stderr);
  scans.push({
    label: audit.label,
    command: audit.command,
    exitCode: audit.exitCode,
    outputFiles: ["08-audit.stdout.log", "08-audit.stderr.log"],
  });

  const licenseScript = findScriptByPrefix(scripts, ["license", "licenses"]);
  if (licenseScript) {
    const license = await runCommand(`npm run ${licenseScript}`, "License inventory");
    await writeLog(path.join(REPORT_DIR, "09-licenses.stdout.log"), license.stdout);
    await writeLog(path.join(REPORT_DIR, "09-licenses.stderr.log"), license.stderr);
    scans.push({
      label: license.label,
      command: license.command,
      exitCode: license.exitCode,
      outputFiles: ["09-licenses.stdout.log", "09-licenses.stderr.log"],
    });
  } else {
    scans.push({
      label: "License inventory",
      command: "npm run license",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  const analyzeScript =
    (hasScript(scripts, "analyze") && "npm run analyze") ||
    (hasScript(scripts, "perf:bundle") && "npm run perf:bundle") ||
    (hasScript(scripts, "bundle:analyze") && "npm run bundle:analyze");
  if (analyzeScript) {
    const analyze = await runCommand(analyzeScript, "Bundle analysis");
    await writeLog(path.join(REPORT_DIR, "10-analyze.stdout.log"), analyze.stdout);
    await writeLog(path.join(REPORT_DIR, "10-analyze.stderr.log"), analyze.stderr);
    scans.push({
      label: analyze.label,
      command: analyze.command,
      exitCode: analyze.exitCode,
      outputFiles: ["10-analyze.stdout.log", "10-analyze.stderr.log"],
    });
  } else {
    scans.push({
      label: "Bundle analysis",
      command: "npm run analyze",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  const lighthouseScript = findScriptByPrefix(scripts, ["lh:", "test:lh"]);
  if (lighthouseScript) {
    const lighthouse = await runCommand(`npm run ${lighthouseScript}`, "Lighthouse");
    await writeLog(path.join(REPORT_DIR, "11-lighthouse.stdout.log"), lighthouse.stdout);
    await writeLog(path.join(REPORT_DIR, "11-lighthouse.stderr.log"), lighthouse.stderr);
    scans.push({
      label: lighthouse.label,
      command: lighthouse.command,
      exitCode: lighthouse.exitCode,
      outputFiles: ["11-lighthouse.stdout.log", "11-lighthouse.stderr.log"],
    });
  } else {
    scans.push({
      label: "Lighthouse",
      command: "npm run lh:mobile",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  const deadCodeScript =
    (hasScript(scripts, "knip") && "npm run knip") ||
    (hasScript(scripts, "ts-prune") && "npm run ts-prune") ||
    (hasScript(scripts, "prune") && "npm run prune");
  if (deadCodeScript) {
    const deadCode = await runCommand(deadCodeScript, "Dead code scan");
    await writeLog(path.join(REPORT_DIR, "12-dead-code.stdout.log"), deadCode.stdout);
    await writeLog(path.join(REPORT_DIR, "12-dead-code.stderr.log"), deadCode.stderr);
    scans.push({
      label: deadCode.label,
      command: deadCode.command,
      exitCode: deadCode.exitCode,
      outputFiles: ["12-dead-code.stdout.log", "12-dead-code.stderr.log"],
    });
  } else {
    scans.push({
      label: "Dead code scan",
      command: "npm run knip",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  if (hasScript(scripts, "guard:secrets")) {
    const secrets = await runCommand("npm run guard:secrets", "Secrets scan");
    await writeLog(path.join(REPORT_DIR, "13-secrets.stdout.log"), secrets.stdout);
    await writeLog(path.join(REPORT_DIR, "13-secrets.stderr.log"), secrets.stderr);
    scans.push({
      label: secrets.label,
      command: secrets.command,
      exitCode: secrets.exitCode,
      outputFiles: ["13-secrets.stdout.log", "13-secrets.stderr.log"],
    });
  } else {
    scans.push({
      label: "Secrets scan",
      command: "npm run guard:secrets",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  const headersScripts = findScriptsByKeyword(scripts, ["csp", "headers"]);
  if (headersScripts.length) {
    const headersScript = headersScripts[0];
    const headers = await runCommand(`npm run ${headersScript}`, "CSP/headers checks");
    await writeLog(path.join(REPORT_DIR, "14-headers.stdout.log"), headers.stdout);
    await writeLog(path.join(REPORT_DIR, "14-headers.stderr.log"), headers.stderr);
    scans.push({
      label: headers.label,
      command: headers.command,
      exitCode: headers.exitCode,
      outputFiles: ["14-headers.stdout.log", "14-headers.stderr.log"],
    });
  } else {
    scans.push({
      label: "CSP/headers checks",
      command: "npm run verify:headers",
      exitCode: null,
      outputFiles: [],
      note: "SKIPPED (not configured)",
    });
  }

  const codePatterns = await scanCodePatterns(fileList, REPORT_DIR);
  scans.push({
    label: "Code pattern scan",
    command: "node tools/repo-scan.mjs (patterns)",
    exitCode: 0,
    outputFiles: ["code-patterns.json", "code-patterns.md"],
  });

  const envInfo = {
    os: `${os.type()} ${os.release()}`,
    node: process.version,
    npm: (await runCommand("npm --version", "npm version")).stdout.trim(),
    cpu: `${os.cpus()[0]?.model ?? "unknown"} (${os.cpus().length} cores)`,
  };

  await writeReport({
    reportDir: REPORT_DIR,
    summary: {},
    scans,
    codePatterns,
    gitSummary,
    envInfo,
  });

  await copyLatest(REPORT_DIR);
  await fs.writeFile(
    TOP_REPORT_PATH,
    `See latest report: reports/repo-scan/latest/REPORT.md\n`,
    "utf8"
  );
}

await main();
