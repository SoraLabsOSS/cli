/**
 * Registered Sora Labs product registries. Each product exposes a
 * shadcn-compatible registry at `<url>/r/registry.json` and
 * `<url>/r/<name>.json`, built via `registry:build` in that product's repo.
 *
 * Add new products (sora-studio, sora-lattice, ...) here as they ship —
 * the CLI logic itself never needs to change.
 */
export const REGISTRIES: Record<string, string> = {
  ui: "https://ui.soralabs.io.vn",
};

export const DEFAULT_REGISTRY = "ui";

export const DEFAULT_COMPONENT_PATH = "components/sora-ui";

/**
 * shadcn's own base registry, per style. Bare (non-namespaced)
 * registryDependencies like "button" refer to shadcn/ui base components by
 * convention — when a product registry doesn't serve them itself, they're
 * fetched from here, mirroring how the shadcn CLI resolves them. The style
 * segment comes from the project's components.json when present.
 */
export const SHADCN_REGISTRY_URL_TEMPLATE =
  "https://ui.shadcn.com/r/styles/{style}/{name}.json";

export const DEFAULT_SHADCN_STYLE = "new-york-v4";
