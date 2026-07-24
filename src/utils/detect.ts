import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_COMPONENT_PATH } from "@/constants.js";
import type {
  ComponentAliases,
  PackageManager,
  ProjectConfig,
} from "@/types.js";

const TRAILING_GLOB = /\/\*$/;
const LEADING_DOT_SLASH = /^\.\//;
const PACKAGE_MANAGER_PREFIX = /^([a-z]+)@/;

export const LOCKFILES: [string, PackageManager][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

function readPackageManagerField(dir: string): PackageManager | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      packageManager?: string;
    };
    const match = pkg.packageManager?.match(PACKAGE_MANAGER_PREFIX);
    const name = match?.[1];
    if (
      name === "bun" ||
      name === "pnpm" ||
      name === "yarn" ||
      name === "npm"
    ) {
      return name;
    }
  } catch {
    // malformed package.json, fall through
  }
  return null;
}

/**
 * Walks up from cwd looking for a lockfile or a `packageManager` field,
 * returning whichever it found first (or null if nothing turned up all the
 * way to the filesystem root). Exported so doctor's package-manager check
 * can tell a real detection from detectPackageManager's bare "npm" fallback
 * — e.g. running `sora doctor` outside any Node project at all.
 */
export function findPackageManagerEvidence(cwd: string): PackageManager | null {
  let dir = cwd;

  for (;;) {
    for (const [file, manager] of LOCKFILES) {
      if (existsSync(join(dir, file))) {
        return manager;
      }
    }

    const fromPackageJson = readPackageManagerField(dir);
    if (fromPackageJson) {
      return fromPackageJson;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Walk up from cwd looking for a lockfile or a `packageManager` field, so
 * this resolves correctly when run from inside a workspace package whose
 * lockfile lives at the monorepo root (e.g. a Bun/pnpm/Turbo workspace).
 * Defaults to "npm" when nothing is found anywhere.
 */
function detectPackageManager(cwd: string): PackageManager {
  return findPackageManagerEvidence(cwd) ?? "npm";
}

function detectAlias(cwd: string): {
  alias: string;
  configured: boolean;
  srcDir: string;
} {
  for (const file of ["tsconfig.json", "jsconfig.json"]) {
    const filePath = join(cwd, file);
    if (!existsSync(filePath)) {
      continue;
    }
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      };
      const paths = parsed.compilerOptions?.paths ?? {};
      // Take the first `<prefix>/*` mapping, whatever the prefix is — most
      // projects use "@/*", but workspace packages often use something
      // like "@workspace/ui/*". Registry content is authored against the
      // "@/" convention, so this alias is used to rewrite it on write.
      const match = Object.entries(paths).find(([key]) => key.endsWith("/*"));
      if (match) {
        const alias = match[0].replace(TRAILING_GLOB, "");
        const target =
          match[1]?.[0]
            ?.replace(TRAILING_GLOB, "")
            .replace(LEADING_DOT_SLASH, "") ?? "";
        const srcDir =
          target === "src" || target.startsWith("src/") ? "src" : "";
        return { alias, configured: true, srcDir };
      }
    } catch {
      // malformed config, fall through to default
    }
  }
  return {
    alias: "@",
    configured: false,
    srcDir: existsSync(join(cwd, "src")) ? "src" : "",
  };
}

const ASTRO_CONFIG_FILES = [
  "astro.config.mjs",
  "astro.config.ts",
  "astro.config.js",
  "astro.config.cjs",
];

/**
 * Astro's Vite-based bundler doesn't pick up tsconfig `paths` on its own —
 * a project needs an explicit Vite alias (or the `vite-tsconfig-paths`
 * plugin) for "@/..." imports to actually resolve at build time. Detected
 * separately from `aliasConfigured` so `add.ts` can warn when a component's
 * rewritten imports would land in an Astro project with no alias wired up.
 */
export function isAstroProject(cwd: string): boolean {
  return ASTRO_CONFIG_FILES.some((file) => existsSync(join(cwd, file)));
}

/**
 * shadcn's own CLI reads per-category aliases straight from
 * `components.json` rather than guessing a single prefix — do the same
 * where it's present, since a project can point "hooks" and "lib" at
 * different roots than "components".
 */
function readComponentsJsonAliases(
  cwd: string
): Partial<ComponentAliases> | null {
  const path = join(cwd, "components.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      aliases?: Partial<ComponentAliases>;
    };
    return parsed.aliases ?? null;
  } catch {
    return null;
  }
}

/**
 * A registry item's declared dependencies shouldn't clobber a version the
 * user already pinned — read what's already there so callers can skip it.
 */
export function getInstalledDependencyNames(cwd: string): Set<string> {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) {
    return new Set();
  }
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

export function detectConfig(cwd: string): ProjectConfig {
  const { alias, configured, srcDir } = detectAlias(cwd);
  const fromComponentsJson = readComponentsJsonAliases(cwd);

  const aliases: ComponentAliases = {
    components: fromComponentsJson?.components ?? `${alias}/components`,
    hooks: fromComponentsJson?.hooks ?? `${alias}/hooks`,
    lib: fromComponentsJson?.lib ?? `${alias}/lib`,
    utils: fromComponentsJson?.utils ?? `${alias}/lib/utils`,
  };

  return {
    aliasConfigured: configured || fromComponentsJson !== null,
    aliases,
    componentPath: srcDir
      ? `${srcDir}/${DEFAULT_COMPONENT_PATH}`
      : DEFAULT_COMPONENT_PATH,
    cwd,
    packageManager: detectPackageManager(cwd),
    srcDir,
  };
}
