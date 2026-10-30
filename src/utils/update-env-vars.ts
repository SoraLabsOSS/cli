import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { RegistryItem, RegistryItemEnvVars } from "@/types.js";

/** First match wins, mirroring the files Next.js/Vite load first. */
const ENV_FILE_CANDIDATES = [
  ".env.local",
  ".env",
  ".env.development.local",
  ".env.development",
  ".env.example",
];

const DEFAULT_ENV_FILE = ".env.local";

const ENV_KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NEWLINE = /[\r\n]/;

/**
 * Env values come from the registry (remote, untrusted input) and are written
 * verbatim into a dotenv file — a newline would let one value inject extra
 * keys, so reject anything that isn't a single-line `KEY=value`.
 */
export function assertSafeEnvVars(envVars: RegistryItemEnvVars): void {
  for (const [key, value] of Object.entries(envVars)) {
    if (!VALID_ENV_KEY.test(key)) {
      throw new Error(`Registry returned an invalid env var name: "${key}"`);
    }
    if (typeof value !== "string" || NEWLINE.test(value)) {
      throw new Error(
        `Registry returned an invalid value for env var "${key}" (must be a single-line string).`
      );
    }
  }
}

/**
 * Merges every resolved item's `envVars`, later items winning on conflicts —
 * same precedence as css/cssVars, where the requested component comes last.
 */
export function collectEnvVars(items: RegistryItem[]): RegistryItemEnvVars {
  const envVars: RegistryItemEnvVars = {};
  for (const item of items) {
    if (!item.envVars) {
      continue;
    }
    assertSafeEnvVars(item.envVars);
    Object.assign(envVars, item.envVars);
  }
  return envVars;
}

/** Keys already defined in a dotenv file (comments/blank lines ignored). */
export function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split("\n")) {
    const match = line.trim().match(ENV_KEY_LINE);
    if (match) {
      keys.add(match[1] as string);
    }
  }
  return keys;
}

/**
 * Appends only keys the file doesn't already define, leaving existing values
 * (including an intentional empty one) untouched.
 */
export function mergeEnvContent(
  existingContent: string,
  envVars: RegistryItemEnvVars
): { added: string[]; content: string } {
  const existingKeys = parseEnvKeys(existingContent);
  const added = Object.keys(envVars).filter((key) => !existingKeys.has(key));
  if (added.length === 0) {
    return { added, content: existingContent };
  }

  const base = existingContent.trimEnd();
  const next = [base, ...added.map((key) => `${key}=${envVars[key]}`)]
    .filter((block) => block.length > 0)
    .join("\n");
  return { added, content: `${next}\n` };
}

export type EnvUpdateOutcome =
  | { status: "no-vars" }
  | {
      added: string[];
      exampleAdded?: string[];
      path: string;
      status: "unchanged" | "updated" | "would-update";
    };

export function findEnvFile(cwd: string): string {
  for (const candidate of ENV_FILE_CANDIDATES) {
    const fullPath = join(cwd, candidate);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return join(cwd, DEFAULT_ENV_FILE);
}

/**
 * Writes missing registry env vars into the project's env file, creating
 * `.env.local` when none of the known variants exists. Also syncs `.env.example`
 * when present in the project. `dryRun` reports what would change without touching disk.
 */
export function updateEnvVars(
  envVars: RegistryItemEnvVars,
  cwd: string,
  options: { dryRun?: boolean } = {}
): EnvUpdateOutcome {
  if (Object.keys(envVars).length === 0) {
    return { status: "no-vars" };
  }
  assertSafeEnvVars(envVars);

  const envPath = findEnvFile(cwd);
  const relativePath = relative(cwd, envPath).replaceAll("\\", "/");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const { added, content } = mergeEnvContent(existing, envVars);

  const examplePath = join(cwd, ".env.example");
  let exampleAdded: string[] = [];
  if (existsSync(examplePath) && examplePath !== envPath) {
    const existingExample = readFileSync(examplePath, "utf8");
    const mergedExample = mergeEnvContent(existingExample, envVars);
    exampleAdded = mergedExample.added;
    if (exampleAdded.length > 0 && !options.dryRun) {
      writeFileSync(examplePath, mergedExample.content, "utf8");
    }
  }

  if (added.length === 0 && exampleAdded.length === 0) {
    return { added, exampleAdded, path: relativePath, status: "unchanged" };
  }
  if (options.dryRun) {
    return { added, exampleAdded, path: relativePath, status: "would-update" };
  }
  if (added.length > 0) {
    writeFileSync(envPath, content, "utf8");
  }
  return { added, exampleAdded, path: relativePath, status: "updated" };
}
