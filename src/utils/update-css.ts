import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AtRule, Declaration, Root, Rule } from "postcss";
import postcss from "postcss";
import { twMerge } from "tailwind-merge";
import type {
  CssDefinition,
  RegistryItem,
  RegistryItemCssVars,
} from "@/types.js";
import { findAncestorDependency } from "@/utils/detect.js";
import { normalizeLineEndings } from "@/utils/install.js";

export type TailwindVersion = "v3" | "v4";

const MAJOR_VERSION_PATTERN = /(\d+)/;
const TAILWIND_V3_DIRECTIVE = /@tailwind\s+base/;
const TAILWIND_V4_IMPORT = /@import\s+(["'])tailwindcss\1/;
const AT_RULE_PATTERN = /@([a-zA-Z-]+)\s*(.*)/;
const BREAK_COMMENT_PATTERN = /\/\* ---break--- \*\//g;
const BLANK_LINES_PATTERN = /(\n\s*\n)+/g;
const LEADING_VAR_DASHES = /^--/;
const QUOTES_PATTERN = /["']/g;
const SELECTOR_HEAD_PATTERN = /^([^:]+)/;

/**
 * Tailwind v3 puts variables in `@layer base` and themes in
 * tailwind.config.js; v4 is CSS-first (`:root`/`.dark` + `@theme inline`).
 * The dependency version is authoritative when found; the global CSS file's
 * own syntax is the fallback signal (a `@tailwind base` directive can only
 * be v3).
 */
export function detectTailwindVersion(
  cwd: string,
  cssContent?: string
): TailwindVersion {
  const dep = findAncestorDependency(cwd, "tailwindcss");
  const major = dep ? dep.version.match(MAJOR_VERSION_PATTERN)?.[1] : null;
  if (major) {
    return Number.parseInt(major, 10) <= 3 ? "v3" : "v4";
  }
  if (
    cssContent &&
    TAILWIND_V3_DIRECTIVE.test(cssContent) &&
    !TAILWIND_V4_IMPORT.test(cssContent)
  ) {
    return "v3";
  }
  return "v4";
}

function readComponentsJsonCssPath(cwd: string): string | null {
  const configPath = join(cwd, "components.json");
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      tailwind?: { css?: string };
    };
    const cssPath = parsed.tailwind?.css;
    if (cssPath) {
      const absolute = join(cwd, cssPath);
      if (existsSync(absolute)) {
        return absolute;
      }
    }
  } catch {
    // malformed components.json, fall through to scanning
  }
  return null;
}

const SCAN_SKIP_DIRS = new Set([
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "public",
  "static",
]);
const MAX_SCAN_DEPTH = 5;

function isTailwindEntryCss(content: string): boolean {
  return (
    TAILWIND_V4_IMPORT.test(content) || TAILWIND_V3_DIRECTIVE.test(content)
  );
}

function findTailwindCssInDir(dir: string): {
  file: string | null;
  subdirs: string[];
} {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { file: null, subdirs: [] };
  }

  const subdirs: string[] = [];
  for (const entry of entries) {
    const { name } = entry;
    if (entry.isFile() && name.endsWith(".css")) {
      const filePath = join(dir, name);
      try {
        if (isTailwindEntryCss(readFileSync(filePath, "utf8"))) {
          return { file: filePath, subdirs: [] };
        }
      } catch {
        // unreadable file, keep scanning
      }
    } else if (
      entry.isDirectory() &&
      !name.startsWith(".") &&
      !SCAN_SKIP_DIRS.has(name)
    ) {
      subdirs.push(join(dir, name));
    }
  }
  return { file: null, subdirs };
}

/**
 * Locates the project's global CSS file the same way shadcn does:
 * `components.json`'s `tailwind.css` path when present, otherwise a bounded
 * breadth-first scan for the stylesheet that imports Tailwind
 * (`@import "tailwindcss"` for v4, `@tailwind base` for v3). Breadth-first
 * so the shallowest match wins — a project's own `app/globals.css` beats a
 * fixture or example buried deeper in the tree.
 */
