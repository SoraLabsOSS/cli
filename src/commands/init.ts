import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { confirm, isCancel, select, text } from "@clack/prompts";
import type { PackageManager } from "@/types.js";
import { bar, done, error, sanitize, warn } from "@/utils/colors.js";
import {
  detectRsc,
  findPackageManagerEvidence,
  getInstalledDependencyNames,
} from "@/utils/detect.js";
import { ensureUtils, installDependencies } from "@/utils/install.js";
import { findGlobalCssFile } from "@/utils/update-css.js";

export interface InitOptions {
  cwd?: string;
  defaults?: boolean;
  force?: boolean;
  yes?: boolean;
}

interface InitPreferences {
  alias: string;
  baseColor: string;
  cssFile: string;
  style: string;
}

const TAILWIND_CONFIGS = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.cjs",
];

const DEFAULT_GLOBAL_CSS = `@import "tailwindcss";

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
  }
}
`;

function resolveDefaultCssRel(cwd: string, srcDir: string): string {
  const foundCss = findGlobalCssFile(cwd);
  if (foundCss) {
    return relative(cwd, foundCss);
  }
  if (srcDir) {
    return `${srcDir}/app/globals.css`;
  }
  return "app/globals.css";
}

async function promptPreferences(
  defaultCssRel: string
): Promise<InitPreferences | null> {
  const styleChoice = await select({
    initialValue: "new-york-v4",
    message: "Which style would you like to use?",
    options: [
      { label: "New York (Tailwind v4)", value: "new-york-v4" },
      { label: "New York (Tailwind v3)", value: "new-york" },
    ],
  });
  if (isCancel(styleChoice)) {
    return null;
  }

  const colorChoice = await select({
    initialValue: "zinc",
    message: "Which base color would you like to use?",
    options: [
      { label: "Zinc", value: "zinc" },
      { label: "Slate", value: "slate" },
      { label: "Stone", value: "stone" },
      { label: "Gray", value: "gray" },
      { label: "Neutral", value: "neutral" },
    ],
  });
  if (isCancel(colorChoice)) {
    return null;
  }

  const cssInput = await text({
    defaultValue: defaultCssRel,
    message: "Where is your global CSS file?",
    placeholder: defaultCssRel,
  });
  if (isCancel(cssInput)) {
    return null;
  }

  const aliasInput = await text({
    defaultValue: "@",
    message: "Configure the import alias for components:",
    placeholder: "@",
  });
  if (isCancel(aliasInput)) {
    return null;
  }

  return {
    alias: (aliasInput as string).trim() || "@",
    baseColor: colorChoice as string,
    cssFile: (cssInput as string).trim() || defaultCssRel,
    style: styleChoice as string,
  };
}

async function confirmOverwrite(
  componentsJsonPath: string,
  options: InitOptions
): Promise<"cancel" | "proceed" | "refuse"> {
  if (!existsSync(componentsJsonPath) || options.force || options.yes) {
    return "proceed";
  }

  if (!process.stdin.isTTY) {
    error("components.json already exists. Use --force to overwrite.");
    return "refuse";
  }

  const shouldOverwrite = await confirm({
    message: "components.json already exists. Do you want to overwrite it?",
  });

  if (isCancel(shouldOverwrite) || !shouldOverwrite) {
    return "cancel";
  }

  return "proceed";
}

async function installBaseDependencies(
  cwd: string,
  packageManager: PackageManager
): Promise<void> {
  const installed = getInstalledDependencyNames(cwd);
  const baseDeps = ["clsx", "tailwind-merge"].filter(
    (dep) => !installed.has(dep)
  );

  if (baseDeps.length === 0) {
    return;
  }

  bar(`Installing base dependencies (${baseDeps.join(", ")})...`);
  const result = await installDependencies(baseDeps, [], packageManager, cwd);
  if (result.ok) {
    done(`Installed base dependencies: ${baseDeps.join(", ")}`);
  } else {
    warn(
      `Failed to automatically install ${baseDeps.join(", ")}. Please install them manually.`
    );
  }
}

/**
 * Initializes a project with a shadcn-compatible configuration file (`components.json`),
 * default utility functions, and required base dependencies.
 */
export async function init(options: InitOptions = {}): Promise<boolean> {
  const cwd = options.cwd ?? process.cwd();
  const pkgPath = join(cwd, "package.json");

  if (!existsSync(pkgPath)) {
    error(
      `No "package.json" found at ${sanitize(cwd)} — initialize a project first.`
    );
    return false;
  }

  const componentsJsonPath = join(cwd, "components.json");
  const overwriteCheck = await confirmOverwrite(componentsJsonPath, options);
  if (overwriteCheck === "refuse") {
    return false;
  }
  if (overwriteCheck === "cancel") {
    done("Initialization cancelled.");
    return true;
  }

  const packageManager = findPackageManagerEvidence(cwd) ?? "npm";
  const srcDir = existsSync(join(cwd, "src")) ? "src" : "";
  const isTsx =
    existsSync(join(cwd, "tsconfig.json")) ||
    existsSync(join(cwd, "jsconfig.json"));
  const isRsc = detectRsc(cwd);
  const defaultCssRel = resolveDefaultCssRel(cwd, srcDir);
  const foundTailwindConfig = TAILWIND_CONFIGS.find((f) =>
    existsSync(join(cwd, f))
  );

  const useDefaults = options.yes || options.defaults || !process.stdin.isTTY;
  let preferences: InitPreferences = {
    alias: "@",
    baseColor: "zinc",
    cssFile: defaultCssRel,
    style: "new-york-v4",
  };

  if (!useDefaults) {
    const prompted = await promptPreferences(defaultCssRel);
    if (!prompted) {
      done("Initialization cancelled.");
      return true;
    }
    preferences = prompted;
  }

  const absCssPath = resolve(cwd, preferences.cssFile);
  if (!existsSync(absCssPath)) {
    mkdirSync(dirname(absCssPath), { recursive: true });
    writeFileSync(absCssPath, DEFAULT_GLOBAL_CSS, "utf8");
    bar(`Created global CSS file at ${sanitize(preferences.cssFile)}`);
  }

  const componentsConfig = {
    $schema: "https://ui.shadcn.com/schema.json",
    aliases: {
      components: `${preferences.alias}/components`,
      hooks: `${preferences.alias}/hooks`,
      lib: `${preferences.alias}/lib`,
      ui: `${preferences.alias}/components/ui`,
      utils: `${preferences.alias}/lib/utils`,
    },
    rsc: isRsc,
    style: preferences.style,
    tailwind: {
      baseColor: preferences.baseColor,
      config: foundTailwindConfig ?? "",
      css: preferences.cssFile.replace(/\\/g, "/"),
      cssVariables: true,
    },
    tsx: isTsx,
  };

  writeFileSync(
    componentsJsonPath,
    JSON.stringify(componentsConfig, null, 2),
    "utf8"
  );
  done(`Configuration written to ${sanitize(componentsJsonPath)}`);

  const utilsStatus = ensureUtils(cwd, srcDir);
  if (utilsStatus === "written") {
    done(`Created utility helper at ${srcDir ? `${srcDir}/` : ""}lib/utils.ts`);
  }

  await installBaseDependencies(cwd, packageManager);

  done("Project initialized successfully.");
  bar("You can now install components with: sora add <component>");
  return true;
}
