import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type {
  ComponentAliases,
  PackageManager,
  ProjectConfig,
  RegistryItem,
} from "@/types.js";

export type OverwriteChoice = "overwrite" | "skip" | "all";

const CN_UTILS_CONTENT = `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

/**
 * Single source of truth for where the `cn` helper lives — doctor checks
 * the same path add installs to, so the two can't drift apart.
 */
export function utilsFilePath(cwd: string, srcDir: string): string {
  return join(cwd, srcDir, "lib", "utils.ts");
}

/**
 * shadcn's base "utils" registry dependency (the \`cn\` helper) isn't
 * fetchable from a product registry — write it directly if the target
 * project doesn't already have it.
 */
export function ensureUtils(
  cwd: string,
  srcDir: string,
  dryRun = false
): "written" | "exists" {
  const destPath = utilsFilePath(cwd, srcDir);
  if (existsSync(destPath)) {
    return "exists";
  }
  if (!dryRun) {
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, CN_UTILS_CONTENT, "utf8");
  }
  return "written";
}

interface WriteResult {
  skipped: string[];
  unchanged: string[];
  written: string[];
}

/**
 * Registry items publish targets like "components/sora-ui/texts/foo.tsx" —
 * strip whatever the leading "components/<product>/" segment is (not just
 * "sora-ui" specifically) and remap it onto the user's configured
 * componentPath, so a future product's registry doesn't need its folder
 * name hardcoded here to install correctly.
 */
const COMPONENT_PATH_PATTERN = /^components\/[^/]+\//;

/**
 * Exemption from the remap above: "components/ui/" is where shadcn base
 * components (fetched via the shadcn-registry fallback) must land, because
 * product components import them as "@/components/ui/<name>" — remapping
 * them under componentPath would break those imports.
 */
const SHADCN_UI_PREFIX = "components/ui/";

const UTILS_IMPORT = /(["'])@\/lib\/utils(["'])/g;
const HOOKS_IMPORT = /(["'])@\/hooks\//g;
const COMPONENTS_IMPORT = /(["'])@\/components\//g;
const LIB_IMPORT = /(["'])@\/lib\//g;
/**
 * shadcn base registry content is authored against its own repo layout
 * ("@/registry/<style>/lib/utils", "@/registry/<style>/ui/..."). The shadcn
 * CLI collapses that prefix on install — do the same before the per-category
 * rewrites below so those regexes see the plain "@/" convention.
 */
const SHADCN_REGISTRY_IMPORT = /(["'])@\/registry\/[^/]+\/(ui\/)?/g;

/**
 * Registry content is authored against the "@/" import convention
 * ("@/components/...", "@/hooks/...", "@/lib/...", "@/lib/utils"). Rewrite
 * each to the project's actual configured alias for that category —
 * they don't always share one root (e.g. a workspace package can point
 * "hooks" and "lib" at different places), so this must stay per-category
 * rather than one blanket prefix swap. The `cn` helper import is matched
 * first and separately since `aliases.utils` may not just be
 * `${aliases.lib}/utils`.
 */
export function rewriteAliases(
  content: string,
  aliases: ComponentAliases
): string {
  return content
    .replace(SHADCN_REGISTRY_IMPORT, (_match, quote: string, ui?: string) =>
      ui ? `${quote}@/components/ui/` : `${quote}@/`
    )
    .replace(UTILS_IMPORT, `$1${aliases.utils}$2`)
    .replace(HOOKS_IMPORT, `$1${aliases.hooks}/`)
    .replace(COMPONENTS_IMPORT, `$1${aliases.components}/`)
    .replace(LIB_IMPORT, `$1${aliases.lib}/`);
}

const CRLF = /\r\n/g;

/**
 * A file re-saved by a Windows editor/git config can pick up CRLF line
 * endings even though its actual content is unchanged — normalize before
 * comparing so that doesn't look like a real diff.
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(CRLF, "\n");
}

/**
 * A file's `target` comes from the registry (remote, untrusted input) and
 * gets joined onto the project root — reject anything that would resolve
 * outside it (e.g. a malicious "../../../.bashrc") before it's ever used
 * for an existsSync/read/write.
 */
export function assertSafeDestination(destPath: string, cwd: string): void {
  const resolvedCwd = resolve(cwd);
  const resolvedDest = resolve(destPath);
  if (
    resolvedDest !== resolvedCwd &&
    !resolvedDest.startsWith(resolvedCwd + sep)
  ) {
    throw new Error(
      `Registry returned a file path outside the project: "${destPath}"`
    );
  }
}

export function resolveTarget(
  file: RegistryItem["files"][number],
  item: RegistryItem,
  config: ProjectConfig
): string {
  if (!file.target) {
    return `${config.componentPath}/${item.name}.tsx`;
  }
  const match = file.target.match(COMPONENT_PATH_PATTERN);
  if (match && !file.target.startsWith(SHADCN_UI_PREFIX)) {
    return `${config.componentPath}/${file.target.slice(match[0].length)}`;
  }
  if (config.srcDir) {
    return `${config.srcDir}/${file.target}`;
  }
  return file.target;
}

type FileWriteStatus = "skipped" | "unchanged" | "written";

async function writeSingleFile(
  content: string,
  relativeTarget: string,
  destPath: string,
  aliases: ComponentAliases,
  overwrite: boolean,
  onConflict: (filename: string) => Promise<OverwriteChoice>,
  dryRun: boolean
): Promise<{ overwriteAll: boolean; status: FileWriteStatus }> {
  const newContent = rewriteAliases(content, aliases);
  const fileExists = existsSync(destPath);

  if (fileExists) {
    const currentContent = readFileSync(destPath, "utf8");
    if (
      normalizeLineEndings(currentContent) === normalizeLineEndings(newContent)
    ) {
      // Already up to date — don't prompt about it, but still report it
      // so a re-run doesn't look like it silently did nothing.
      return { overwriteAll: overwrite, status: "unchanged" };
    }
  }

  let overwriteAll = overwrite;
  // Dry runs never prompt or touch disk — a conflict just gets reported.
  if (fileExists && !overwrite && !dryRun) {
    const choice = await onConflict(relativeTarget);
    if (choice === "skip") {
      return { overwriteAll, status: "skipped" };
    }
    if (choice === "all") {
      overwriteAll = true;
    }
  }

  if (!dryRun) {
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, newContent, "utf8");
  }
  return { overwriteAll, status: "written" };
}

export async function writeComponent(
  item: RegistryItem,
  config: ProjectConfig,
  overwriteAll: boolean,
  onConflict: (filename: string) => Promise<OverwriteChoice>,
  dryRun = false
): Promise<WriteResult> {
  const written: string[] = [];
  const skipped: string[] = [];
  const unchanged: string[] = [];
  let overwrite = overwriteAll;
  const { cwd } = config;

  // Validate every target before writing any of them, so one unsafe file
  // in a multi-file component can't leave partial writes behind.
  for (const file of item.files) {
    if (!file.content) {
      continue;
    }
    assertSafeDestination(join(cwd, resolveTarget(file, item, config)), cwd);
  }

  const results: Record<FileWriteStatus, string[]> = {
    skipped,
    unchanged,
    written,
  };

  // Sequential by design: each conflict prompt depends on the previous
  // choice ("overwrite all" must apply to every file after it).
  for (const file of item.files) {
    if (!file.content) {
      continue;
    }

    const relativeTarget = resolveTarget(file, item, config);
    const destPath = join(cwd, relativeTarget);

    // biome-ignore lint/performance/noAwaitInLoops: prompts must run one at a time, not in parallel
    const result = await writeSingleFile(
      file.content,
      relativeTarget,
      destPath,
      config.aliases,
      overwrite,
      onConflict,
      dryRun
    );
    overwrite = result.overwriteAll;
    results[result.status].push(relativeTarget);
  }

  return { skipped, unchanged, written };
}

const INSTALL_ARGS: Record<PackageManager, { add: string; dev: string }> = {
  bun: { add: "add", dev: "-d" },
  npm: { add: "install", dev: "-D" },
  pnpm: { add: "add", dev: "-D" },
  yarn: { add: "add", dev: "-D" },
};

/**
 * Dependency names come from the registry (remote, untrusted input) and
 * get passed straight into `spawnSync(packageManager, [add, ...deps])` —
 * reject anything that could be interpreted as a flag by the package
 * manager instead of a package name (e.g. a malicious "-–registry=…").
 */
const UNSAFE_DEPENDENCY_CHARS = /[^a-zA-Z0-9@/._-]/;

export function assertSafeDependencies(deps: string[]): void {
  for (const dep of deps) {
    if (dep.startsWith("-")) {
      throw new Error(`Registry returned an unsafe dependency name: "${dep}"`);
    }
    if (
      dep.length === 0 ||
      dep.length > 214 ||
      UNSAFE_DEPENDENCY_CHARS.test(dep)
    ) {
      throw new Error(`Registry returned an invalid dependency name: "${dep}"`);
    }
  }
}

export interface InstallResult {
  ok: boolean;
  stderr?: string;
}

const TRAILING_CR = /\r$/;

/**
 * Buffers raw stdout/stderr chunks and forwards complete lines to `onLine`,
 * holding back a trailing partial line until the next chunk completes it —
 * a package manager doesn't align its writes to line boundaries.
 */
function createLineSplitter(onLine: (line: string) => void) {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.replace(TRAILING_CR, "");
      if (line.length > 0) {
        onLine(line);
      }
    }
  };
}

function runInstall(
  packageManager: PackageManager,
  args: string[],
  cwd: string,
  onOutput?: (line: string) => void
): Promise<InstallResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(packageManager, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    if (onOutput) {
      child.stdout?.on("data", createLineSplitter(onOutput));
      child.stderr?.on("data", createLineSplitter(onOutput));
    }

    child.on("error", (err) => {
      resolvePromise({ ok: false, stderr: err.message });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolvePromise({ ok: false, stderr: stderr.trim() || undefined });
        return;
      }
      resolvePromise({ ok: true });
    });
  });
}

export async function installDependencies(
  dependencies: string[],
  devDependencies: string[],
  packageManager: PackageManager,
  cwd: string,
  onOutput?: (line: string) => void
): Promise<InstallResult> {
  assertSafeDependencies([...dependencies, ...devDependencies]);

  const { add, dev } = INSTALL_ARGS[packageManager];

  if (dependencies.length > 0) {
    const result = await runInstall(
      packageManager,
      [add, ...dependencies],
      cwd,
      onOutput
    );
    if (!result.ok) {
      return result;
    }
  }

  if (devDependencies.length > 0) {
    const result = await runInstall(
      packageManager,
      [add, dev, ...devDependencies],
      cwd,
      onOutput
    );
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}