export function findGlobalCssFile(cwd: string): string | null {
  const fromConfig = readComponentsJsonCssPath(cwd);
  if (fromConfig) {
    return fromConfig;
  }

  let level = [cwd];
  for (let depth = 0; depth <= MAX_SCAN_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const dir of level) {
      const { file, subdirs } = findTailwindCssInDir(dir);
      if (file) {
        return file;
      }
      next.push(...subdirs);
    }
    level = next;
  }
  return null;
}

export interface CssPayload {
  css: Record<string, CssDefinition>;
  cssVars: RegistryItemCssVars;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PROTOTYPE_POLLUTION_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function mergeCssDefinitions(
  target: Record<string, CssDefinition>,
  source: Record<string, CssDefinition>
): void {
  for (const [key, value] of Object.entries(source)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      continue;
    }
    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      mergeCssDefinitions(existing, value);
    } else {
      target[key] = isPlainObject(value) ? structuredClone(value) : value;
    }
  }
}

/**
 * Merges every resolved item's `css`/`cssVars` into one payload, later
 * items winning on conflicts — mirrors shadcn's deepmerge of the resolved
 * registry tree, where the requested component (last in dependency order)
 * takes precedence over its dependencies.
 */
export function collectCssPayload(items: RegistryItem[]): CssPayload {
  const css: Record<string, CssDefinition> = {};
  const cssVars: RegistryItemCssVars = {};

  for (const item of items) {
    if (item.css) {
      mergeCssDefinitions(css, item.css);
    }
    for (const [scope, vars] of Object.entries(item.cssVars ?? {})) {
      cssVars[scope] = { ...cssVars[scope], ...vars };
    }
  }

  return { css, cssVars };
}

export function hasCssPayload(payload: CssPayload): boolean {
  return (
    Object.keys(payload.css).length > 0 ||
    Object.keys(payload.cssVars).length > 0
  );
}

/**
 * Component installs must never clobber a user's customized variable
 * values — only theme-defining item types get to overwrite (same rule as
 * shadcn's `shouldOverwriteCssVars`).
 */
const OVERWRITE_CSS_VARS_TYPES = new Set([
  "registry:base",
  "registry:font",
  "registry:style",
  "registry:theme",
]);

export function shouldOverwriteCssVars(items: RegistryItem[]): boolean {
  return items.some((item) => OVERWRITE_CSS_VARS_TYPES.has(item.type));
}

function breakComment() {
  return postcss.comment({ text: "---break---" });
}

function upsertDecl(
  container: AtRule | Rule,
  prop: string,
  value: string,
  overwrite: boolean
): void {
  const newDecl = postcss.decl({ prop, raws: { semicolon: true }, value });
  const existingDecl = container.nodes?.find(
    (node): node is Declaration => node.type === "decl" && node.prop === prop
  );
  if (existingDecl) {
    if (overwrite) {
      existingDecl.replaceWith(newDecl);
    }
    return;
  }
  container.append(newDecl);
}

function upsertThemeNode(root: Root): AtRule {
  let themeNode = root.nodes.find(
    (node): node is AtRule =>
      node.type === "atrule" &&
      node.name === "theme" &&
      node.params === "inline"
  );

  if (!themeNode) {
    themeNode = postcss.atRule({
      name: "theme",
      nodes: [],
      params: "inline",
      raws: { before: "\n", between: " ", semicolon: true },
    });
    root.append(themeNode);
    root.insertBefore(themeNode, breakComment());
  }

  return themeNode;
}

/**
 * A bare space-separated HSL triple ("210 40% 96%") — the shadcn v3
 * convention that must be wrapped in `hsl(...)` when written to a v4 file.
 */
export function isLocalHslValue(value: string): boolean {
  if (
    value.startsWith("hsl") ||
    value.startsWith("rgb") ||
    value.startsWith("#") ||
    value.startsWith("oklch")
  ) {
    return false;
  }
  const chunks = value.split(" ");
  return (
    chunks.length === 3 && chunks.slice(1, 3).every((c) => c.includes("%"))
  );
}

