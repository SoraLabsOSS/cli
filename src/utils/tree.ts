import type { ProjectConfig, RegistryItem } from "@/types.js";
import { addressKey, parseComponentAddress } from "@/utils/address.js";
import { bar, dim, error, highlight, sanitize } from "@/utils/colors.js";
import {
  ComponentNotFoundError,
  fetchComponent,
  fetchComponentByAddress,
  fetchShadcnComponent,
} from "@/utils/registry.js";
import { spinner } from "@/utils/spinner.js";

export interface ResolvedNode {
  children: ResolvedNode[];
  item: RegistryItem;
}

/**
 * shadcn's own base registry defines a handful of well-known dependency
 * names ("utils" being the main one, for the `cn` helper) that are never
 * published as fetchable items on a product's own registry — the shadcn
 * CLI ships them from its own base templates instead. Skip resolving
 * these; `ensureUtils` in commands/add.ts covers the "utils" case.
 */
const BASE_DEPENDENCIES = new Set(["utils"]);
const LEADING_AT = /^@/;

/**
 * registryDependencies on soralabs items are shadcn-style namespaced refs
 * ("@soralabs/accordion"), but this CLI only ever talks to one registry at
 * a time and that registry's own /r/<name>.json endpoints use flat names.
 */
function stripNamespace(name: string): string {
  return name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
}

async function fetchNamespaceTreeItem(
  _rawName: string,
  bareName: string,
  namespace: string,
  item: string,
  registry: string | undefined,
  shadcnStyle: string | undefined,
  config?: ProjectConfig
): Promise<{ item: RegistryItem; shadcn: boolean }> {
  if (namespace === "@shadcn") {
    return {
      item: await fetchShadcnComponent(item, shadcnStyle),
      shadcn: true,
    };
  }
  const bareScope = namespace.replace(LEADING_AT, "");
  if (config?.registries?.[namespace] || config?.registries?.[bareScope]) {
    const address = { item, namespace, scheme: "namespace" as const };
    const res = await fetchComponentByAddress(address, config, registry);
    return { item: res.item, shadcn: res.fromShadcn };
  }
  return { item: await fetchComponent(bareName, registry), shadcn: false };
}

async function fetchBareTreeItem(
  rawName: string,
  bareName: string,
  registry: string | undefined,
  shadcnStyle: string | undefined,
  fromShadcn: boolean
): Promise<{ item: RegistryItem; shadcn: boolean }> {
  if (fromShadcn) {
    return {
      item: await fetchShadcnComponent(bareName, shadcnStyle),
      shadcn: true,
    };
  }
  try {
    return { item: await fetchComponent(bareName, registry), shadcn: false };
  } catch (err) {
    if (!(err instanceof ComponentNotFoundError) || rawName.includes("/")) {
      throw err;
    }
    try {
      return {
        item: await fetchShadcnComponent(bareName, shadcnStyle),
        shadcn: true,
      };
    } catch (shadcnErr) {
      throw shadcnErr instanceof ComponentNotFoundError ? err : shadcnErr;
    }
  }
}

/**
 * Fetches a tree node's item, falling back to shadcn's base registry for
 * bare (non-namespaced) refs the product registry doesn't serve — shadcn
 * convention says a bare registryDependency like "button" is a shadcn/ui
 * base component, and product items legitimately depend on those. Only a
 * 404 triggers the fallback; network/server errors surface as-is. If shadcn
 * doesn't have it either, the original product-registry error is thrown
 * since its "sora list" hint is the more useful one.
 */
async function fetchTreeItem(
  rawName: string,
  bareName: string,
  registry: string | undefined,
  shadcnStyle: string | undefined,
  fromShadcn: boolean,
  config?: ProjectConfig
): Promise<{ item: RegistryItem; shadcn: boolean }> {
  const address = parseComponentAddress(rawName);

  if (
    address.scheme === "url" ||
    address.scheme === "file" ||
    address.scheme === "github"
  ) {
    const res = await fetchComponentByAddress(address, config, registry);
    return { item: res.item, shadcn: res.fromShadcn };
  }

  if (address.scheme === "namespace") {
    return await fetchNamespaceTreeItem(
      rawName,
      bareName,
      address.namespace,
      address.item,
      registry,
      shadcnStyle,
      config
    );
  }

  return await fetchBareTreeItem(
    rawName,
    bareName,
    registry,
    shadcnStyle,
    fromShadcn
  );
}

