import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectConfig,
  getInstalledDependencyNames,
  isAstroProject,
} from "@/utils/detect.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sora-detect-"));
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

function writeJson(filename: string, data: unknown) {
  writeFileSync(join(tempDir, filename), JSON.stringify(data, null, 2), "utf8");
}

describe("isAstroProject", () => {
  test("detects astro.config.mjs", () => {
    writeFileSync(
      join(tempDir, "astro.config.mjs"),
      "export default {}",
      "utf8"
    );
    expect(isAstroProject(tempDir)).toBe(true);
  });

  test("detects astro.config.ts", () => {
    writeFileSync(
      join(tempDir, "astro.config.ts"),
      "export default {}",
      "utf8"
    );
    expect(isAstroProject(tempDir)).toBe(true);
  });

  test("returns false for non-astro project", () => {
    expect(isAstroProject(tempDir)).toBe(false);
  });
});

describe("getInstalledDependencyNames", () => {
  test("unions dependencies, devDependencies, and peerDependencies", () => {
    writeJson("package.json", {
      dependencies: { clsx: "^2.0.0", react: "^18.0.0" },
      devDependencies: { "@types/react": "^18.0.0" },
      peerDependencies: { "react-dom": "^18.0.0" },
    });
    const result = getInstalledDependencyNames(tempDir);
    expect(result.has("react")).toBe(true);
    expect(result.has("clsx")).toBe(true);
    expect(result.has("@types/react")).toBe(true);
    expect(result.has("react-dom")).toBe(true);
    expect(result.size).toBe(4);
  });

  test("returns empty set when no package.json", () => {
    expect(getInstalledDependencyNames(tempDir).size).toBe(0);
  });

  test("returns empty set for malformed package.json", () => {
    writeFileSync(join(tempDir, "package.json"), "not json{{{", "utf8");
    expect(getInstalledDependencyNames(tempDir).size).toBe(0);
  });

  test("handles package.json with no dependency fields", () => {
    writeJson("package.json", { name: "bare", version: "1.0.0" });
    expect(getInstalledDependencyNames(tempDir).size).toBe(0);
  });
});

describe("detectConfig", () => {
  test("detects bun from bun.lock", () => {
    writeFileSync(join(tempDir, "bun.lock"), "", "utf8");
    writeJson("package.json", { name: "test" });
    const config = detectConfig(tempDir);
    expect(config.packageManager).toBe("bun");
  });

  test("detects pnpm from pnpm-lock.yaml", () => {
    writeFileSync(join(tempDir, "pnpm-lock.yaml"), "", "utf8");
    const config = detectConfig(tempDir);
    expect(config.packageManager).toBe("pnpm");
  });

  test("detects yarn from yarn.lock", () => {
    writeFileSync(join(tempDir, "yarn.lock"), "", "utf8");
    const config = detectConfig(tempDir);
    expect(config.packageManager).toBe("yarn");
  });

  test("detects npm from package-lock.json", () => {
    writeFileSync(join(tempDir, "package-lock.json"), "{}", "utf8");
    const config = detectConfig(tempDir);
    expect(config.packageManager).toBe("npm");
  });

  test("detects packageManager field in package.json", () => {
    writeJson("package.json", { packageManager: "pnpm@9.1.0" });
    const config = detectConfig(tempDir);
    expect(config.packageManager).toBe("pnpm");
  });

  test("defaults to npm when no lockfile found", () => {
    const config = detectConfig(tempDir);
    expect(config.packageManager).toBe("npm");
  });

  test("detects alias from tsconfig paths", () => {
    writeJson("tsconfig.json", {
      compilerOptions: {
        paths: { "@/*": ["./src/*"] },
      },
    });
    mkdirSync(join(tempDir, "src"));
    const config = detectConfig(tempDir);
    expect(config.aliasConfigured).toBe(true);
    expect(config.aliases.components).toBe("@/components");
    expect(config.aliases.hooks).toBe("@/hooks");
    expect(config.aliases.lib).toBe("@/lib");
    expect(config.aliases.utils).toBe("@/lib/utils");
    expect(config.srcDir).toBe("src");
  });

  test("detects custom alias prefix", () => {
    writeJson("tsconfig.json", {
      compilerOptions: {
        paths: { "~/*": ["./src/*"] },
      },
    });
    mkdirSync(join(tempDir, "src"));
    const config = detectConfig(tempDir);
    expect(config.aliases.components).toBe("~/components");
  });

  test("reads per-category aliases from components.json", () => {
    writeJson("components.json", {
      aliases: {
        components: "~/ui",
        hooks: "~/shared/hooks",
        lib: "~/shared/lib",
        utils: "~/shared/lib/utils",
      },
    });
    const config = detectConfig(tempDir);
    expect(config.aliasConfigured).toBe(true);
    expect(config.aliases.components).toBe("~/ui");
    expect(config.aliases.hooks).toBe("~/shared/hooks");
    expect(config.aliases.utils).toBe("~/shared/lib/utils");
  });

  test("components.json overrides tsconfig alias", () => {
    writeJson("tsconfig.json", {
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    });
    writeJson("components.json", {
      aliases: { components: "@/custom-components" },
    });
    mkdirSync(join(tempDir, "src"));
    const config = detectConfig(tempDir);
    expect(config.aliases.components).toBe("@/custom-components");
    expect(config.aliases.hooks).toBe("@/hooks");
  });

  test("defaults alias to @ when no tsconfig", () => {
    const config = detectConfig(tempDir);
    expect(config.aliasConfigured).toBe(false);
    expect(config.aliases.components).toBe("@/components");
  });

  test("detects srcDir from tsconfig target", () => {
    writeJson("tsconfig.json", {
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    });
    mkdirSync(join(tempDir, "src"));
    const config = detectConfig(tempDir);
    expect(config.srcDir).toBe("src");
    expect(config.componentPath).toBe("src/components/sora-ui");
  });

  test("no srcDir when target is not src/", () => {
    writeJson("tsconfig.json", {
      compilerOptions: { paths: { "@/*": ["./*"] } },
    });
    const config = detectConfig(tempDir);
    expect(config.srcDir).toBe("");
    expect(config.componentPath).toBe("components/sora-ui");
  });

  test("infers srcDir from directory existence without tsconfig", () => {
    mkdirSync(join(tempDir, "src"));
    const config = detectConfig(tempDir);
    expect(config.srcDir).toBe("src");
  });

  test("handles malformed tsconfig gracefully", () => {
    writeFileSync(join(tempDir, "tsconfig.json"), "not json{{{", "utf8");
    const config = detectConfig(tempDir);
    expect(config.aliasConfigured).toBe(false);
    expect(config.aliases.components).toBe("@/components");
  });

  test("lockfile in parent directory is found", () => {
    const child = join(tempDir, "packages", "ui");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(tempDir, "bun.lock"), "", "utf8");
    const config = detectConfig(child);
    expect(config.packageManager).toBe("bun");
  });
});