export function isColorValue(value: string): boolean {
  return (
    value.startsWith("hsl") ||
    value.startsWith("rgb") ||
    value.startsWith("#") ||
    value.startsWith("oklch") ||
    value.includes("--color-")
  );
}

function addCustomVariantPlugin(params: string) {
  return {
    Once(root: Root) {
      const existing = root.nodes.find(
        (node): node is AtRule =>
          node.type === "atrule" && node.name === "custom-variant"
      );
      if (existing || root.nodes.length === 0) {
        return;
      }

      const variantNode = postcss.atRule({
        name: "custom-variant",
        params,
        raws: { before: "\n", semicolon: true },
      });

      const importNodes = root.nodes.filter(
        (node): node is AtRule =>
          node.type === "atrule" && node.name === "import"
      );
      const lastImport = importNodes.at(-1);
      const anchor = lastImport ?? root.nodes[0];
      if (!anchor) {
        return;
      }
      root.insertAfter(anchor, variantNode);
      root.insertBefore(variantNode, breakComment());
    },
    postcssPlugin: "add-custom-variant",
  };
}

function writeThemeScopeVars(
  root: Root,
  vars: Record<string, string>,
  overwrite: boolean
): void {
  const themeNode = upsertThemeNode(root);
  for (const [key, value] of Object.entries(vars)) {
    upsertDecl(
      themeNode,
      `--${key.replace(LEADING_VAR_DASHES, "")}`,
      value,
      overwrite
    );
  }
}

function writeSelectorScopeVars(
  root: Root,
  selector: string,
  vars: Record<string, string>,
  overwrite: boolean
): void {
  let ruleNode = root.nodes.find(
    (node): node is Rule => node.type === "rule" && node.selector === selector
  );

  if (!ruleNode && Object.keys(vars).length > 0) {
    ruleNode = postcss.rule({
      nodes: [],
      raws: { before: "\n", between: " ", semicolon: true },
      selector,
    });
    root.append(ruleNode);
    root.insertBefore(ruleNode, breakComment());
  }
  if (!ruleNode) {
    return;
  }

  for (const [key, rawValue] of Object.entries(vars)) {
    let prop = `--${key.replace(LEADING_VAR_DASHES, "")}`;
    if (prop === "--sidebar-background") {
      prop = "--sidebar";
    }
    const value = isLocalHslValue(rawValue) ? `hsl(${rawValue})` : rawValue;
    upsertDecl(ruleNode, prop, value, overwrite);
  }
}

function updateCssVarsPluginV4(
  cssVars: RegistryItemCssVars,
  overwrite: boolean
) {
  return {
    Once(root: Root) {
      for (const [scope, vars] of Object.entries(cssVars)) {
        if (scope === "theme") {
          writeThemeScopeVars(root, vars, overwrite);
        } else {
          const selector = scope === "light" ? ":root" : `.${scope}`;
          writeSelectorScopeVars(root, selector, vars, overwrite);
        }
      }
    },
    postcssPlugin: "update-css-vars-v4",
  };
}

const RADIUS_SCALE: Record<string, string> = {
  "2xl": "calc(var(--radius) * 1.8)",
  "3xl": "calc(var(--radius) * 2.2)",
  "4xl": "calc(var(--radius) * 2.6)",
  lg: "var(--radius)",
  md: "calc(var(--radius) * 0.8)",
  sm: "calc(var(--radius) * 0.6)",
  xl: "calc(var(--radius) * 1.4)",
};

function appendRadiusScale(themeNode: AtRule): void {
  for (const [size, value] of Object.entries(RADIUS_SCALE)) {
    upsertDecl(themeNode, `--radius-${size}`, value, false);
  }
}

function findScopeValue(
  cssVars: RegistryItemCssVars,
  variable: string
): string | undefined {
  for (const vars of Object.values(cssVars)) {
    if (vars[variable]) {
      return vars[variable];
    }
  }
}

