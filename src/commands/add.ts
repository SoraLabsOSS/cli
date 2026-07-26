import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  confirm,
  isCancel,
  note,
  outro,
  select,
  taskLog,
} from "@clack/prompts";
import { searchMultiselect } from "@/prompts/search-multiselect.js";
import type { PackageManager, ProjectConfig, RegistryItem } from "@/types.js";
import {
  bar,
  done,
  error,
  fileHeader,
  sanitize,
  warn,
} from "@/utils/colors.js";
import {
  detectConfig,
  getInstalledDependencyNames,
  isAstroProject,
} from "@/utils/detect.js";
import {
  assertSafeDependencies,
  ensureUtils,
  installDependencies,
  resolveTarget,
  rewriteAliases,
  writeComponent,
} from "@/utils/install.js";
import { getMonorepoTargets, isMonorepoRoot } from "@/utils/monorepo.js";
import {
  getAvailableComponents,
  resolveRegistryUrl,
} from "@/utils/registry.js";
import { spinner } from "@/utils/spinner.js";
import {
  collectNpmDeps,
  flattenTree,
  printTree,
  resolveTree,
} from "@/utils/tree.js";

interface AddOptions {
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  path?: string;
  registry?: string;
  silent?: boolean;
  view?: boolean;
  yes?: boolean;
}

async function pickComponents(registry?: string): Promise<string[] | null> {
  const loadingSpinner = spinner();
  loadingSpinner.start("Fetching available components...");
  let availableComponents: string[];
  try {
    availableComponents = await getAvailableComponents(registry);
  } catch (err) {
    loadingSpinner.error("Failed to fetch available components");
    throw err;
  }
  loadingSpinner.stop("Fetched available components");

  const items = availableComponents.map((name) => ({
    category: "Components",
    label: name,
    value: name,
  }));

  const selected = await searchMultiselect({
    items,
    message: "Select components to install:",
  });

  if (!selected || selected.length === 0) {
    console.log();
    done("No components selected.");
    return null;
  }

  done(`Selected: ${selected.map(sanitize).join(", ")}`);
  console.log();
  return selected;
}

async function resolveComponents(
  names: string[],
  registry: string | undefined,
  silent: boolean
): Promise<RegistryItem[] | null> {
  const loadingSpinner = spinner();
  loadingSpinner.start("Resolving dependencies...");

  const allComponents: RegistryItem[] = [];
  // Shared across every resolveTree call below, so a dependency already
  // resolved for an earlier requested component isn't fetched (or printed)
  // again — separate from `collected`, which tracks what's already in
  // allComponents, since resolveTree marks an item "seen" the moment it
  // starts resolving it, before we get a chance to collect it here.
  const fetchSeen = new Set<string>();
  const collected = new Set<string>();
  const trees: Parameters<typeof printTree>[0][] = [];

  for (const name of names) {
    if (fetchSeen.has(name)) {
      continue;
    }

    try {
      loadingSpinner.message(`Resolving ${name}...`);
      // biome-ignore lint/performance/noAwaitInLoops: sequential — fetchSeen must update between fetches
      const tree = await resolveTree(name, registry, fetchSeen);
      const flat = flattenTree(tree);

      for (const item of flat) {
        if (!collected.has(item.name)) {
          collected.add(item.name);
          allComponents.push(item);
        }
      }

      trees.push(tree);
    } catch (err) {
      loadingSpinner.error(`Failed to resolve ${name}`);
      error(sanitize((err as Error).message));
      return null;
    }
  }

  loadingSpinner.stop("Resolved dependencies");
  if (!silent) {
    bar();
    for (const tree of trees) {
      printTree(tree);
    }
    bar();
  }
  return allComponents;
}

/**
 * Prints each resolved component's file content (already alias-rewritten,
 * so it's what would actually land in the project) instead of writing
 * anything — lets a user inspect a component before deciding to install it.
 */
