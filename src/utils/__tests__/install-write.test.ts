import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComponentAliases, ProjectConfig, RegistryItem } from "@/types.js";
import { ensureUtils, writeComponent } from "@/utils/install.js";

const OUTSIDE_PROJECT = /outside the project/;

const ALIASES: ComponentAliases = {
  components: "@/components",
  hooks: "@/hooks",
  lib: "@/lib",
  utils: "@/lib/utils",
};

let tempDir: string;

function makeConfig(overrides?: Partial<ProjectConfig>): ProjectConfig {
  return {
    aliasConfigured: true,
    aliases: ALIASES,
    componentPath: "src/components/sora-ui",
    cwd: tempDir,
    packageManager: "bun",
    srcDir: "src",
    tsconfigPathsConfigured: true,
    ...overrides,
  };
}

function makeItem(name: string, files: RegistryItem["files"]): RegistryItem {
  return { files, name, type: "registry:ui" };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sora-test-"));
});

afterEach(() => {
  const { rmSync } = require("node:fs");
  rmSync(tempDir, { force: true, recursive: true });
});

describe("ensureUtils", () => {
  test("writes lib/utils.ts when it does not exist", () => {
    const result = ensureUtils(tempDir, "src");
    expect(result).toBe("written");
    const destPath = join(tempDir, "src", "lib", "utils.ts");
    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath, "utf8")).toContain("export function cn");
  });

  test("returns exists when file already present", () => {
    const libDir = join(tempDir, "src", "lib");
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, "utils.ts"), "existing", "utf8");
    expect(ensureUtils(tempDir, "src")).toBe("exists");
  });

  test("dry run does not write to disk", () => {
    const result = ensureUtils(tempDir, "src", true);
    expect(result).toBe("written");
    expect(existsSync(join(tempDir, "src", "lib", "utils.ts"))).toBe(false);
  });

  test("works with empty srcDir", () => {
    const result = ensureUtils(tempDir, "");
    expect(result).toBe("written");
    expect(existsSync(join(tempDir, "lib", "utils.ts"))).toBe(true);
  });
});

