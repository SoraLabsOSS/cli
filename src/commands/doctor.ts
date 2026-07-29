import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectConfig } from "@/types.js";
import { active, bar, done, error, sanitize, warn } from "@/utils/colors.js";
import {
  detectConfig,
  findAncestorDependency,
  findPackageManagerEvidence,
  isAstroProject,
  LOCKFILES,
} from "@/utils/detect.js";
import { utilsFilePath } from "@/utils/install.js";
import { fetchRegistry } from "@/utils/registry.js";
import { fetchLatestVersion, isNewer } from "@/utils/update-check.js";

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
  registry?: string;
}

const MIN_NODE_MAJOR = 18;
// Doctor is an explicit diagnostics run, so it can afford a longer budget
// than the fire-and-forget check other commands use — a slow network
// should produce a real answer here, not a false "couldn't reach npm".
const UPDATE_CHECK_TIMEOUT_MS = 5000;
const TAILWIND_CONFIG_FILES = [
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
];

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
  // Count distinct managers, not files — bun.lock + bun.lockb (left behind
  // by bun's lockfile-format migration) both mean bun, which is unambiguous.
  const managers = new Set(found.map(([, manager]) => manager));
  if (managers.size > 1) {
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
  // components.json aliases don't count here: Astro's Vite build resolves
  // imports via tsconfig paths (plus a Vite alias), so only a real
  // tsconfig/jsconfig entry means the written imports will work.
  if (config.tsconfigPathsConfigured) {
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

/**
 * Searches for a tailwind config from cwd up to (and including) stopDir —
 * the span between a workspace package and the monorepo root where its
 * tailwindcss dependency was declared. Bounded so an unrelated config
 * somewhere above the project can't produce a false pass.
 */
function hasTailwindConfigUpTo(cwd: string, stopDir: string): boolean {
  let dir = cwd;
  for (;;) {
    if (TAILWIND_CONFIG_FILES.some((file) => existsSync(join(dir, file)))) {
      return true;
    }
    if (dir === stopDir) {
      return false;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
}

function checkTailwind(cwd: string): CheckResult {
  const dep = findAncestorDependency(cwd, "tailwindcss");
  if (!dep) {
    return {
      id: "tailwind",
      label: "Tailwind CSS",
      message:
        "Not found in dependencies — Sora UI components are styled with Tailwind utility classes and require it.",
      status: "warn",
    };
  }

  const major = parseMajorVersion(dep.version);
  if (major !== null && major < 3) {
    return {
      id: "tailwind",
      label: "Tailwind CSS",
      message: `Version ${dep.version} detected — Sora UI components require Tailwind v3 or later.`,
      status: "warn",
    };
  }

  if (major === 3 && !hasTailwindConfigUpTo(cwd, dep.dir)) {
    return {
      id: "tailwind",
      label: "Tailwind CSS",
      message: `Version ${dep.version} detected, but no tailwind.config.{js,ts,cjs,mjs} found.`,
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
    message: `Version ${dep.version} detected.${note}`,
    status: "pass",
  };
}

function checkReact(cwd: string): CheckResult {
  const dep = findAncestorDependency(cwd, "react");
  if (!dep) {
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
    message: `Version ${dep.version} detected.`,
    status: "pass",
  };
}

function checkUtilsDeps(config: ProjectConfig): CheckResult {
  const utilsPath = utilsFilePath(config.cwd, config.srcDir);
  if (!existsSync(utilsPath)) {
    return {
      id: "utils-deps",
      label: "cn() utils dependencies",
      message: "lib/utils.ts not installed yet.",
      status: "pass",
    };
  }

  // Ancestor walk like the tailwind/react checks — in a monorepo these can
  // legitimately be declared (or hoisted) at the workspace root.
  const missing = ["clsx", "tailwind-merge"].filter(
    (dep) => !findAncestorDependency(config.cwd, dep)
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
  if (process.env.SORA_NO_UPDATE_CHECK) {
    return {
      id: "cli-version",
      label: "sora-cli version",
      message: `${currentVersion} (update check disabled via SORA_NO_UPDATE_CHECK)`,
      status: "pass",
    };
  }

  const latest = await fetchLatestVersion(UPDATE_CHECK_TIMEOUT_MS);
  if (!latest) {
    return {
      id: "cli-version",
      label: "sora-cli version",
      message: `${currentVersion} installed — couldn't reach npm to check for a newer version.`,
      status: "warn",
    };
  }

  if (isNewer(latest, currentVersion)) {
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
