import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type { RegistryItem } from "@/types.js";
import { bar, done, error, sanitize, warn } from "@/utils/colors.js";

export interface ValidationError {
  item?: string;
  message: string;
  path?: string;
}

export interface ValidationReport {
  errors: ValidationError[];
  fileCount: number;
  itemCount: number;
  registryFile: string;
  valid: boolean;
  warnings: ValidationError[];
}

export interface ValidateOptions {
  cwd?: string;
  json?: boolean;
}

const VALID_NAME_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;
const UNSAFE_DEP_CHARS = /[^a-zA-Z0-9@/._-]/;

function isPathInside(childPath: string, parentDir: string): boolean {
  const rel = resolve(childPath);
  const root = resolve(parentDir);
  return rel === root || rel.startsWith(root + sep);
}

function parseRegistryFile(
  registryFile: string,
  errors: ValidationError[]
): Record<string, unknown> | null {
  if (!existsSync(registryFile)) {
    errors.push({
      message: `Registry file not found: "${registryFile}"`,
      path: registryFile,
    });
    return null;
  }

  let rawContent: string;
  try {
    rawContent = readFileSync(registryFile, "utf8");
  } catch (err) {
    errors.push({
      message: `Failed to read registry file: ${(err as Error).message}`,
      path: registryFile,
    });
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawContent);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push({
        message: "Registry root must be a JSON object",
        path: registryFile,
      });
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    errors.push({
      message: `Failed to parse registry JSON: ${(err as Error).message}`,
      path: registryFile,
    });
    return null;
  }
}

function validateRootHeaders(
  root: Record<string, unknown>,
  registryFile: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): boolean {
  if (typeof root.name !== "string" || root.name.trim().length === 0) {
    errors.push({
      message: 'Registry root must define a non-empty string "name"',
      path: registryFile,
    });
  }

  if (typeof root.homepage !== "string" || root.homepage.trim().length === 0) {
    warnings.push({
      message: 'Registry root is missing a "homepage" field',
      path: registryFile,
    });
  }

  if (!Array.isArray(root.items)) {
    errors.push({
      message: 'Registry root must contain an "items" array',
      path: registryFile,
    });
    return false;
  }

  return true;
}

function validateItemFiles(
  item: Partial<RegistryItem>,
  registryDir: string,
  cwd: string,
  errors: ValidationError[]
): number {
  if (!Array.isArray(item.files) || item.files.length === 0) {
    errors.push({
      item: item.name,
      message: `Item "${item.name ?? "unnamed"}" must specify at least one file in "files"`,
    });
    return 0;
  }

  for (const file of item.files) {
    if (!file.path || typeof file.path !== "string") {
      errors.push({
        item: item.name,
        message: `Item "${item.name ?? "unnamed"}" contains a file entry with a missing or invalid "path"`,
      });
      continue;
    }

    const filePath = isAbsolute(file.path)
      ? file.path
      : resolve(registryDir, file.path);

    if (!isPathInside(filePath, cwd)) {
      errors.push({
        item: item.name,
        message: `Item "${item.name}" file "${file.path}" escapes the project root directory`,
        path: file.path,
      });
    } else if (!existsSync(filePath)) {
      errors.push({
        item: item.name,
        message: `Item "${item.name}" declared file not found on disk: "${file.path}"`,
        path: filePath,
      });
    }
  }

  return item.files.length;
}

function validateDependenciesList(
  deps: unknown,
  field: string,
  itemName: string,
  errors: ValidationError[]
): void {
  if (deps === undefined) {
    return;
  }

  if (!Array.isArray(deps)) {
    errors.push({
      item: itemName,
      message: `Item "${itemName}" "${field}" must be an array of strings`,
    });
    return;
  }

  for (const dep of deps) {
    if (
      typeof dep !== "string" ||
      UNSAFE_DEP_CHARS.test(dep) ||
      dep.startsWith("-")
    ) {
      errors.push({
        item: itemName,
        message: `Item "${itemName}" contains an invalid ${field} name: "${String(dep)}"`,
      });
    }
  }
}

function validateRegistryItems(
  items: Partial<RegistryItem>[],
  registryDir: string,
  cwd: string,
  errors: ValidationError[]
): number {
  const seenNames = new Set<string>();
  let totalFiles = 0;

  for (const item of items) {
    if (!item.name || typeof item.name !== "string") {
      errors.push({
        message: 'An item in the registry is missing a valid string "name"',
      });
      continue;
    }

    if (!VALID_NAME_PATTERN.test(item.name)) {
      errors.push({
        item: item.name,
        message: `Item "${item.name}" name must contain only lowercase letters, digits, and ._/-`,
      });
    }

    if (seenNames.has(item.name)) {
      errors.push({
        item: item.name,
        message: `Duplicate item name found: "${item.name}"`,
      });
    }
    seenNames.add(item.name);

    if (!item.type || typeof item.type !== "string") {
      errors.push({
        item: item.name,
        message: `Item "${item.name}" is missing a string "type"`,
      });
    }

    totalFiles += validateItemFiles(item, registryDir, cwd, errors);
    validateDependenciesList(
      item.dependencies,
      "dependencies",
      item.name,
      errors
    );
    validateDependenciesList(
      item.devDependencies,
      "devDependencies",
      item.name,
      errors
    );

    if (item.registryDependencies) {
      validateDependenciesList(
        item.registryDependencies,
        "registryDependencies",
        item.name,
        errors
      );
      if (
        Array.isArray(item.registryDependencies) &&
        item.registryDependencies.includes(item.name)
      ) {
        errors.push({
          item: item.name,
          message: `Item "${item.name}" has a circular self-reference in "registryDependencies"`,
        });
      }
    }
  }

  return totalFiles;
}

function finishReport(report: ValidationReport, json?: boolean): boolean {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report.valid;
  }

  if (report.valid) {
    done(
      `Registry is valid. Checked ${report.itemCount} item${report.itemCount === 1 ? "" : "s"} across ${report.fileCount} file${report.fileCount === 1 ? "" : "s"}.`
    );
    for (const w of report.warnings) {
      warn(sanitize(w.message));
    }
    return true;
  }

  error(
    `Registry validation failed with ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}:`
  );
  for (const err of report.errors) {
    bar(`  - ${sanitize(err.message)}`);
  }
  for (const w of report.warnings) {
    warn(sanitize(w.message));
  }
  return false;
}

/**
 * Validates a local registry JSON definition file against the expected schema,
 * verifying that all declared files, dependencies, and metadata are intact.
 */
export function validate(
  registryFileArg?: string,
  options: ValidateOptions = {}
): boolean {
  const cwd = options.cwd ?? process.cwd();
  const registryFile = resolve(cwd, registryFileArg ?? "registry.json");
  const registryDir = dirname(registryFile);

  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const root = parseRegistryFile(registryFile, errors);
  if (!root) {
    return finishReport(
      {
        errors,
        fileCount: 0,
        itemCount: 0,
        registryFile,
        valid: false,
        warnings,
      },
      options.json
    );
  }

  const rootValid = validateRootHeaders(root, registryFile, errors, warnings);
  if (!rootValid) {
    return finishReport(
      {
        errors,
        fileCount: 0,
        itemCount: 0,
        registryFile,
        valid: false,
        warnings,
      },
      options.json
    );
  }

  const items = root.items as Partial<RegistryItem>[];
  const fileCount = validateRegistryItems(items, registryDir, cwd, errors);

  const report: ValidationReport = {
    errors,
    fileCount,
    itemCount: items.length,
    registryFile,
    valid: errors.length === 0,
    warnings,
  };

  return finishReport(report, options.json);
}