function printComponentFiles(
  allComponents: RegistryItem[],
  config: ProjectConfig
): void {
  for (const item of allComponents) {
    for (const file of item.files) {
      if (!file.content) {
        continue;
      }
      fileHeader(sanitize(resolveTarget(file, item, config)));
      console.log(sanitize(rewriteAliases(file.content, config.aliases)));
      console.log();
    }
  }
}

interface ConfirmedInstall {
  dependencies: string[];
  devDependencies: string[];
  needsUtils: boolean;
}

async function collectDepsAndConfirm(
  allComponents: RegistryItem[],
  skipConfirm: boolean,
  registryUrl: string,
  cwd: string
): Promise<ConfirmedInstall | null> {
  const needsUtils = allComponents.some((item) =>
    item.registryDependencies?.includes("utils")
  );

  const collected = collectNpmDeps(allComponents);
  if (needsUtils) {
    for (const dep of ["clsx", "tailwind-merge"]) {
      if (!collected.dependencies.includes(dep)) {
        collected.dependencies.push(dep);
      }
    }
  }
  assertSafeDependencies([
    ...collected.dependencies,
    ...collected.devDependencies,
  ]);

  const alreadyInstalled = getInstalledDependencyNames(cwd);
  const dependencies = collected.dependencies.filter(
    (dep) => !alreadyInstalled.has(dep)
  );
  const devDependencies = collected.devDependencies.filter(
    (dep) => !alreadyInstalled.has(dep)
  );

  if (!skipConfirm) {
    if (!process.stdin.isTTY) {
      throw new Error(
        "Confirmation required but no TTY available. Pass --yes to skip the confirmation prompt (for scripts/CI)."
      );
    }
    const confirmed = await confirm({
      message: buildConfirmMessage(
        allComponents.length,
        dependencies.length + devDependencies.length,
        registryUrl
      ),
    });

    if (isCancel(confirmed) || !confirmed) {
      done("Installation cancelled.");
      return null;
    }
  }

  return { dependencies, devDependencies, needsUtils };
}

function buildConfirmMessage(
  totalComponents: number,
  totalDeps: number,
  registryUrl: string
): string {
  const componentLabel = `${totalComponents} component${totalComponents > 1 ? "s" : ""}`;
  const suffix =
    totalDeps > 0
      ? ` + ${totalDeps} npm package${totalDeps > 1 ? "s" : ""}`
      : "";
  return `Install ${componentLabel}${suffix} from ${registryUrl}?`;
}

async function writeComponents(
  allComponents: RegistryItem[],
  config: ProjectConfig,
  force: boolean,
  dryRun: boolean,
  silent: boolean
): Promise<void> {
  let overwriteAll = force;
  const writtenLabel = dryRun ? "Would write" : "Written";

  // Sequential by design: writeComponent's own conflict prompts depend
  // on `overwriteAll`, which a prior file's "overwrite all" choice can flip.
  for (const item of allComponents) {
    // biome-ignore lint/performance/noAwaitInLoops: see comment above
    const { written, skipped, unchanged } = await writeComponent(
      item,
      config,
      overwriteAll,
      async (filename) => {
        if (!process.stdin.isTTY) {
          warn(
            `File exists and no TTY available to prompt: ${sanitize(filename)}. Skipping — run with --force to overwrite.`
          );
          return "skip";
        }
        const action = await select({
          message: `File exists: ${sanitize(filename)}`,
          options: [
            { label: "Overwrite", value: "overwrite" },
            { label: "Skip", value: "skip" },
            { label: "Overwrite all", value: "all" },
          ],
        });

        if (isCancel(action)) {
          return "skip";
        }
        if (action === "all") {
          overwriteAll = true;
        }
        return action as "overwrite" | "skip" | "all";
      },
      dryRun
    );

    if (silent) {
      continue;
    }
    for (const file of written) {
      done(`${writtenLabel}: ${sanitize(file)}`);
    }
    for (const file of skipped) {
      done(`Skipped: ${sanitize(file)}`);
    }
    for (const file of unchanged) {
      bar(`Unchanged: ${sanitize(file)}`);
    }
  }
}