export async function resolveTree(
  name: string,
  registry?: string,
  seen: Set<string> = new Set(),
  shadcnStyle?: string,
  fromShadcn = false,
  config?: ProjectConfig
): Promise<ResolvedNode> {
  const address = parseComponentAddress(name);
  const bareName = stripNamespace(name);
  const key = addressKey(address);
  const { item, shadcn } = await fetchTreeItem(
    name,
    bareName,
    registry,
    shadcnStyle,
    fromShadcn,
    config
  );
  seen.add(bareName);
  seen.add(key);
  seen.add(item.name);

  const children: ResolvedNode[] = [];
  // Sequential by design: `seen` must be updated between fetches so
  // shared dependencies aren't resolved (and fetched) more than once.
  for (const rawDep of item.registryDependencies ?? []) {
    const depAddress = parseComponentAddress(rawDep);
    const depBare = stripNamespace(rawDep);
    const depKey = addressKey(depAddress);
    if (
      seen.has(depBare) ||
      seen.has(depKey) ||
      seen.has(rawDep) ||
      BASE_DEPENDENCIES.has(depBare)
    ) {
      continue;
    }
    // A shadcn item's own dependencies are shadcn items too — resolve
    // them from the shadcn registry directly instead of 404-probing the
    // product registry first.
    // biome-ignore lint/performance/noAwaitInLoops: must stay sequential, see comment above
    const child = await resolveTree(
      rawDep,
      registry,
      seen,
      shadcnStyle,
      shadcn,
      config
    );
    children.push(child);
  }

  return { children, item };
}

export function flattenTree(node: ResolvedNode): RegistryItem[] {
  const result: RegistryItem[] = [];
  for (const child of node.children) {
    result.push(...flattenTree(child));
  }
  result.push(node.item);
  return result;
}

export function printTree(node: ResolvedNode, depth = 0): void {
  const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}└─ `;
  // Only the top-level requested component's description is shown — nested
  // dependency entries (hooks/lib) rarely have a meaningful one and it
  // would just clutter a multi-dependency tree.
  const description =
    depth === 0 && node.item.description
      ? ` ${dim(`— ${sanitize(node.item.description)}`)}`
      : "";
  bar(`${prefix}${highlight(sanitize(node.item.name))}${description}`);
  for (const child of node.children) {
    printTree(child, depth + 1);
  }
}

export function collectNpmDeps(items: RegistryItem[]): {
  dependencies: string[];
  devDependencies: string[];
} {
  const dependencies = new Set<string>();
  const devDependencies = new Set<string>();

  for (const item of items) {
    for (const dep of item.dependencies ?? []) {
      dependencies.add(dep);
    }
    for (const dep of item.devDependencies ?? []) {
      devDependencies.add(dep);
    }
  }

  return {
    dependencies: [...dependencies],
    devDependencies: [...devDependencies],
  };
}

export async function resolveComponentList(
  names: string[],
  registry?: string,
  shadcnStyle?: string,
  onTree?: (tree: ResolvedNode) => void,
  config?: ProjectConfig
): Promise<RegistryItem[] | null> {
  const loadingSpinner = spinner();
  loadingSpinner.start("Resolving dependencies...");

  const allComponents: RegistryItem[] = [];
  const fetchSeen = new Set<string>();
  const collected = new Set<string>();

  for (const name of names) {
    const address = parseComponentAddress(name);
    const key = addressKey(address);
    if (fetchSeen.has(name) || fetchSeen.has(key)) {
      continue;
    }

    try {
      loadingSpinner.message(`Resolving ${name}...`);
      // biome-ignore lint/performance/noAwaitInLoops: sequential — fetchSeen must update between fetches
      const tree = await resolveTree(
        name,
        registry,
        fetchSeen,
        shadcnStyle,
        false,
        config
      );
      for (const item of flattenTree(tree)) {
        if (!collected.has(item.name)) {
          collected.add(item.name);
          allComponents.push(item);
        }
      }
      onTree?.(tree);
    } catch (err) {
      loadingSpinner.error(`Failed to resolve ${name}`);
      error(sanitize((err as Error).message));
      return null;
    }
  }

  loadingSpinner.stop("Resolved dependencies");
  return allComponents;
}
