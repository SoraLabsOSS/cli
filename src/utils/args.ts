import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { error } from "@/utils/colors.js";

export function parseAddArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      cwd: { short: "c", type: "string" },
      "dry-run": { default: false, type: "boolean" },
      force: { default: false, short: "f", type: "boolean" },
      path: { type: "string" },
      registry: { type: "string" },
      silent: { default: false, short: "s", type: "boolean" },
      view: { default: false, type: "boolean" },
      yes: { default: false, short: "y", type: "boolean" },
    },
    strict: false,
  });
  return {
    _: positionals,
    cwd: values.cwd as string | undefined,
    "dry-run": Boolean(values["dry-run"]),
    force: Boolean(values.force),
    path: values.path as string | undefined,
    registry: values.registry as string | undefined,
    silent: Boolean(values.silent),
    view: Boolean(values.view),
    yes: Boolean(values.yes),
  };
}

export function parseListArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      json: { default: false, type: "boolean" },
      registry: { type: "string" },
    },
    strict: false,
  });
  return {
    _: positionals,
    json: Boolean(values.json),
    registry: values.registry as string | undefined,
  };
}

export function parseDiffArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      cwd: { short: "c", type: "string" },
      path: { type: "string" },
      registry: { type: "string" },
    },
    strict: false,
  });
  return {
    _: positionals,
    cwd: values.cwd as string | undefined,
    path: values.path as string | undefined,
    registry: values.registry as string | undefined,
  };
}

export function parseDoctorArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      cwd: { short: "c", type: "string" },
      json: { default: false, type: "boolean" },
      registry: { type: "string" },
    },
    strict: false,
  });
  return {
    _: positionals,
    cwd: values.cwd as string | undefined,
    json: Boolean(values.json),
    registry: values.registry as string | undefined,
  };
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
