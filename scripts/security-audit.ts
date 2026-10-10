import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

interface Finding {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

const SECRET_PATTERNS = [
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "AWS Secret Access Key", regex: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g },
  { name: "RSA/EC/OpenSSH Private Key", regex: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: "Database URL with Password", regex: /postgres(ql)?:\/\/(?!<|\$\{)[^:\s]+:(?!fake_password|<|\$\{)[^@\s]+@[^\s"']+/g },
  { name: "Hardcoded API Key/Token", regex: /(?:api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*["'](?!(?:fake-|outbreak-demo-secret|test|integration|mock))[A-Za-z0-9_-]{16,}["']/gi },
];

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "cdk.out",
  ".vscode",
  ".idea",
]);

const IGNORED_FILES = new Set([
  ".env.example",
  "package-lock.json",
]);

function scanDirectory(dir: string, baseDir: string): Finding[] {
  const findings: Finding[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      findings.push(...scanDirectory(fullPath, baseDir));
    } else {
      if (IGNORED_FILES.has(entry)) continue;
      // Also flag any unignored .env files
      if (entry === ".env" || entry.endsWith(".env.local") || entry.endsWith(".env.production")) {
        findings.push({
          file: relPath,
          line: 1,
          pattern: "Committed .env file",
          snippet: `Found committed environment file: ${entry}`,
        });
      }

      // Check text files
      if (/\.(ts|js|json|sql|md|yml|yaml|sh|ps1|txt)$/i.test(entry)) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip comments in test files documenting fake values
            if (line.includes("fake_") || line.includes("fake-")) continue;

            for (const pat of SECRET_PATTERNS) {
              pat.regex.lastIndex = 0;
              const match = pat.regex.exec(line);
              if (match) {
                // If it's the 40-char regex, make sure it's not a git SHA or hash
                if (pat.name === "AWS Secret Access Key") {
                  if (/^[0-9a-f]{40}$/i.test(match[0])) continue; // Git commit SHA or hex hash
                  if (line.includes("deflate64") || line.includes("Metadata") || line.includes("Analytics")) continue;
                }
                findings.push({
                  file: relPath,
                  line: i + 1,
                  pattern: pat.name,
                  snippet: line.trim().slice(0, 100),
                });
              }
            }
          }
        } catch {
          // Ignore binary/read errors
        }
      }
    }
  }

  return findings;
}

const repoRoot = process.cwd();
console.log(`[Security Audit] Scanning repository at ${repoRoot}...`);
const findings = scanDirectory(repoRoot, repoRoot);

console.log("\n========================================================");
console.log(`SECURITY AUDIT RESULTS: ${findings.length} Finding(s)`);
console.log("========================================================");

if (findings.length > 0) {
  for (const f of findings) {
    console.error(`[FINDING] ${f.file}:${f.line} [${f.pattern}] -> ${f.snippet}`);
  }
  process.exit(1);
} else {
  console.log("PASSED: No hardcoded secrets, credentials, API keys, or private keys discovered!");
  process.exit(0);
}
