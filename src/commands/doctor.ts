import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectConfig } from "@/types.js";
import { active, bar, done, error, sanitize, warn } from "@/utils/colors.js";
import {
  detectConfig,
  findPackageManagerEvidence,
  getInstalledDependencyNames,
  isAstroProject,
  LOCKFILES,
} from "@/utils/detect.js";
import { fetchRegistry } from "@/utils/registry.js";
import { startUpdateCheck } from "@/utils/update-check.js";

type CheckStatus = "fail" | "pass" | "warn";

interface CheckResult {
  id: string;
  label: string;
  message: string;
  status: CheckStatus;
}

interface DoctorOptions {
  cwd?: string;
  json?: boolean;
  path?: string;
  registry?: string;
}

const MIN_NODE_MAJOR = 18;
const TAILWIND_CONFIG_FILES = [
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
];

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(cwd: string): PackageJsonShape | null {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJsonShape;
  } catch {
    return null;
  }
}

function getDepVersion(
  pkg: PackageJsonShape | null,
  name: string
): string | null {
  return pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name] ?? null;
}

/**
 * Walks up from cwd looking for `name` in a package.json's dependencies —
 * mirrors detectPackageManager's ancestor walk, since a workspace package
 * (e.g. `packages/ui` in a Turborepo/Bun/pnpm monorepo) commonly relies on
 * a shared devDependency like tailwindcss or react declared once at the
 * monorepo root rather than duplicated in every package.json.
 */
