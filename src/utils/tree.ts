import type { RegistryItem } from "@/types.js";
import { bar, dim, highlight, sanitize } from "@/utils/colors.js";
import {
  ComponentNotFoundError,
  fetchComponent,
  fetchShadcnComponent,
} from "@/utils/registry.js";

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

/**
 * registryDependencies on soralabs items are shadcn-style namespaced refs
 * ("@soralabs/accordion"), but this CLI only ever talks to one registry at
 * a time and that registry's own /r/<name>.json endpoints use flat names.
 */
function stripNamespace(name: string): string {
  return name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
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

export async function resolveTree(
  name: string,
  registry?: string,
  seen: Set<string> = new Set(),
  shadcnStyle?: string,
  fromShadcn = false
): Promise<ResolvedNode> {
  const bareName = stripNamespace(name);
  const { item, shadcn } = await fetchTreeItem(
    name,
    bareName,
    registry,
    shadcnStyle,
    fromShadcn
  );
  seen.add(bareName);

  const children: ResolvedNode[] = [];
  // Sequential by design: `seen` must be updated between fetches so
  // shared dependencies aren't resolved (and fetched) more than once.
  for (const rawDep of item.registryDependencies ?? []) {
    const dep = stripNamespace(rawDep);
    if (seen.has(dep) || BASE_DEPENDENCIES.has(dep)) {
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
      shadcn
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
