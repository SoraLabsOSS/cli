import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import {
  type ArrayLiteralExpression,
  IndentationText,
  type ObjectLiteralExpression,
  Project,
  type PropertyAssignment,
  QuoteKind,
  ScriptKind,
  SyntaxKind,
} from "ts-morph";
import type {
  ProjectConfig,
  RegistryItem,
  RegistryTailwindConfig,
} from "@/types.js";
import { detectTailwindVersion } from "@/utils/update-css.js";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const BARE_PACKAGE = /^[a-z@][\w@/.-]*$/i;
const PLUGIN_QUOTES = /["']/g;

export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeObject(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      mergeObject(existing, value);
    } else {
      target[key] = isPlainObject(value) ? structuredClone(value) : value;
    }
  }
}

/**
 * Merges every resolved item's `tailwind.config` payload, later items winning
 * on conflicts. `content` and `plugins` accumulate (they are lists); `theme`
 * deep-merges so a component can add one color without dropping the rest.
 */
export function collectTailwindConfig(
  items: RegistryItem[]
): RegistryTailwindConfig | null {
  let merged: RegistryTailwindConfig | null = null;

  for (const item of items) {
    const config = item.tailwind?.config;
    if (!config) {
      continue;
    }
    merged ??= {};
    if (config.content) {
      merged.content = [
        ...new Set([...(merged.content ?? []), ...config.content]),
      ];
    }
    if (config.plugins) {
      merged.plugins = [
        ...new Set([...(merged.plugins ?? []), ...config.plugins]),
      ];
    }
    if (config.theme) {
      merged.theme ??= {};
      mergeObject(merged.theme, config.theme);
    }
  }

  return merged;
}

/** Registry plugins may be expressions or plain package names. */
export function toPluginExpression(plugin: string): string {
  const trimmed = plugin.trim();
  if (
    trimmed.startsWith("require(") ||
    trimmed.startsWith("import(") ||
    trimmed.includes("(") ||
    trimmed.startsWith(".")
  ) {
    return trimmed;
  }
  if (BARE_PACKAGE.test(trimmed)) {
    return `require("${trimmed}")`;
  }
  return trimmed;
}

function formatKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function escapeString(value: string, quote: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(quote, `\\${quote}`)
    .replaceAll("\n", "\\n");
}

