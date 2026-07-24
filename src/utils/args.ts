import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { error } from "@/utils/colors.js";

export function parseFlag(
  argList: string[],
  ...flags: string[]
): string | undefined {
  for (const flag of flags) {
    const index = argList.indexOf(flag);
    if (index !== -1) {
      return argList[index + 1];
    }
  }
}

const FLAGS_TAKING_A_VALUE = new Set(["--path", "--registry", "--cwd", "-c"]);

/**
 * Everything in `argList` that isn't a flag (`-`-prefixed) or the value
 * immediately following a value-taking flag — i.e. the positional
 * component names for `add`/`diff`.
 */
export function parseComponentArgs(argList: string[]): string[] {
  return argList.filter((arg, i) => {
    if (arg.startsWith("-")) {
      return false;
    }
    const prev = argList[i - 1];
    return prev === undefined || !FLAGS_TAKING_A_VALUE.has(prev);
  });
}

/**
 * Resolves `--cwd` to an absolute path that gets threaded explicitly through
 * every command (detectConfig, writeComponent, installDependencies, ...)
 * rather than a global `process.chdir()` — mirrors how a monorepo workspace
 * like `packages/ui` gets its own tsconfig/components.json read instead of
 * the repo root's, without the process-wide side effect of actually
 * changing directory (which isn't parallel- or test-safe).
 */
export function resolveCwd(cwd: string | undefined): string | null {
  if (!cwd) {
    return process.cwd();
  }
  const resolved = resolve(cwd);
  if (!(existsSync(resolved) && statSync(resolved).isDirectory())) {
    error(`Directory not found: ${cwd}`);
    return null;
  }
  return resolved;
}
