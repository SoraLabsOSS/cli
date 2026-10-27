import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { type ParseArgsConfig, parseArgs } from "node:util";
import { error } from "@/utils/colors.js";

/** Shared wrapper — every command uses allowPositionals + strict:false. */
const pa = (argv: string[], options: ParseArgsConfig["options"]) =>
  parseArgs({ allowPositionals: true, args: argv, options, strict: false });

export function parseAddArgs(argv: string[]) {
  const { values, positionals } = pa(argv, {
    cwd: { short: "c", type: "string" },
    "dry-run": { default: false, type: "boolean" },
    force: { default: false, short: "f", type: "boolean" },
    path: { type: "string" },
    registry: { type: "string" },
    silent: { default: false, short: "s", type: "boolean" },
    view: { default: false, type: "boolean" },
    yes: { default: false, short: "y", type: "boolean" },
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
  const { values, positionals } = pa(argv, {
    json: { default: false, type: "boolean" },
    registry: { type: "string" },
  });
  return {
    _: positionals,
    json: Boolean(values.json),
    registry: values.registry as string | undefined,
  };
}

export function parseSearchArgs(argv: string[]) {
  const { values, positionals } = pa(argv, {
    json: { default: false, type: "boolean" },
    limit: { short: "l", type: "string" },
    query: { short: "q", type: "string" },
    registry: { type: "string" },
    type: { short: "t", type: "string" },
  });
  const limitNum = values.limit
    ? Number.parseInt(values.limit as string, 10)
    : undefined;
  return {
    _: positionals,
    json: Boolean(values.json),
    limit: limitNum && !Number.isNaN(limitNum) ? limitNum : undefined,
    query:
      (values.query as string | undefined) ??
      (positionals.length > 0 ? positionals.join(" ") : undefined),
    registry: values.registry as string | undefined,
    type: values.type as string | undefined,
  };
}

export function parseInfoArgs(argv: string[]) {
  const { values, positionals } = pa(argv, {
    json: { default: false, type: "boolean" },
    registry: { type: "string" },
  });
  return {
    _: positionals,
    component: positionals[0] as string | undefined,
    json: Boolean(values.json),
    registry: values.registry as string | undefined,
  };
}

export function parseDiffArgs(argv: string[]) {
  const { values, positionals } = pa(argv, {
    cwd: { short: "c", type: "string" },
    path: { type: "string" },
    registry: { type: "string" },
  });
  return {
    _: positionals,
    cwd: values.cwd as string | undefined,
    path: values.path as string | undefined,
    registry: values.registry as string | undefined,
  };
}

export function parseDoctorArgs(argv: string[]) {
  const { values, positionals } = pa(argv, {
    cwd: { short: "c", type: "string" },
    json: { default: false, type: "boolean" },
    registry: { type: "string" },
  });
  return {
    _: positionals,
    cwd: values.cwd as string | undefined,
    json: Boolean(values.json),
    registry: values.registry as string | undefined,
  };
}

export function parseInitArgs(argv: string[]) {
  const { values, positionals } = pa(argv, {
    cwd: { short: "c", type: "string" },
    defaults: { default: false, short: "d", type: "boolean" },
    force: { default: false, short: "f", type: "boolean" },
    yes: { default: false, short: "y", type: "boolean" },
  });
  return {
    _: positionals,
    cwd: values.cwd as string | undefined,
    defaults: Boolean(values.defaults),
    force: Boolean(values.force),
    yes: Boolean(values.yes),
  };
}

export function parseBuildArgs(argv: string[]) {
  const { values, positionals } = pa(argv, {
    cwd: { short: "c", type: "string" },
    output: { short: "o", type: "string" },
  });
  return {
    _: positionals,
    cwd: values.cwd as string | undefined,
    output: values.output as string | undefined,
  };
}

export function parseValidateArgs(argv: string[]) {
  const { values, positionals } = pa(argv, {
    cwd: { short: "c", type: "string" },
    json: { default: false, type: "boolean" },
  });
  return {
    _: positionals,
    cwd: values.cwd as string | undefined,
    json: Boolean(values.json),
  };
}

export function parseMcpArgs(argv: string[]) {
  const { values, positionals } = pa(argv, {
    client: { type: "string" },
    cwd: { short: "c", type: "string" },
  });
  return {
    _: positionals,
    client: values.client as string | undefined,
    cwd: values.cwd as string | undefined,
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
