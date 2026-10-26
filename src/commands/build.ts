import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { RegistryFile, RegistryItem } from "@/types.js";
import { done, error, sanitize } from "@/utils/colors.js";
import { spinner } from "@/utils/spinner.js";
import { validate } from "./validate.js";

export interface BuildOptions {
  cwd?: string;
  output?: string;
}

function isPathInside(childPath: string, parentDir: string): boolean {
  const rel = resolve(childPath);
  const root = resolve(parentDir);
  return rel === root || rel.startsWith(root + sep);
}

/**
 * Builds and compiles local registry components into production-ready JSON artifacts
 * compliant with the shadcn registry format.
 */
export function build(
  registryFileArg?: string,
  options: BuildOptions = {}
): boolean {
  const cwd = options.cwd ?? process.cwd();
  const registryFile = resolve(cwd, registryFileArg ?? "registry.json");
  const registryDir = dirname(registryFile);
  const outputDir = resolve(cwd, options.output ?? "public/r");

  // Validate the registry first to guarantee consistency before compiling
  const isValid = validate(registryFileArg, { cwd, json: false });
  if (!isValid) {
    return false;
  }

  const buildSpinner = spinner();
  buildSpinner.start("Building registry artifacts...");

  let root: {
    homepage?: string;
    items: RegistryItem[];
    name: string;
  };

  try {
    const raw = readFileSync(registryFile, "utf8");
    root = JSON.parse(raw);
  } catch (err) {
    buildSpinner.error("Failed to read registry definition");
    error(sanitize((err as Error).message));
    return false;
  }

  try {
    mkdirSync(outputDir, { recursive: true });

    const catalogItems: Array<{
      dependencies?: string[];
      description?: string;
      devDependencies?: string[];
      name: string;
      registryDependencies?: string[];
      title?: string;
      type: string;
    }> = [];

    for (const item of root.items) {
      const compiledFiles: RegistryFile[] = [];

      for (const file of item.files) {
        const filePath = isAbsolute(file.path)
          ? file.path
          : resolve(registryDir, file.path);

        if (!isPathInside(filePath, cwd)) {
          throw new Error(
            `File path "${file.path}" for item "${item.name}" resolves outside project root.`
          );
        }

        const content = readFileSync(filePath, "utf8");
        compiledFiles.push({
          content,
          path: file.path,
          target: file.target,
          type: file.type,
        });
      }

      const compiledItem: RegistryItem = {
        $schema: "https://ui.shadcn.com/schema/registry-item.json",
        css: item.css,
        cssVars: item.cssVars,
        dependencies: item.dependencies,
        description: item.description,
        devDependencies: item.devDependencies,
        files: compiledFiles,
        name: item.name,
        registryDependencies: item.registryDependencies,
        title: item.title,
        type: item.type,
      };

      const itemOutputPath = join(outputDir, `${item.name}.json`);
      mkdirSync(dirname(itemOutputPath), { recursive: true });
      writeFileSync(
        itemOutputPath,
        JSON.stringify(compiledItem, null, 2),
        "utf8"
      );

      catalogItems.push({
        dependencies: item.dependencies,
        description: item.description,
        devDependencies: item.devDependencies,
        name: item.name,
        registryDependencies: item.registryDependencies,
        title: item.title,
        type: item.type,
      });
    }

    const catalog = {
      $schema: "https://ui.shadcn.com/schema/registry.json",
      homepage: root.homepage ?? "",
      items: catalogItems,
      name: root.name,
    };

    writeFileSync(
      join(outputDir, "registry.json"),
      JSON.stringify(catalog, null, 2),
      "utf8"
    );

    buildSpinner.stop("Registry artifacts built successfully");
    done(
      `Built ${root.items.length} component${root.items.length === 1 ? "" : "s"} into ${sanitize(outputDir)}.`
    );
    return true;
  } catch (err) {
    buildSpinner.error("Failed to build registry");
    error(sanitize((err as Error).message));
    return false;
  }
}