/**
 * Ensures every installed variable has a Tailwind v4 `@theme inline`
 * mapping (`--color-x: var(--x)` for colors, `--x: var(--x)` otherwise) so
 * utilities like `bg-x` resolve. `radius` expands into the full
 * `--radius-sm`…`--radius-4xl` calc() scale. Never overwrites what's
 * already mapped.
 */
function updateThemeMappingsPlugin(cssVars: RegistryItemCssVars) {
  return {
    Once(root: Root) {
      const variables = Array.from(
        new Set(Object.values(cssVars).flatMap((vars) => Object.keys(vars)))
      );
      if (variables.length === 0) {
        return;
      }

      const themeNode = upsertThemeNode(root);
      for (const variable of variables) {
        const value = findScopeValue(cssVars, variable);
        if (!value) {
          continue;
        }

        if (variable === "radius") {
          appendRadiusScale(themeNode);
          continue;
        }

        let prop =
          isLocalHslValue(value) || isColorValue(value)
            ? `--color-${variable.replace(LEADING_VAR_DASHES, "")}`
            : `--${variable.replace(LEADING_VAR_DASHES, "")}`;
        let propValue = `var(--${variable})`;
        if (prop === "--color-sidebar-background") {
          prop = "--color-sidebar";
          propValue = "var(--sidebar)";
        }
        upsertDecl(themeNode, prop, propValue, false);
      }
    },
    postcssPlugin: "update-theme-mappings",
  };
}

function upsertBaseLayer(root: Root): AtRule {
  let baseLayer = root.nodes.find(
    (node): node is AtRule =>
      node.type === "atrule" && node.name === "layer" && node.params === "base"
  );

  if (!baseLayer) {
    baseLayer = postcss.atRule({
      name: "layer",
      nodes: [],
      params: "base",
      raws: { before: "\n", between: " ", semicolon: true },
    });
    root.append(baseLayer);
    root.insertBefore(baseLayer, breakComment());
  }

  return baseLayer;
}

function updateCssVarsPluginV3(cssVars: RegistryItemCssVars) {
  return {
    Once(root: Root) {
      const scopes = Object.entries(cssVars).filter(
        ([scope]) => scope !== "theme"
      );
      if (scopes.length === 0) {
        return;
      }

      const baseLayer = upsertBaseLayer(root);
      for (const [scope, vars] of scopes) {
        const selector = scope === "light" ? ":root" : `.${scope}`;
        let ruleNode = baseLayer.nodes?.find(
          (node): node is Rule =>
            node.type === "rule" && node.selector === selector
        );
        if (!ruleNode && Object.keys(vars).length > 0) {
          ruleNode = postcss.rule({
            raws: { before: "\n  ", between: " " },
            selector,
          });
          baseLayer.append(ruleNode);
        }
        if (!ruleNode) {
          continue;
        }
        for (const [key, value] of Object.entries(vars)) {
          upsertDecl(
            ruleNode,
            `--${key.replace(LEADING_VAR_DASHES, "")}`,
            value,
            true
          );
        }
      }
    },
    postcssPlugin: "update-css-vars-v3",
  };
}

/**
 * Applies a registry `cssVars` payload to a global stylesheet. Tailwind v4
 * gets the CSS-first treatment (`@custom-variant dark`, top-level
 * `:root`/`.dark` rules, `@theme inline` mappings); v3 gets variables
 * inside `@layer base` — both mirroring the shadcn CLI's updaters.
 */
export async function transformCssVars(
  input: string,
  cssVars: RegistryItemCssVars,
  options: { overwriteCssVars?: boolean; tailwindVersion: TailwindVersion }
): Promise<string> {
  const overwrite = options.overwriteCssVars ?? false;
  const plugins =
    options.tailwindVersion === "v4"
      ? [
          addCustomVariantPlugin("dark (&:is(.dark *))"),
          updateCssVarsPluginV4(cssVars, overwrite),
          updateThemeMappingsPlugin(cssVars),
        ]
      : [updateCssVarsPluginV3(cssVars)];

  const result = await postcss(plugins).process(input, { from: undefined });

  let output = result.css.replace(BREAK_COMMENT_PATTERN, "");
  if (options.tailwindVersion === "v4") {
    output = output.replace(BLANK_LINES_PATTERN, "\n\n");
  }
  return output;
}

