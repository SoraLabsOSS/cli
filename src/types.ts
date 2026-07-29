export interface RegistryFile {
  content?: string;
  path: string;
  target?: string;
  type: string;
}

export interface RegistryItem {
  $schema?: string;
  dependencies?: string[];
  description?: string;
  devDependencies?: string[];
  files: RegistryFile[];
  name: string;
  registryDependencies?: string[];
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
  packageManager: PackageManager;
  /**
   * The shadcn style from `components.json` ("new-york-v4" when absent) —
   * shadcn's base registry serves per-style variants of its components, so
   * the shadcn-fallback fetch must use the same style the shadcn CLI would.
   */
  shadcnStyle?: string;
  srcDir: string;
  /**
   * True only when the alias came from a tsconfig/jsconfig `paths` entry.
   * `components.json` aliases satisfy `aliasConfigured` but don't make a
   * bundler resolve anything — Astro's Vite build needs the tsconfig entry
   * (plus a Vite alias), so its checks must look at this, not the merged
   * flag.
   */
  tsconfigPathsConfigured: boolean;
}