function buildManualInstallCommands(
  dependencies: string[],
  devDependencies: string[],
  packageManager: PackageManager
): string[] {
  const commands: string[] = [];
  if (dependencies.length > 0) {
    commands.push(`${packageManager} add ${dependencies.join(" ")}`);
  }
  if (devDependencies.length > 0) {
    const devFlag = packageManager === "bun" ? "-d" : "-D";
    commands.push(
      `${packageManager} add ${devFlag} ${devDependencies.join(" ")}`
    );
  }
  return commands;
}

async function installNpmDependencies(
  dependencies: string[],
  devDependencies: string[],
  packageManager: PackageManager,
  dryRun: boolean,
  cwd: string
): Promise<void> {
  if (dependencies.length === 0 && devDependencies.length === 0) {
    return;
  }

  if (dryRun) {
    note(
      buildManualInstallCommands(
        dependencies,
        devDependencies,
        packageManager
      ).join("\n"),
      "Would install"
    );
    return;
  }

  const allDeps = [...dependencies, ...devDependencies];
  const log = taskLog({ title: `Installing ${allDeps.join(", ")}` });

  const result = await installDependencies(
    dependencies,
    devDependencies,
    packageManager,
    cwd,
    (line) => log.message(line)
  );

  if (result.ok) {
    log.success(`Installed: ${allDeps.join(", ")}`);
    return;
  }

  log.error("Failed to install dependencies", { showLog: true });
  if (result.stderr) {
    note(result.stderr, "Error");
  }
  note(
    buildManualInstallCommands(
      dependencies,
      devDependencies,
      packageManager
    ).join("\n"),
    "Run manually"
  );
}

async function performInstall(
  allComponents: RegistryItem[],
  config: ProjectConfig,
  install: ConfirmedInstall,
  options: AddOptions
): Promise<void> {
  const dryRun = options.dryRun ?? false;
  const silent = options.silent ?? false;
  const { dependencies, devDependencies, needsUtils } = install;

  if (needsUtils) {
    const result = ensureUtils(config.cwd, config.srcDir, dryRun);
    if (result === "written" && !silent) {
      const label = dryRun ? "Would write" : "Written";
      done(`${label}: ${config.srcDir ? `${config.srcDir}/` : ""}lib/utils.ts`);
    }
  }

  await writeComponents(
    allComponents,
    config,
    options.force ?? false,
    dryRun,
    silent
  );
  await installNpmDependencies(
    dependencies,
    devDependencies,
    config.packageManager,
    dryRun,
    config.cwd
  );

  const totalComponents = allComponents.length;
  const verb = dryRun ? "Would install" : "Done! Installed";
  outro(
    `${verb} ${totalComponents} component${totalComponents > 1 ? "s" : ""}.`
  );
}

/**
 * Refuses to install into a directory with no `package.json` — mirrors
 * shadcn's own "empty project" preflight check. Without this, `sora add`
 * would happily write component files into any random folder, since
 * `detectConfig` has no other signal that requires a real JS/TS project to
 * be there.
 */
function guardEmptyProject(cwd: string): boolean {
  if (existsSync(join(cwd, "package.json"))) {
    return true;
  }

  error(
    `No "package.json" found at ${sanitize(cwd)} — this doesn't look like a project.`
  );
  warn(
    'Run "npm init" (or your package manager\'s equivalent) first, or pass --cwd to point at an existing project.'
  );
  return false;
}

/**
 * Refuses to install straight into a monorepo root (pnpm/yarn/npm
 * workspaces, Lerna, Nx). Installing there writes components into a
 * directory with no framework of its own, using whichever workspace
 * package's tsconfig alias happens to be found first — silently wrong for
 * every workspace but one. A `components.json` at `cwd` is an explicit
 * opt-in (matches shadcn's own CLI) and bypasses this check.
 */
