import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComponentAliases, ProjectConfig, RegistryItem } from "@/types.js";
import { diffComponentFiles } from "@/utils/diff.js";

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
  tempDir = mkdtempSync(join(tmpdir(), "sora-diff-"));
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("diffComponentFiles", () => {
  test("reports not-installed when file does not exist", () => {
    const item = makeItem("button", [
      {
        content: "export const Button = () => <button />;",
        path: "button.tsx",
        target: "components/sora-ui/button.tsx",
        type: "registry:ui",
      },
    ]);
    const results = diffComponentFiles(item, makeConfig());
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("not-installed");
    expect(results[0]?.target).toBe("src/components/sora-ui/button.tsx");
  });

  test("reports up-to-date when content matches", () => {
    const content = "export const Card = () => <div />;";
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "card.tsx"), content, "utf8");

    const item = makeItem("card", [
      {
        content,
        path: "card.tsx",
        target: "components/sora-ui/card.tsx",
        type: "registry:ui",
      },
    ]);
    const results = diffComponentFiles(item, makeConfig());
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("up-to-date");
  });

  test("reports up-to-date despite CRLF difference", () => {
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "crlf.tsx"), "line1\r\nline2\r\n", "utf8");

    const item = makeItem("crlf", [
      {
        content: "line1\nline2\n",
        path: "crlf.tsx",
        target: "components/sora-ui/crlf.tsx",
        type: "registry:ui",
      },
    ]);
    const results = diffComponentFiles(item, makeConfig());
    expect(results[0]?.status).toBe("up-to-date");
  });

  test("reports changed with hunks when content differs", () => {
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "old.tsx"), "old content\n", "utf8");

    const item = makeItem("old", [
      {
        content: "new content\n",
        path: "old.tsx",
        target: "components/sora-ui/old.tsx",
        type: "registry:ui",
      },
    ]);
    const results = diffComponentFiles(item, makeConfig());
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("changed");
    expect(results[0]?.hunks).toBeDefined();
    expect(results[0]?.hunks?.length).toBeGreaterThan(0);
  });

  test("applies alias rewriting before comparing", () => {
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(
      join(destDir, "aliased.tsx"),
      'import { cn } from "~/lib/utils";\n',
      "utf8"
    );

    const customAliases: ComponentAliases = {
      components: "~/components",
      hooks: "~/hooks",
      lib: "~/lib",
      utils: "~/lib/utils",
    };

    const item = makeItem("aliased", [
      {
        content: 'import { cn } from "@/lib/utils";\n',
        path: "aliased.tsx",
        target: "components/sora-ui/aliased.tsx",
        type: "registry:ui",
      },
    ]);
    const results = diffComponentFiles(
      item,
      makeConfig({ aliases: customAliases })
    );
    expect(results[0]?.status).toBe("up-to-date");
  });

  test("skips files without content", () => {
    const item = makeItem("partial", [
      { path: "no-content.tsx", type: "registry:ui" },
    ]);
    const results = diffComponentFiles(item, makeConfig());
    expect(results).toHaveLength(0);
  });

  test("rejects unsafe targets", () => {
    const item = makeItem("evil", [
      {
        content: "evil",
        path: "evil.tsx",
        target: "../../../.env",
        type: "registry:ui",
      },
    ]);
    expect(() => diffComponentFiles(item, makeConfig())).toThrow(
      OUTSIDE_PROJECT
    );
  });

  test("handles multiple files with mixed statuses", () => {
    const destDir = join(tempDir, "src/components/sora-ui");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "same.tsx"), "same\n", "utf8");
    writeFileSync(join(destDir, "diff.tsx"), "local\n", "utf8");

    const item = makeItem("multi", [
      {
        content: "same\n",
        path: "same.tsx",
        target: "components/sora-ui/same.tsx",
        type: "registry:ui",
      },
      {
        content: "registry\n",
        path: "diff.tsx",
        target: "components/sora-ui/diff.tsx",
        type: "registry:ui",
      },
      {
        content: "missing\n",
        path: "missing.tsx",
        target: "components/sora-ui/missing.tsx",
        type: "registry:ui",
      },
    ]);
    const results = diffComponentFiles(item, makeConfig());
    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe("up-to-date");
    expect(results[1]?.status).toBe("changed");
    expect(results[2]?.status).toBe("not-installed");
  });
});