function findAncestorDependencyVersion(
  cwd: string,
  name: string
): string | null {
  let dir = cwd;
  for (;;) {
    const version = getDepVersion(readPackageJson(dir), name);
    if (version) {
      return version;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function checkNodeVersion(): CheckResult {
  const major = Number.parseInt(
    process.version.slice(1).split(".")[0] ?? "0",
    10
  );
  if (major < MIN_NODE_MAJOR) {
    return {
      id: "node-version",
      label: "Node.js version",
      message: `Node ${process.version} detected — sora-cli requires Node >= ${MIN_NODE_MAJOR}.`,
      status: "fail",
    };
  }
  return {
    id: "node-version",
    label: "Node.js version",
    message: `Node ${process.version}`,
    status: "pass",
  };
}

/**
 * Walks up from cwd looking for a package.json — the most basic signal that
 * this is a Node.js project at all. Run first and surfaced prominently so a
 * user who runs `sora doctor` from a random directory (e.g. their home
 * folder) immediately understands why every check below it is either a
 * "not found, that's fine" pass or a "defaulting to X" warning, rather than
 * being misled by a wall of green checkmarks into thinking everything's set
 * up correctly.
 */
function checkProjectRoot(cwd: string): CheckResult {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) {
      return {
        id: "project-root",
        label: "Project",
        message: "package.json found.",
        status: "pass",
      };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return {
    id: "project-root",
    label: "Project",
    message:
      "No package.json found in this directory or any parent — this doesn't look like a Node.js project. Run doctor from inside your project.",
    status: "warn",
  };
}

function checkPackageManager(config: ProjectConfig): CheckResult {
  const found = LOCKFILES.filter(([file]) =>
    existsSync(join(config.cwd, file))
  );
  if (found.length > 1) {
    const names = found.map(([file]) => file).join(", ");
    return {
      id: "package-manager",
      label: "Package manager",
      message: `Detected ${config.packageManager}, but multiple lockfiles found (${names}) — this can install packages with the wrong tool.`,
      status: "warn",
    };
  }
  if (!findPackageManagerEvidence(config.cwd)) {
    return {
      id: "package-manager",
      label: "Package manager",
      message: `No lockfile or "packageManager" field found in this directory or any parent — defaulting to ${config.packageManager}. This doesn't look like a Node.js project.`,
      status: "warn",
    };
  }
  return {
    id: "package-manager",
    label: "Package manager",
    message: `Detected ${config.packageManager}`,
    status: "pass",
  };
}

function checkComponentsJson(cwd: string): CheckResult {
  const path = join(cwd, "components.json");
  if (!existsSync(path)) {
    return {
      id: "components-json",
      label: "components.json",
      message:
        "Not found — optional, falls back to tsconfig/jsconfig alias detection.",
      status: "pass",
    };
  }

  let parsed: { aliases?: unknown };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return {
      id: "components-json",
      label: "components.json",
      message: `Invalid JSON: ${(err as Error).message}`,
      status: "fail",
    };
  }

  if (
    "aliases" in parsed &&
    parsed.aliases !== undefined &&
    (typeof parsed.aliases !== "object" || parsed.aliases === null)
  ) {
    return {
      id: "components-json",
      label: "components.json",
      message: '"aliases" field should be an object.',
      status: "warn",
    };
  }

  return {
    id: "components-json",
    label: "components.json",
    message: "Found and valid.",
    status: "pass",
  };
}

function checkAstroAlias(config: ProjectConfig): CheckResult | null {
  if (!isAstroProject(config.cwd)) {
    return null;
  }
  if (config.aliasConfigured) {
    return {
      id: "astro-alias",
      label: "Astro path alias",
      message: `"${config.aliases.components.split("/")[0]}/*" alias configured.`,
      status: "pass",
    };
  }
  return {
    id: "astro-alias",
    label: "Astro path alias",
    message: `No "${config.aliases.components.split("/")[0]}/*" path alias found in tsconfig.json/jsconfig.json — Astro's Vite bundler won't resolve it on its own. Add a matching "compilerOptions.paths" entry plus a Vite alias (or install vite-tsconfig-paths) before installing.`,
    status: "warn",
  };
}

function checkPathAlias(config: ProjectConfig): CheckResult {
  if (config.aliasConfigured) {
    return {
      id: "path-alias",
      label: "Path alias",
      message: `"${config.aliases.components.split("/")[0]}/*" alias configured.`,
      status: "pass",
    };
  }
  return {
    id: "path-alias",
    label: "Path alias",
    message:
      'No "paths" entry found in tsconfig.json/jsconfig.json and no components.json aliases — using default "@/*".',
    status: "warn",
  };
}

const MAJOR_VERSION_PATTERN = /(\d+)/;

function parseMajorVersion(version: string): number | null {
  const match = version.match(MAJOR_VERSION_PATTERN);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function checkTailwind(cwd: string): CheckResult {
  const version = findAncestorDependencyVersion(cwd, "tailwindcss");
  if (!version) {
    return {
      id: "tailwind",
      label: "Tailwind CSS",
      message:
        "Not found in dependencies — Sora UI components are styled with Tailwind utility classes and require it.",
      status: "warn",
    };
  }

  const major = parseMajorVersion(version);
  if (major !== null && major < 3) {
    return {
      id: "tailwind",
      label: "Tailwind CSS",
      message: `Version ${version} detected — Sora UI components require Tailwind v3 or later.`,
      status: "warn",
    };
  }

  if (
    major === 3 &&
    !TAILWIND_CONFIG_FILES.some((file) => existsSync(join(cwd, file)))
  ) {
    return {
      id: "tailwind",
      label: "Tailwind CSS",
      message: `Version ${version} detected, but no tailwind.config.{js,ts,cjs,mjs} found.`,
      status: "warn",
    };
  }

  const note =
    major === 4
      ? " (v4 uses CSS-first config — no tailwind.config.js required)"
      : "";
  return {
    id: "tailwind",
    label: "Tailwind CSS",
    message: `Version ${version} detected.${note}`,
    status: "pass",
  };
}

function checkReact(cwd: string): CheckResult {
  const version = findAncestorDependencyVersion(cwd, "react");
  if (!version) {
    return {
      id: "react",
      label: "React",
      message:
        "Not found in dependencies — Sora UI components are React components.",
      status: "warn",
    };
  }
  return {
    id: "react",
    label: "React",
    message: `Version ${version} detected.`,
    status: "pass",
  };
}

function checkUtilsDeps(config: ProjectConfig): CheckResult {
  const utilsPath = join(config.cwd, config.srcDir, "lib", "utils.ts");
  if (!existsSync(utilsPath)) {
    return {
      id: "utils-deps",
      label: "cn() utils dependencies",
      message: "lib/utils.ts not installed yet.",
      status: "pass",
    };
  }

  const installed = getInstalledDependencyNames(config.cwd);
  const missing = ["clsx", "tailwind-merge"].filter(
    (dep) => !installed.has(dep)
  );
  if (missing.length > 0) {
    return {
      id: "utils-deps",
      label: "cn() utils dependencies",
      message: `lib/utils.ts exists but ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} missing from package.json — the cn() helper will fail to build.`,
      status: "fail",
    };
  }

  return {
    id: "utils-deps",
    label: "cn() utils dependencies",
    message: "clsx and tailwind-merge installed.",
    status: "pass",
  };
}

async function checkRegistry(
  registry: string | undefined
): Promise<CheckResult> {
  try {
    const data = await fetchRegistry(registry);
    return {
      id: "registry",
      label: "Registry",
      message: `Reachable: ${sanitize(data.name)}`,
      status: "pass",
    };
  } catch (err) {
    return {
      id: "registry",
      label: "Registry",
      message: (err as Error).message,
      status: "fail",
    };
  }
}

async function checkCliVersion(currentVersion: string): Promise<CheckResult> {
  const latest = await startUpdateCheck(currentVersion);
  if (latest) {
    return {
      id: "cli-version",
      label: "sora-cli version",
      message: `${currentVersion} installed, ${latest} available — run "npm i -g @soralabsoss/sora-cli" to update.`,
      status: "warn",
    };
  }
  return {
    id: "cli-version",
    label: "sora-cli version",
    message: `${currentVersion} (up to date)`,
    status: "pass",
  };
}

function printResult(result: CheckResult): void {
  const line = `${result.label}: ${sanitize(result.message)}`;
  if (result.status === "pass") {
    done(line);
  } else if (result.status === "warn") {
    warn(line);
  } else {
    error(line);
  }
}

export async function doctor(
  currentVersion: string,
  options: DoctorOptions
): Promise<boolean> {
  const cwd = options.cwd ?? process.cwd();
  const config = detectConfig(cwd);
  if (options.path) {
    config.componentPath = options.path;
  }

  const syncResults: CheckResult[] = [
    checkProjectRoot(cwd),
    checkNodeVersion(),
    checkPackageManager(config),
    checkComponentsJson(cwd),
  ];

  const astroResult = checkAstroAlias(config);
  if (astroResult) {
    syncResults.push(astroResult);
  } else {
    syncResults.push(checkPathAlias(config));
  }

  syncResults.push(checkTailwind(cwd), checkReact(cwd), checkUtilsDeps(config));

  if (!options.json) {
    active("Running project diagnostics...");
    console.log();
  }

  const [registryResult, versionResult] = await Promise.all([
    checkRegistry(options.registry),
    checkCliVersion(currentVersion),
  ]);

  const results = [...syncResults, registryResult, versionResult];

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      printResult(result);
    }

    const passed = results.filter((r) => r.status === "pass").length;
    const warned = results.filter((r) => r.status === "warn").length;
    const failed = results.filter((r) => r.status === "fail").length;
    console.log();
    bar(
      `${passed} passed, ${warned} warning${warned === 1 ? "" : "s"}, ${failed} failed`
    );
  }

  return !results.some((result) => result.status === "fail");
}
