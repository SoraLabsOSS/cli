import { outro } from "@clack/prompts";
import { error } from "@/utils/colors.js";
import { detectConfig } from "@/utils/detect.js";
import { diffComponentFiles, printFileDiff } from "@/utils/diff.js";
import { resolveComponentList } from "@/utils/tree.js";

interface DiffOptions {
  cwd?: string;
  path?: string;
  registry?: string;
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

  const allComponents = await resolveComponentList(
    componentNames,
    options.registry,
    config.shadcnStyle
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
