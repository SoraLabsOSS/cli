import { outro, spinner } from "@clack/prompts";
import type { RegistryItem } from "@/types.js";
import { error } from "@/utils/colors.js";
import { detectConfig } from "@/utils/detect.js";
import { diffComponentFiles, printFileDiff } from "@/utils/diff.js";
import { flattenTree, resolveTree } from "@/utils/tree.js";

interface DiffOptions {
  cwd?: string;
  path?: string;
  registry?: string;
}

async function resolveComponentsForDiff(
  names: string[],
  registry: string | undefined
): Promise<RegistryItem[] | null> {
  const loadingSpinner = spinner();
  loadingSpinner.start("Resolving dependencies...");

  const allComponents: RegistryItem[] = [];
  const fetchSeen = new Set<string>();
  const collected = new Set<string>();

  for (const name of names) {
    if (fetchSeen.has(name)) {
      continue;
    }

    try {
      loadingSpinner.message(`Resolving ${name}...`);
      // biome-ignore lint/performance/noAwaitInLoops: sequential — fetchSeen must update between fetches
      const tree = await resolveTree(name, registry, fetchSeen);
      for (const item of flattenTree(tree)) {
        if (!collected.has(item.name)) {
          collected.add(item.name);
          allComponents.push(item);
        }
      }
    } catch (err) {
      loadingSpinner.stop(`Failed to resolve ${name}`, 1);
      error((err as Error).message);
      return null;
    }
  }

  loadingSpinner.stop("Resolved dependencies");
  return allComponents;
}

/**
 * Read-only comparison of installed component files against the current
 * registry content — reports drift without writing anything. Re-running
 * `add <component> --force --yes` is how you actually apply an update.
 */
export async function diff(
  componentNames: string[],
  options: DiffOptions
): Promise<boolean> {
  if (componentNames.length === 0) {
    error(
      'Specify at least one component. Run "sora list" to see available components.'
    );
    return false;
  }

  const cwd = options.cwd ?? process.cwd();
  const config = detectConfig(cwd);
  if (options.path) {
    config.componentPath = options.path;
  }

  const allComponents = await resolveComponentsForDiff(
    componentNames,
    options.registry
  );
  if (!allComponents) {
    return false;
  }

  console.log();

  let changedCount = 0;
  let notInstalledCount = 0;

  for (const item of allComponents) {
    for (const result of diffComponentFiles(item, config)) {
      if (result.status === "changed") {
        changedCount += 1;
        printFileDiff(result);
      } else if (result.status === "not-installed") {
        notInstalledCount += 1;
      }
    }
  }

  if (changedCount === 0) {
    const suffix =
      notInstalledCount > 0
        ? ' (some files aren\'t installed yet — run "sora add" to install them)'
        : "";
    outro(`Up to date.${suffix}`);
    return true;
  }

  outro(
    `${changedCount} file${changedCount > 1 ? "s" : ""} differ. Run "sora add <component> --force --yes" to update.`
  );
  return true;
}