function guardMonorepoRoot(cwd: string, componentNames: string[]): boolean {
  if (existsSync(join(cwd, "components.json")) || !isMonorepoRoot(cwd)) {
    return true;
  }

  error(
    "This looks like a monorepo root — installing here could write files into the wrong workspace."
  );
  const targets = getMonorepoTargets(cwd);
  const exampleArgs =
    componentNames.length > 0 ? componentNames.join(" ") : "<component>";
  if (targets.length > 0) {
    warn("Re-run with --cwd pointing at a workspace, e.g.:");
    for (const target of targets) {
      bar(`  sora add ${exampleArgs} --cwd ${sanitize(target.name)}`);
    }
  } else {
    warn(
      "Re-run with --cwd pointing at the workspace you want to install into, or add a components.json file here to opt in explicitly."
    );
  }
  return false;
}

/**
 * Combines the "empty project" and "monorepo root" preflight checks (see
 * shadcn's own `preFlightAdd`). Empty-project is checked first since a
 * missing `package.json` makes the monorepo check meaningless anyway.
 */
function guardProject(cwd: string, componentNames: string[]): boolean {
  return guardEmptyProject(cwd) && guardMonorepoRoot(cwd, componentNames);
}

/**
 * Resolves the registry URL and prints the "Detected: .../ Registry: ..."
 * header lines plus any setup warnings (Astro alias, dry run). Returns null
 * if the registry couldn't be resolved (error already printed).
 */
function announceSetup(
  config: ProjectConfig,
  options: AddOptions
): string | null {
  let registryUrl: string;
  try {
    registryUrl = resolveRegistryUrl(options.registry);
  } catch (err) {
    error(sanitize((err as Error).message));
    return null;
  }

  done(`Detected: ${config.componentPath}/ (${config.packageManager})`);
  done(`Registry: ${registryUrl}`);
  if (!config.tsconfigPathsConfigured && isAstroProject(config.cwd)) {
    warn(
      `No "${config.aliases.components.split("/")[0]}/*" path alias found in tsconfig.json/jsconfig.json — Astro's Vite bundler won't resolve it on its own. Add a matching "compilerOptions.paths" entry plus a Vite alias (or install vite-tsconfig-paths) before installing, or the written imports won't resolve.`
    );
  }
  if (options.dryRun) {
    done("Dry run: no files will be written, no packages will be installed.");
  }
  console.log();

  return registryUrl;
}

/**
 * Returns whether the command succeeded. "No components selected" and
 * "installation cancelled" are graceful no-ops (exit 0); a resolution
 * failure (unknown component, unknown registry, network error) is a
 * real failure the caller should exit non-zero for.
 */
export async function add(
  componentNames: string[],
  options: AddOptions
): Promise<boolean> {
  const cwd = options.cwd ?? process.cwd();
  if (!guardProject(cwd, componentNames)) {
    return false;
  }
  const config = detectConfig(cwd);
  if (options.path) {
    config.componentPath = options.path;
  }

  const registryUrl = announceSetup(config, options);
  if (!registryUrl) {
    return false;
  }

  let selectedComponents = componentNames;
  if (selectedComponents.length === 0) {
    if (!process.stdin.isTTY) {
      error(
        'No components specified and no TTY available for interactive selection. Run with component names, e.g. "sora add <component>".'
      );
      return false;
    }
    const picked = await pickComponents(options.registry);
    if (!picked) {
      return true;
    }
    selectedComponents = picked;
  }

  const allComponents = await resolveComponents(
    selectedComponents,
    options.registry,
    options.silent ?? false
  );
  if (!allComponents) {
    return false;
  }

  if (options.view) {
    printComponentFiles(allComponents, config);
    const count = allComponents.length;
    outro(`Viewed ${count} component${count > 1 ? "s" : ""}.`);
    return true;
  }

  const confirmResult = await collectDepsAndConfirm(
    allComponents,
    (options.yes ?? false) || (options.dryRun ?? false),
    registryUrl,
    cwd
  );
  if (!confirmResult) {
    return true;
  }

  console.log();
  await performInstall(allComponents, config, confirmResult, options);
  return true;
}
