import type { RegistryItem } from "@/types.js";
import { bar, done, error, highlight, sanitize } from "@/utils/colors.js";
import { fetchComponent } from "@/utils/registry.js";
import { spinner } from "@/utils/spinner.js";

export interface InfoOptions {
  component?: string;
  json?: boolean;
  registry?: string;
}

/**
 * Displays detailed component metadata, dependencies, and file layout before installation.
 */
export async function info(options: InfoOptions): Promise<boolean> {
  const componentName = options.component?.trim();
  if (!componentName) {
    error('Please specify a component name, e.g. "sora info text-effect".');
    return false;
  }

  const loadingSpinner = options.json ? null : spinner();
  loadingSpinner?.start(`Fetching information for "${componentName}"...`);

  let item: RegistryItem;
  try {
    item = await fetchComponent(componentName, options.registry);
  } catch (err) {
    loadingSpinner?.error(`Failed to fetch component "${componentName}"`);
    throw err;
  }
  loadingSpinner?.stop(`Fetched information for "${componentName}"`);

  if (options.json) {
    console.log(JSON.stringify(item, null, 2));
    return true;
  }

  done(`Component: ${highlight(sanitize(item.name))}`);
  bar(`Type:          ${sanitize(item.type)}`);
  if (item.title) {
    bar(`Title:         ${sanitize(item.title)}`);
  }
  if (item.description) {
    bar(`Description:   ${sanitize(item.description)}`);
  }

  const deps = item.dependencies?.length
    ? item.dependencies.join(", ")
    : "(none)";
  bar(`Dependencies:  ${sanitize(deps)}`);

  if (item.devDependencies && item.devDependencies.length > 0) {
    bar(`Dev deps:      ${sanitize(item.devDependencies.join(", "))}`);
  }

  if (item.registryDependencies && item.registryDependencies.length > 0) {
    bar(`Registry deps: ${sanitize(item.registryDependencies.join(", "))}`);
  }

  if (item.files && item.files.length > 0) {
    const fileList = item.files
      .map((f) => sanitize(f.target ?? f.path))
      .join(", ");
    bar(`Files:         ${fileList}`);
  }

  if (item.cssVars && Object.keys(item.cssVars).length > 0) {
    const scopes = Object.keys(item.cssVars).join(", ");
    bar(`CSS Scopes:    ${sanitize(scopes)}`);
  }

  bar();
  bar(`Install with:  npx @soralabs/cli add ${sanitize(item.name)}`);

  return true;
}
