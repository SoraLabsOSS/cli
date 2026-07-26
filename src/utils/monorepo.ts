import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TRAILING_GLOB = /\/\*$/;
const YAML_KEY_LINE = /^(\s*)([A-Za-z0-9_-]+)\s*:/;
const YAML_LIST_ITEM_LINE = /^(\s*)-\s*(.+?)\s*(?:#.*)?$/;

/**
 * Workspace-root signal files. Their presence means installing components
 * straight into `cwd` is very likely wrong — the actual project lives one
 * level down in a workspace package, not at this directory.
 */
function hasWorkspaceField(cwd: string): boolean {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    return false;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      workspaces?: unknown;
    };
    return Boolean(pkg.workspaces);
  } catch {
    return false;
  }
}

/**
 * Detects whether `cwd` is the root of a monorepo (pnpm/yarn/npm workspaces,
 * Lerna, or Nx) rather than an installable project itself. Mirrors shadcn's
 * own `isMonorepoRoot` check so `sora add` guards against the same footgun:
 * silently writing components into a workspace root that has no framework
 * of its own.
 */
export function isMonorepoRoot(cwd: string): boolean {
  return (
    existsSync(join(cwd, "pnpm-workspace.yaml")) ||
    hasWorkspaceField(cwd) ||
    existsSync(join(cwd, "lerna.json")) ||
    existsSync(join(cwd, "nx.json"))
  );
}

/** Minimal YAML list parser for pnpm-workspace.yaml's `packages:` key. */
export function parsePnpmWorkspacePackages(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  let packagesIndent = 0;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const keyMatch = line.match(YAML_KEY_LINE);
    if (keyMatch) {
      packagesIndent = (keyMatch[1] ?? "").length;
      inPackages = keyMatch[2] === "packages";
      continue;
    }

    if (!inPackages) {
      continue;
    }

    const itemMatch = line.match(YAML_LIST_ITEM_LINE);
    if (!itemMatch || (itemMatch[1] ?? "").length <= packagesIndent) {
      continue;
    }

    patterns.push((itemMatch[2] ?? "").trim().replace(/^["']|["']$/g, ""));
  }

  return patterns;
}

function getWorkspacePatterns(cwd: string): string[] {
  const patterns: string[] = [];

  const pnpmWorkspacePath = join(cwd, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    patterns.push(
      ...parsePnpmWorkspacePackages(readFileSync(pnpmWorkspacePath, "utf8"))
    );
  }

  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        workspaces?: string[] | { packages?: string[] };
      };
      const workspaces = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces?.packages;
      if (Array.isArray(workspaces)) {
        patterns.push(...workspaces.filter((w) => !w.startsWith("!")));
      }
    } catch {
      // malformed package.json, fall through
    }
  }

  return [...new Set(patterns)];
}

/** Expands `packages/*`-style patterns to actual child directories that exist on disk. */
function resolveWorkspaceDirs(cwd: string, patterns: string[]): string[] {
  const dirs = new Set<string>();

  for (const pattern of patterns) {
    if (TRAILING_GLOB.test(pattern)) {
      const base = pattern.replace(TRAILING_GLOB, "");
      const baseDir = join(cwd, base);
      if (!existsSync(baseDir)) {
        continue;
      }
      let entries: import("node:fs").Dirent[];
      try {
        entries = readdirSync(baseDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.add(`${base}/${entry.name}`);
        }
      }
    } else if (existsSync(join(cwd, pattern))) {
      dirs.add(pattern);
    }
  }

  return [...dirs];
}

export interface MonorepoTarget {
  hasConfig: boolean;
  name: string;
}

/**
 * Finds workspace packages under a monorepo root that look like real,
 * installable projects (they have their own package.json). Used to suggest
 * concrete `--cwd` targets when `sora add` refuses to run at the root.
 */
export function getMonorepoTargets(cwd: string): MonorepoTarget[] {
  const patterns = getWorkspacePatterns(cwd);
  if (patterns.length === 0) {
    return [];
  }

  const targets: MonorepoTarget[] = [];
  for (const dir of resolveWorkspaceDirs(cwd, patterns)) {
    const fullPath = join(cwd, dir);
    if (!existsSync(join(fullPath, "package.json"))) {
      continue;
    }
    targets.push({
      hasConfig: existsSync(join(fullPath, "components.json")),
      name: dir,
    });
  }

  return targets;
}
