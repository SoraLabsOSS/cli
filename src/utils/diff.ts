import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Change, diffLines } from "diff";
import pc from "picocolors";
import type { ProjectConfig, RegistryItem } from "@/types.js";
import { fileHeader, sanitize } from "@/utils/colors.js";
import {
  assertSafeDestination,
  normalizeLineEndings,
  resolveTarget,
  rewriteAliases,
} from "@/utils/install.js";

export type FileDiffStatus = "changed" | "not-installed" | "up-to-date";

export interface FileDiffResult {
  hunks?: Change[];
  status: FileDiffStatus;
  target: string;
}

/**
 * Compares each of a resolved component's files against what's on disk,
 * using the exact same target-resolution and alias-rewriting a real
 * `add` would produce, so "changed" means "would actually differ if you
 * re-ran add --force" rather than a false positive from formatting.
 */
export function diffComponentFiles(
  item: RegistryItem,
  config: ProjectConfig
): FileDiffResult[] {
  const results: FileDiffResult[] = [];
  const { cwd } = config;

  // Validate every target before reading any of them — same guard
  // writeComponent applies before writing, so a malicious registry can't
  // use ".." in a file target to read something outside the project (e.g.
  // ".env", SSH keys) and have its content printed as a "diff".
  for (const file of item.files) {
    if (!file.content) {
      continue;
    }
    assertSafeDestination(join(cwd, resolveTarget(file, item, config)), cwd);
  }

  for (const file of item.files) {
    if (!file.content) {
      continue;
    }

    const target = resolveTarget(file, item, config);
    const destPath = join(cwd, target);

    if (!existsSync(destPath)) {
      results.push({ status: "not-installed", target });
      continue;
    }

    const localContent = readFileSync(destPath, "utf8");
    const registryContent = rewriteAliases(file.content, config.aliases);

    if (
      normalizeLineEndings(localContent) ===
      normalizeLineEndings(registryContent)
    ) {
      results.push({ status: "up-to-date", target });
      continue;
    }

    results.push({
      hunks: diffLines(localContent, registryContent),
      status: "changed",
      target,
    });
  }

  return results;
}

export function printFileDiff(result: FileDiffResult): void {
  if (result.status !== "changed" || !result.hunks) {
    return;
  }

  fileHeader(sanitize(result.target));
  for (const part of result.hunks) {
    const value = sanitize(part.value);
    if (part.added) {
      process.stdout.write(pc.green(prefixLines(value, "+")));
    } else if (part.removed) {
      process.stdout.write(pc.red(prefixLines(value, "-")));
    } else {
      process.stdout.write(pc.dim(prefixLines(value, " ")));
    }
  }
  console.log();
}

const TRAILING_NEWLINE = /\n$/;

function prefixLines(value: string, marker: string): string {
  const endsWithNewline = value.endsWith("\n");
  const lines = value.replace(TRAILING_NEWLINE, "").split("\n");
  const prefixed = lines.map((line) => `${marker} ${line}`).join("\n");
  return endsWithNewline ? `${prefixed}\n` : prefixed;
}