function isEmptyObject(value: CssDefinition): boolean {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function insertImport(root: Root, params: string): void {
  const importNodes = root.nodes.filter(
    (node): node is AtRule => node.type === "atrule" && node.name === "import"
  );
  if (importNodes.some((node) => node.params === params)) {
    return;
  }

  const importRule = postcss.atRule({
    name: "import",
    params,
    raws: { semicolon: true },
  });
  const lastImport = importNodes.at(-1);
  if (lastImport) {
    importRule.raws.before = "\n";
    root.insertAfter(lastImport, importRule);
  } else {
    importRule.raws.before = "";
    root.prepend(importRule);
  }
}

function stripQuotes(value: string): string {
  return value.replace(QUOTES_PATTERN, "");
}

function insertPlugin(root: Root, params: string): void {
  const quotedParams =
    params.startsWith('"') || params.startsWith("'") ? params : `"${params}"`;

  const pluginNodes = root.nodes.filter(
    (node): node is AtRule => node.type === "atrule" && node.name === "plugin"
  );
  if (
    pluginNodes.some((node) => stripQuotes(node.params) === stripQuotes(params))
  ) {
    return;
  }

  const pluginRule = postcss.atRule({
    name: "plugin",
    params: quotedParams,
    raws: { before: "\n", semicolon: true },
  });

  const lastPlugin = pluginNodes.at(-1);
  const importNodes = root.nodes.filter(
    (node): node is AtRule => node.type === "atrule" && node.name === "import"
  );
  const lastImport = importNodes.at(-1);

  if (lastPlugin) {
    root.insertAfter(lastPlugin, pluginRule);
    return;
  }
  if (lastImport) {
    root.insertAfter(lastImport, pluginRule);
  } else {
    root.prepend(pluginRule);
  }
  root.insertBefore(pluginRule, breakComment());
  root.insertAfter(pluginRule, breakComment());
}

function appendBodylessAtRule(root: Root, name: string, params: string): void {
  const existing = root.nodes.find(
    (node): node is AtRule =>
      node.type === "atrule" && node.name === name && node.params === params
  );
  if (existing) {
    return;
  }
  const newAtRule = postcss.atRule({
    name,
    params,
    raws: { semicolon: true },
  });
  root.append(newAtRule);
  root.insertBefore(newAtRule, breakComment());
}

/**
 * Tailwind v4 keyframes live inside `@theme inline` so they can back
 * `--animate-*` variables; a same-name keyframes block is replaced
 * wholesale rather than merged.
 */
function upsertKeyframes(
  root: Root,
  params: string,
  properties: CssDefinition
): void {
  const themeNode = upsertThemeNode(root);
  const keyframesRule = postcss.atRule({
    name: "keyframes",
    params,
    raws: { before: "\n  ", between: " ", semicolon: true },
  });

  const existing = themeNode.nodes?.find(
    (node): node is AtRule =>
      node.type === "atrule" &&
      node.name === "keyframes" &&
      node.params === params
  );
  if (existing) {
    existing.replaceWith(keyframesRule);
  } else {
    themeNode.append(keyframesRule);
  }

  if (isPlainObject(properties)) {
    for (const [step, stepProps] of Object.entries(properties)) {
      processRule(keyframesRule, step, stepProps);
    }
  }
}

function applyBodylessAtRuleChild(container: AtRule | Rule, prop: string) {
  const match = prop.match(AT_RULE_PATTERN);
  if (!match) {
    return;
  }
  const name = match[1] ?? "";
  const params = match[2] ?? "";
  const existing = container.nodes?.find(
    (node): node is AtRule =>
      node.type === "atrule" && node.name === name && node.params === params
  );
  if (!existing) {
    container.append(
      postcss.atRule({
        name,
        params,
        raws: { before: "\n    ", semicolon: true },
      })
    );
  }
}

function upsertUtility(
  root: Root,
  params: string,
  properties: CssDefinition
): void {
  let utilityRule = root.nodes.find(
    (node): node is AtRule =>
      node.type === "atrule" &&
      node.name === "utility" &&
      node.params === params
  );

  if (!utilityRule) {
    utilityRule = postcss.atRule({
      name: "utility",
      params,
      raws: { before: "\n", between: " ", semicolon: true },
    });
    root.append(utilityRule);
    root.insertBefore(utilityRule, breakComment());
  }

  if (!isPlainObject(properties)) {
    return;
  }
  for (const [prop, value] of Object.entries(properties)) {
    if (typeof value === "string") {
      upsertDecl(utilityRule, prop, value, true);
    } else if (prop.startsWith("@") && isEmptyObject(value)) {
      applyBodylessAtRuleChild(utilityRule, prop);
    } else if (isPlainObject(value)) {
      processRule(utilityRule, prop, value);
    }
  }
}

function appendParsedDeclarations(
  parent: Rule | AtRule,
  declarations: string
): void {
  const parsed = postcss.parse(`.temp{${declarations}}`);
  const tempRule = parsed.first as Rule | undefined;
  if (!tempRule?.nodes) {
    return;
  }
  for (const node of tempRule.nodes) {
    if (node.type === "decl") {
      const clone = node.clone();
      clone.raws.before = "\n    ";
      parent.append(clone);
    }
  }
}

function processAtRule(
  root: Root | AtRule,
  name: string,
  params: string,
  properties: CssDefinition
): void {
  let atRule = root.nodes?.find(
    (node): node is AtRule =>
      node.type === "atrule" && node.name === name && node.params === params
  );

  if (!atRule) {
    atRule = postcss.atRule({
      name,
      params,
      raws: { before: "\n", between: " ", semicolon: true },
    });
    root.append(atRule);
    root.insertBefore(atRule, breakComment());
  }

  if (typeof properties === "string") {
    appendParsedDeclarations(atRule, properties);
    return;
  }
  for (const [childSelector, childProps] of Object.entries(properties)) {
    if (childSelector.startsWith("@")) {
      const nestedMatch = childSelector.match(AT_RULE_PATTERN);
      if (nestedMatch) {
        processAtRule(
          atRule,
          nestedMatch[1] ?? "",
          nestedMatch[2] ?? "",
          childProps
        );
      }
    } else {
      processRule(atRule, childSelector, childProps);
    }
  }
}

function applyRuleAtRuleChild(rule: Rule, prop: string): void {
  const match = prop.match(AT_RULE_PATTERN);
  if (!match) {
    return;
  }
  const name = match[1] ?? "";
  const params = match[2] ?? "";
  const existing = rule.nodes?.find(
    (node): node is AtRule =>
      node.type === "atrule" && node.name === name && node.params === params
  );
  if (existing) {
    return;
  }

  // Merge into an existing @apply (via tailwind-merge, so conflicting
  // utilities collapse) instead of stacking duplicate @apply rules.
  if (name === "apply") {
    const existingApply = rule.nodes?.find(
      (node): node is AtRule => node.type === "atrule" && node.name === "apply"
    );
    if (existingApply) {
      existingApply.params = twMerge(existingApply.params, params);
      return;
    }
  }

  rule.append(
    postcss.atRule({
      name,
      params,
      raws: { before: "\n    ", semicolon: true },
    })
  );
}

function processRule(
  parent: Root | AtRule,
  selector: string,
  properties: CssDefinition
): void {
  let rule = parent.nodes?.find(
    (node): node is Rule => node.type === "rule" && node.selector === selector
  );

  if (!rule) {
    rule = postcss.rule({
      raws: { before: "\n  ", between: " ", semicolon: true },
      selector,
    });
    parent.append(rule);
  }

  if (typeof properties === "string") {
    appendParsedDeclarations(rule, properties);
    return;
  }
  for (const [prop, value] of Object.entries(properties)) {
    if (prop.startsWith("@") && isEmptyObject(value)) {
      applyRuleAtRuleChild(rule, prop);
    } else if (typeof value === "string") {
      upsertDecl(rule, prop, value, true);
    } else if (isPlainObject(value)) {
      const nestedSelector = prop.startsWith("&")
        ? selector.replace(SELECTOR_HEAD_PATTERN, `$1${prop.slice(1)}`)
        : prop;
      processRule(parent, nestedSelector, value);
    }
  }
}

function handleTopLevelAtRule(
  root: Root,
  selector: string,
  properties: CssDefinition
): void {
  const match = selector.match(AT_RULE_PATTERN);
  if (!match) {
    return;
  }
  const name = match[1] ?? "";
  const params = match[2] ?? "";

  if (name === "import") {
    insertImport(root, params);
  } else if (name === "plugin") {
    insertPlugin(root, params);
  } else if (isEmptyObject(properties)) {
    appendBodylessAtRule(root, name, params);
  } else if (name === "keyframes") {
    upsertKeyframes(root, params, properties);
  } else if (name === "utility") {
    upsertUtility(root, params, properties);
  } else if (name === "property") {
    processRule(root, selector, properties);
  } else {
    processAtRule(root, name, params, properties);
  }
}

function updateCssPlugin(css: Record<string, CssDefinition>) {
  return {
    Once(root: Root) {
      for (const [selector, properties] of Object.entries(css)) {
        if (selector.startsWith("@")) {
          handleTopLevelAtRule(root, selector, properties);
        } else {
          processRule(root, selector, properties);
        }
      }
    },
    postcssPlugin: "update-css",
  };
}

/**
 * Applies a registry `css` payload (extra `@layer`s, `@utility`s,
 * `@keyframes`, plain rules) to a global stylesheet — idempotent
 * find-or-create, same as shadcn's `transformCss`.
 */
export async function transformCss(
  input: string,
  css: Record<string, CssDefinition>
): Promise<string> {
  const result = await postcss([updateCssPlugin(css)]).process(input, {
    from: undefined,
  });

  let output = result.css;

  // PostCSS doesn't add a semicolon to a body-less at-rule when it's the
  // last node — patch it up so the output stays valid CSS.
  const lastNode = result.root.nodes.at(-1);
  if (
    lastNode?.type === "atrule" &&
    !lastNode.nodes &&
    !output.trimEnd().endsWith(";")
  ) {
    output = `${output.trimEnd()};`;
  }

  return output
    .replace(BREAK_COMMENT_PATTERN, "")
    .replace(BLANK_LINES_PATTERN, "\n\n")
    .trimEnd();
}

export type CssUpdateOutcome =
  | { status: "no-css-file" }
  | { path: string; status: "unchanged" | "updated" | "would-update" };

/**
 * Applies a merged css/cssVars payload to the project's global CSS file.
 * Returns what happened (and the file's cwd-relative path) so the caller
 * owns all messaging; `dryRun` transforms but never writes.
 */
export async function updateGlobalCss(
  payload: CssPayload,
  cwd: string,
  options: { dryRun?: boolean; overwriteCssVars?: boolean } = {}
): Promise<CssUpdateOutcome> {
  const cssFile = findGlobalCssFile(cwd);
  if (!cssFile) {
    return { status: "no-css-file" };
  }

  const relativePath = relative(cwd, cssFile).replaceAll("\\", "/");
  const input = readFileSync(cssFile, "utf8");
  const tailwindVersion = detectTailwindVersion(cwd, input);

  let output = input;
  if (Object.keys(payload.cssVars).length > 0) {
    output = await transformCssVars(output, payload.cssVars, {
      overwriteCssVars: options.overwriteCssVars,
      tailwindVersion,
    });
  }
  if (Object.keys(payload.css).length > 0) {
    output = await transformCss(output, payload.css);
  }

  if (normalizeLineEndings(output) === normalizeLineEndings(input)) {
    return { path: relativePath, status: "unchanged" };
  }
  if (options.dryRun) {
    return { path: relativePath, status: "would-update" };
  }
  writeFileSync(cssFile, output, "utf8");
  return { path: relativePath, status: "updated" };
}