function toInitializer(value: unknown, quote: string): string {
  if (typeof value === "string") {
    return `${quote}${escapeString(value, quote)}${quote}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => toInitializer(entry, quote)).join(", ")}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(
      ([key, entry]) => `${formatKey(key)}: ${toInitializer(entry, quote)}`
    );
    return entries.length > 0 ? `{ ${entries.join(", ")} }` : "{}";
  }
  return "undefined";
}

function findProperty(
  object: ObjectLiteralExpression,
  name: string
): PropertyAssignment | undefined {
  return object.getProperty(name)?.asKind(SyntaxKind.PropertyAssignment);
}

function findOrCreateObject(
  object: ObjectLiteralExpression,
  name: string
): ObjectLiteralExpression | undefined {
  const property = findProperty(object, name);
  if (!property) {
    const added = object.addPropertyAssignment({
      initializer: "{}",
      name: formatKey(name),
    });
    return added.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  }
  return property
    .asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
}

function applyObject(
  target: ObjectLiteralExpression,
  values: Record<string, unknown>,
  quote: string
): void {
  for (const [key, value] of Object.entries(values)) {
    if (isPlainObject(value)) {
      const child = findOrCreateObject(target, key);
      if (child) {
        applyObject(child, value, quote);
      }
      continue;
    }

    const initializer = toInitializer(value, quote);
    const property = findProperty(target, key);
    if (property?.isKind(SyntaxKind.PropertyAssignment)) {
      property.setInitializer(initializer);
    } else if (!property) {
      target.addPropertyAssignment({
        initializer,
        name: formatKey(key),
      });
    }
  }
}

function normalizePlugin(text: string): string {
  return text.replace(PLUGIN_QUOTES, "").replace(/\s+/g, "");
}

function applyPlugins(
  configObject: ObjectLiteralExpression,
  plugins: string[]
): void {
  const expressions = plugins.map(toPluginExpression);
  const property = findProperty(configObject, "plugins");

  if (!property) {
    configObject.addPropertyAssignment({
      initializer: `[${expressions.join(", ")}]`,
      name: "plugins",
    });
    return;
  }

  const array = property
    .asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression);
  if (!array) {
    return;
  }

  const existing = new Set(
    array.getElements().map((element) => normalizePlugin(element.getText()))
  );
  for (const expression of expressions) {
    if (!existing.has(normalizePlugin(expression))) {
      array.addElement(expression);
      existing.add(normalizePlugin(expression));
    }
  }
}

function applyDarkMode(
  configObject: ObjectLiteralExpression,
  quote: string
): void {
  const value = `${quote}class${quote}`;
  const property = findProperty(configObject, "darkMode");

  if (!property) {
    configObject.insertPropertyAssignment(0, {
      initializer: `[${value}]`,
      name: "darkMode",
    });
    return;
  }

  const initializer = property
    .asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  if (!initializer) {
    return;
  }

  if (initializer.isKind(SyntaxKind.StringLiteral)) {
    initializer.replaceWithText(`[${initializer.getText()}, ${value}]`);
    return;
  }

  if (initializer.isKind(SyntaxKind.ArrayLiteralExpression)) {
    const array = initializer as ArrayLiteralExpression;
    const hasClass = array
      .getElements()
      .some(
        (element) => element.getText().replace(PLUGIN_QUOTES, "") === "class"
      );
    if (!hasClass) {
      array.addElement(value);
    }
  }
}

function findConfigObject(
  sourceFile: ReturnType<Project["createSourceFile"]>
): ObjectLiteralExpression | undefined {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)
    .find((node) => Boolean(findProperty(node, "content")));
}

function detectQuote(
  sourceFile: ReturnType<Project["createSourceFile"]>
): string {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.StringLiteral)[0]
    ?.getQuoteKind() === QuoteKind.Single
    ? "'"
    : '"';
}

/**
 * Applies a registry `tailwind.config` payload to a Tailwind v3 config file:
 * class-based dark mode, string plugin expressions, and a deep merge into
 * `theme` (colors, animations, keyframes). Returns the input unchanged when
 * no `content`-bearing config object can be found.
 */
export function transformTailwindConfig(
  input: string,
  config: RegistryTailwindConfig,
  fileName = "tailwind.config.ts"
): string {
  const scriptKind = fileName.endsWith(".ts") ? ScriptKind.TS : ScriptKind.JS;
  const project = new Project({
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Double,
    },
    useInMemoryFileSystem: true,
  });
  const sourceFile = project.createSourceFile(`/${fileName}`, input, {
    scriptKind,
  });
  const configObject = findConfigObject(sourceFile);
  if (!configObject) {
    return input;
  }

  const quote = detectQuote(sourceFile);
  applyDarkMode(configObject, quote);
  if (config.plugins?.length) {
    applyPlugins(configObject, config.plugins);
  }
  if (config.theme) {
    const theme = findOrCreateObject(configObject, "theme");
    if (theme) {
      applyObject(theme, config.theme, quote);
    }
  }

  return sourceFile.getFullText();
}

export type TailwindUpdateOutcome =
  | { status: "no-config" }
  | { status: "v4" }
  | { path: string; status: "unchanged" | "updated" | "would-update" };

/**
 * Writes a merged `tailwind.config` payload to the project's Tailwind v3
 * config. v4 has no config file — its animations/keyframes go through
 * `updateGlobalCss`'s `@theme` handling instead.
 */
export function updateTailwindConfig(
  items: RegistryItem[],
  config: ProjectConfig,
  options: { dryRun?: boolean } = {}
): TailwindUpdateOutcome {
  const update = collectTailwindConfig(items);
  if (!update) {
    return { status: "no-config" };
  }
  if (!config.tailwindConfig) {
    return { status: "no-config" };
  }
  if (detectTailwindVersion(config.cwd) === "v4") {
    return { status: "v4" };
  }

  const input = readFileSync(config.tailwindConfig, "utf8");
  const output = transformTailwindConfig(input, update, config.tailwindConfig);
  const relativePath = relative(config.cwd, config.tailwindConfig).replaceAll(
    "\\",
    "/"
  );

  if (output === input) {
    return { path: relativePath, status: "unchanged" };
  }
  if (options.dryRun) {
    return { path: relativePath, status: "would-update" };
  }
  writeFileSync(config.tailwindConfig, output, "utf8");
  return { path: relativePath, status: "updated" };
}

/** Exported so callers can skip the updater when there is nothing to do. */
export function hasTailwindPayload(items: RegistryItem[]): boolean {
  return items.some((item) => {
    const config = item.tailwind?.config;
    return Boolean(
      config &&
        (config.content?.length || config.plugins?.length || config.theme)
    );
  });
}

/** Exported for tests: config file presence check without importing detect. */
export function tailwindConfigExists(path: string | undefined): path is string {
  return Boolean(path && existsSync(path));
}
