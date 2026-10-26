import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "@/commands/init.js";

describe("init command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `sora-test-init-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { force: true, recursive: true });
    } catch {
      // ignore
    }
  });

  test("refuses to initialize when package.json is missing", async () => {
    const success = await init({ cwd: tempDir, yes: true });
    expect(success).toBe(false);
  });

  test("creates components.json, utils.ts, and global css with default options", async () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { clsx: "^2.0.0", "tailwind-merge": "^3.0.0" },
        name: "my-app",
      }),
      "utf8"
    );

    const success = await init({ cwd: tempDir, defaults: true, yes: true });
    expect(success).toBe(true);

    const componentsJsonPath = join(tempDir, "components.json");
    expect(existsSync(componentsJsonPath)).toBe(true);

    const config = JSON.parse(readFileSync(componentsJsonPath, "utf8"));
    expect(config.style).toBe("new-york-v4");
    expect(config.tailwind.baseColor).toBe("zinc");
    expect(config.aliases.components).toBe("@/components");
    expect(config.aliases.utils).toBe("@/lib/utils");

    const utilsPath = join(tempDir, "lib", "utils.ts");
    expect(existsSync(utilsPath)).toBe(true);

    const cssPath = join(tempDir, config.tailwind.css);
    expect(existsSync(cssPath)).toBe(true);
  });

  test("fails on existing components.json if non-interactive and no force flag", async () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-app" }),
      "utf8"
    );
    writeFileSync(
      join(tempDir, "components.json"),
      JSON.stringify({ style: "legacy" }),
      "utf8"
    );

    // Non-interactive run without force/yes should fail safe
    const success = await init({ cwd: tempDir, force: false, yes: false });
    expect(success).toBe(false);
  });

  test("overwrites existing components.json when --force is provided", async () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { clsx: "^2.0.0", "tailwind-merge": "^3.0.0" },
        name: "my-app",
      }),
      "utf8"
    );
    writeFileSync(
      join(tempDir, "components.json"),
      JSON.stringify({ style: "legacy" }),
      "utf8"
    );

    const success = await init({ cwd: tempDir, force: true, yes: true });
    expect(success).toBe(true);

    const config = JSON.parse(
      readFileSync(join(tempDir, "components.json"), "utf8")
    );
    expect(config.style).toBe("new-york-v4");
  });
});
