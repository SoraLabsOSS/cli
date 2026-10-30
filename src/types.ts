export interface RegistryFile {
  content?: string;
  path: string;
  target?: string;
  type: string;
}

/**
 * shadcn registry-item `css` field: selectors/at-rules mapped to either a
 * raw declaration string or a nested block. An empty object means a body-
 * less at-rule (e.g. `"@apply underline": {}`).
 */
export type CssDefinition = string | { [key: string]: CssDefinition };

/**
 * shadcn registry-item `cssVars` field: variables grouped by scope —
 * "theme" lands in `@theme inline` (Tailwind v4), "light" in `:root`,
 * any other key (usually "dark") in `.<key>`.
 */
export type RegistryItemCssVars = Record<string, Record<string, string>>;

/** `registry-item` `envVars` field: key/value pairs for the project's env file. */
export type RegistryItemEnvVars = Record<string, string>;

/**
 * `registry-item` `tailwind.config` field. `plugins` entries are TS/JS
 * expressions (e.g. `require("tailwindcss-animate")`) or bare package names.
 */
export interface RegistryTailwindConfig {
  content?: string[];
  plugins?: string[];
  theme?: Record<string, unknown>;
}

export interface RegistryItemTailwind {
  config?: RegistryTailwindConfig;
}

export interface RegistryItem {
  $schema?: string;
  css?: Record<string, CssDefinition>;
  cssVars?: RegistryItemCssVars;
  dependencies?: string[];
  description?: string;
  devDependencies?: string[];
  envVars?: RegistryItemEnvVars;
  files: RegistryFile[];
  name: string;
  registryDependencies?: string[];
  tailwind?: RegistryItemTailwind;
  title?: string;
  type: string;
}

export interface RegistryIndexItem {
  description?: string;
  name: string;
  title?: string;
  type: string;
}

export interface Registry {
  homepage: string;
  items: RegistryIndexItem[];
  name: string;
}

export type ComponentAddress =
  | { scheme: "url"; url: string }
  | { scheme: "file"; path: string }
  | {
      scheme: "github";
      owner: string;
      repo: string;
      item: string;
      ref?: string;
    }
  | { scheme: "namespace"; namespace: string; item: string }
  | { scheme: "bare"; name: string };

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

/**
 * Import alias per shadcn `components.json` category. Registry content is
 * authored against "@/components/...", "@/hooks/...", "@/lib/..." and
 * "@/lib/utils" — these are what each of those gets rewritten to on write.
 */
export interface ComponentAliases {
  components: string;
  hooks: string;
  lib: string;
  utils: string;
}

export interface ProjectConfig {
  /**
   * False when no tsconfig/jsconfig `paths` entry or `components.json` was
   * found, so `aliases` is just the "@/..." default rather than something
   * actually wired up to resolve at runtime — see `add.ts`'s Astro warning.
   */
  aliasConfigured: boolean;
  aliases: ComponentAliases;
  componentPath: string;
  /**
   * The resolved absolute directory this config was detected against (the
   * `--cwd` target, or `process.cwd()`). Carried on the config — rather than
   * relying on the process's actual working directory — so a command never
   * needs a global `process.chdir()` to operate against a different
   * directory (e.g. `--cwd packages/ui` for a monorepo workspace).
   */
  cwd: string;
  /**
   * Icon library from `components.json` (`"lucide"` when unset). Used when
   * installing items that ship `<IconPlaceholder />` tags.
   */
  iconLibrary?: string;
  packageManager: PackageManager;
  /**
   * Optional custom registries declared in components.json under the
   * "registries" key, mapping a namespace (e.g. "@magicui") to its base URL.
   */
  registries?: Record<string, string>;
  /**
   * Whether the target project is configured for React Server Components (RSC).
   * True for Next.js App Router projects or when "rsc": true in components.json;
   * false for Vite, Astro, Remix, Next.js Pages router, etc.
   */
  rsc?: boolean;
  /**
   * The shadcn style from `components.json` ("new-york-v4" when absent) —
   * shadcn's base registry serves per-style variants of its components, so
   * the shadcn-fallback fetch must use the same style the shadcn CLI would.
   */
  shadcnStyle?: string;
  srcDir: string;
  /**
   * Absolute path to the project's Tailwind config, when one exists. Empty
   * for Tailwind v4 projects, which are configured in CSS instead.
   */
  tailwindConfig?: string;
  /**
   * True only when the alias came from a tsconfig/jsconfig `paths` entry.
   * `components.json` aliases satisfy `aliasConfigured` but don't make a
   * bundler resolve anything — Astro's Vite build needs the tsconfig entry
   * (plus a Vite alias), so its checks must look at this, not the merged
   * flag.
   */
  tsconfigPathsConfigured: boolean;
}
