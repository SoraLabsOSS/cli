import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@bomb.sh/args";
import { error } from "@/utils/colors.js";

const ADD_CONFIG = {
  alias: { c: "cwd", f: "force", s: "silent", y: "yes" },
  // Include short aliases: boolean only covers listed names (--force, not -f).
  boolean: ["force", "f", "yes", "y", "dry-run", "silent", "s", "view"],
  default: {
    "dry-run": false,
    force: false,
    silent: false,
    view: false,
    yes: false,
  },

  string: ["path", "registry", "cwd"],
} as const;

const LIST_CONFIG = {
  boolean: ["json"],
  default: { json: false },
  string: ["registry"],
} as const;

const DIFF_CONFIG = {
  alias: { c: "cwd" },
  string: ["path", "registry", "cwd"],
} as const;

const DOCTOR_CONFIG = {
  alias: { c: "cwd" },
  boolean: ["json"],
  default: { json: false },
  string: ["path", "registry", "cwd"],
} as const;

export function parseAddArgs(argv: string[]) {
  return parse(argv, ADD_CONFIG);
}

export function parseListArgs(argv: string[]) {
  return parse(argv, LIST_CONFIG);
}

export function parseDiffArgs(argv: string[]) {
  return parse(argv, DIFF_CONFIG);
}

export function parseDoctorArgs(argv: string[]) {
  return parse(argv, DOCTOR_CONFIG);
}

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
