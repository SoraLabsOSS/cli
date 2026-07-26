import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getMonorepoTargets,
  isMonorepoRoot,
  parsePnpmWorkspacePackages,
} from "@/utils/monorepo.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sora-monorepo-"));
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("isMonorepoRoot", () => {
  test("false for a plain project", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({}));
    expect(isMonorepoRoot(tempDir)).toBe(false);
  });

  test("true when pnpm-workspace.yaml is present", () => {
    writeFileSync(
      join(tempDir, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n"
    );
    expect(isMonorepoRoot(tempDir)).toBe(true);
  });

  test("true when package.json has a workspaces field", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] })
    );
    expect(isMonorepoRoot(tempDir)).toBe(true);
  });

  test("true when package.json workspaces is the {packages:[]} form", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ workspaces: { packages: ["packages/*"] } })
    );
    expect(isMonorepoRoot(tempDir)).toBe(true);
  });

  test("true when lerna.json is present", () => {
    writeFileSync(join(tempDir, "lerna.json"), "{}");
    expect(isMonorepoRoot(tempDir)).toBe(true);
  });

  test("true when nx.json is present", () => {
    writeFileSync(join(tempDir, "nx.json"), "{}");
    expect(isMonorepoRoot(tempDir)).toBe(true);
  });

  test("false when directory has no package.json at all", () => {
    expect(isMonorepoRoot(tempDir)).toBe(false);
  });

  test("ignores a malformed package.json instead of throwing", () => {
    writeFileSync(join(tempDir, "package.json"), "{not json");
    expect(() => isMonorepoRoot(tempDir)).not.toThrow();
    expect(isMonorepoRoot(tempDir)).toBe(false);
  });
});

describe("parsePnpmWorkspacePackages", () => {
  test("parses a simple packages list", () => {
    const content = "packages:\n  - apps/*\n  - packages/*\n";
    expect(parsePnpmWorkspacePackages(content)).toEqual([
      "apps/*",
      "packages/*",
    ]);
  });

  test("strips quotes and trailing comments", () => {
    const content = "packages:\n  - \"apps/*\" # comment\n  - 'packages/*'\n";
    expect(parsePnpmWorkspacePackages(content)).toEqual([
      "apps/*",
      "packages/*",
    ]);
  });

  test("stops collecting once a sibling key starts", () => {
    const content = "packages:\n  - apps/*\nother:\n  - ignored\n";
    expect(parsePnpmWorkspacePackages(content)).toEqual(["apps/*"]);
  });

  test("returns empty for content with no packages key", () => {
    expect(parsePnpmWorkspacePackages("other:\n  - foo\n")).toEqual([]);
  });
});

describe("getMonorepoTargets", () => {
  test("finds workspace dirs with their own package.json", () => {
    mkdirSync(join(tempDir, "apps/web"), { recursive: true });
    writeFileSync(join(tempDir, "apps/web/package.json"), "{}");
    mkdirSync(join(tempDir, "apps/empty"), { recursive: true });
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ workspaces: ["apps/*"] })
    );

    const targets = getMonorepoTargets(tempDir);

    expect(targets).toEqual([{ hasConfig: false, name: "apps/web" }]);
  });

  test("reports hasConfig true when a workspace already has components.json", () => {
    mkdirSync(join(tempDir, "apps/web"), { recursive: true });
    writeFileSync(join(tempDir, "apps/web/package.json"), "{}");
    writeFileSync(join(tempDir, "apps/web/components.json"), "{}");
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ workspaces: ["apps/*"] })
    );

    const targets = getMonorepoTargets(tempDir);

    expect(targets).toEqual([{ hasConfig: true, name: "apps/web" }]);
  });

  test("returns empty when there are no workspace patterns", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({}));
    expect(getMonorepoTargets(tempDir)).toEqual([]);
  });
});