describe("writeComponent", () => {
  const noConflict = async () => "overwrite" as const;

  test("writes a new component file", async () => {
    const item = makeItem("button", [
      {
        content:
          'import { cn } from "@/lib/utils";\nexport const Button = () => <button />;',
        path: "button.tsx",
        target: "components/sora-ui/button.tsx",
        type: "registry:ui",
      },
    ]);
    const config = makeConfig();
    const result = await writeComponent(item, config, false, noConflict);
    expect(result.written).toEqual(["src/components/sora-ui/button.tsx"]);
    expect(result.skipped).toEqual([]);
    expect(result.unchanged).toEqual([]);

    const written = readFileSync(
      join(tempDir, "src/components/sora-ui/button.tsx"),
      "utf8"
    );
    expect(written).toContain('import { cn } from "@/lib/utils";');
  });

  test("reports unchanged when content matches", async () => {
    const content = "export const Foo = () => null;";
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "foo.tsx"), content, "utf8");

    const item = makeItem("foo", [
      {
        content,
        path: "foo.tsx",
        target: "components/sora-ui/foo.tsx",
        type: "registry:ui",
      },
    ]);
    const result = await writeComponent(item, makeConfig(), false, noConflict);
    expect(result.unchanged).toEqual(["src/components/sora-ui/foo.tsx"]);
    expect(result.written).toEqual([]);
  });

  test("treats CRLF vs LF as unchanged", async () => {
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "bar.tsx"), "line1\r\nline2\r\n", "utf8");

    const item = makeItem("bar", [
      {
        content: "line1\nline2\n",
        path: "bar.tsx",
        target: "components/sora-ui/bar.tsx",
        type: "registry:ui",
      },
    ]);
    const result = await writeComponent(item, makeConfig(), false, noConflict);
    expect(result.unchanged).toEqual(["src/components/sora-ui/bar.tsx"]);
  });

  test("skips file when onConflict returns skip", async () => {
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "baz.tsx"), "old content", "utf8");

    const item = makeItem("baz", [
      {
        content: "new content",
        path: "baz.tsx",
        target: "components/sora-ui/baz.tsx",
        type: "registry:ui",
      },
    ]);
    const skipConflict = async () => "skip" as const;
    const result = await writeComponent(
      item,
      makeConfig(),
      false,
      skipConflict
    );
    expect(result.skipped).toEqual(["src/components/sora-ui/baz.tsx"]);
    expect(readFileSync(join(destDir, "baz.tsx"), "utf8")).toBe("old content");
  });

  test("overwriteAll propagates to subsequent files", async () => {
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "a.tsx"), "old-a", "utf8");
    writeFileSync(join(destDir, "b.tsx"), "old-b", "utf8");

    const item = makeItem("multi", [
      {
        content: "new-a",
        path: "a.tsx",
        target: "components/sora-ui/a.tsx",
        type: "registry:ui",
      },
      {
        content: "new-b",
        path: "b.tsx",
        target: "components/sora-ui/b.tsx",
        type: "registry:ui",
      },
    ]);

    let callCount = 0;
    const allConflict = () => {
      callCount += 1;
      return Promise.resolve("all" as const);
    };

    const result = await writeComponent(item, makeConfig(), false, allConflict);
    expect(result.written).toEqual([
      "src/components/sora-ui/a.tsx",
      "src/components/sora-ui/b.tsx",
    ]);
    expect(callCount).toBe(1);
  });

  test("force overwrite skips conflict prompt entirely", async () => {
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "c.tsx"), "old", "utf8");

    const item = makeItem("c", [
      {
        content: "new",
        path: "c.tsx",
        target: "components/sora-ui/c.tsx",
        type: "registry:ui",
      },
    ]);

    let prompted = false;
    const spy = () => {
      prompted = true;
      return Promise.resolve("overwrite" as const);
    };

    const result = await writeComponent(item, makeConfig(), true, spy);
    expect(result.written).toEqual(["src/components/sora-ui/c.tsx"]);
    expect(prompted).toBe(false);
  });

  test("dry run does not write to disk", async () => {
    const item = makeItem("dry", [
      {
        content: "content",
        path: "dry.tsx",
        target: "components/sora-ui/dry.tsx",
        type: "registry:ui",
      },
    ]);
    const result = await writeComponent(
      item,
      makeConfig(),
      false,
      noConflict,
      true
    );
    expect(result.written).toEqual(["src/components/sora-ui/dry.tsx"]);
    expect(existsSync(join(tempDir, "src/components/sora-ui/dry.tsx"))).toBe(
      false
    );
  });

  test("rejects unsafe targets before writing anything", async () => {
    const item = makeItem("evil", [
      {
        content: "safe",
        path: "safe.tsx",
        target: "components/sora-ui/safe.tsx",
        type: "registry:ui",
      },
      {
        content: "evil",
        path: "evil.tsx",
        target: "../../../.bashrc",
        type: "registry:ui",
      },
    ]);
    await expect(
      writeComponent(item, makeConfig(), false, noConflict)
    ).rejects.toThrow(OUTSIDE_PROJECT);
    expect(existsSync(join(tempDir, "src/components/sora-ui/safe.tsx"))).toBe(
      false
    );
  });

  test("skips files without content", async () => {
    const item = makeItem("partial", [
      {
        content: "real content",
        path: "real.tsx",
        target: "components/sora-ui/real.tsx",
        type: "registry:ui",
      },
      { path: "no-content.tsx", type: "registry:ui" },
    ]);
    const result = await writeComponent(item, makeConfig(), false, noConflict);
    expect(result.written).toEqual(["src/components/sora-ui/real.tsx"]);
  });

  test("rewrites aliases in written content", async () => {
    const customAliases: ComponentAliases = {
      components: "~/ui",
      hooks: "~/hooks",
      lib: "~/lib",
      utils: "~/lib/utils",
    };
    const item = makeItem("aliased", [
      {
        content:
          'import { cn } from "@/lib/utils";\nimport { Button } from "@/components/button";',
        path: "aliased.tsx",
        target: "components/sora-ui/aliased.tsx",
        type: "registry:ui",
      },
    ]);
    const config = makeConfig({ aliases: customAliases });
    await writeComponent(item, config, false, noConflict);
    const written = readFileSync(
      join(tempDir, "src/components/sora-ui/aliased.tsx"),
      "utf8"
    );
    expect(written).toContain('import { cn } from "~/lib/utils";');
    expect(written).toContain('import { Button } from "~/ui/button";');
  });
});
