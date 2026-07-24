import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseComponentArgs, parseFlag, resolveCwd } from "@/utils/args.js";

describe("parseFlag", () => {
  test("returns value after matching flag", () => {
    expect(parseFlag(["--registry", "ui", "--force"], "--registry")).toBe("ui");
  });

  test("returns undefined when flag not present", () => {
    expect(parseFlag(["--force", "--yes"], "--registry")).toBeUndefined();
  });

  test("supports multiple flag aliases", () => {
    expect(parseFlag(["-c", "packages/ui"], "--cwd", "-c")).toBe("packages/ui");
  });

  test("matches first alias found", () => {
    expect(parseFlag(["--cwd", "a", "-c", "b"], "--cwd", "-c")).toBe("a");
  });

  test("returns undefined for empty arg list", () => {
    expect(parseFlag([], "--registry")).toBeUndefined();
  });

  test("returns undefined when flag is last arg with no value", () => {
    expect(parseFlag(["--registry"], "--registry")).toBeUndefined();
  });

  test("does not match partial flag names", () => {
    expect(parseFlag(["--registry-url", "x"], "--registry")).toBeUndefined();
  });

  test("returns next arg even if it looks like a flag", () => {
    expect(parseFlag(["--registry", "--force"], "--registry")).toBe("--force");
  });

  test("returns first occurrence when flag is duplicated", () => {
    expect(
      parseFlag(["--registry", "a", "--registry", "b"], "--registry")
    ).toBe("a");
  });
});

describe("resolveCwd", () => {
  test("returns process.cwd() when no cwd is given", () => {
    expect(resolveCwd(undefined)).toBe(process.cwd());
  });

  test("resolves an existing relative directory to an absolute path", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sora-args-"));
    try {
      const parent = resolve(tempDir, "..");
      const relative = tempDir.slice(parent.length + 1);
      expect(resolveCwd(join(parent, relative))).toBe(resolve(tempDir));
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  test("returns null and prints an error for a nonexistent directory", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    const result = resolveCwd("./definitely-does-not-exist-xyz");

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("returns null when the path exists but is a file, not a directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sora-args-file-"));
    const filePath = join(tempDir, "not-a-dir.txt");
    try {
      writeFileSync(filePath, "hi", "utf8");
      const errorSpy = spyOn(console, "error").mockImplementation(
        () => undefined
      );

      expect(resolveCwd(filePath)).toBeNull();

      errorSpy.mockRestore();
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

describe("parseComponentArgs", () => {
  test("returns positional args, excluding flags", () => {
    expect(parseComponentArgs(["card", "--force", "accordion"])).toEqual([
      "card",
      "accordion",
    ]);
  });

  test("excludes the value following a value-taking flag", () => {
    expect(
      parseComponentArgs(["--registry", "ui", "card", "--path", "src/ui"])
    ).toEqual(["card"]);
  });

  test("excludes values for --cwd and its -c alias", () => {
    expect(parseComponentArgs(["--cwd", "packages/ui", "card"])).toEqual([
      "card",
    ]);
    expect(parseComponentArgs(["-c", "packages/ui", "card"])).toEqual(["card"]);
  });

  test("returns an empty array when only flags are given", () => {
    expect(parseComponentArgs(["--force", "--yes"])).toEqual([]);
  });

  test("returns an empty array for an empty list", () => {
    expect(parseComponentArgs([])).toEqual([]);
  });

  test("treats a value-taking flag's value as positional if it appears first", () => {
    // "card" is not preceded by anything, so it's always positional.
    expect(parseComponentArgs(["card"])).toEqual(["card"]);
  });

  test("keeps multiple component names", () => {
    expect(
      parseComponentArgs(["card", "accordion", "--force", "tooltip"])
    ).toEqual(["card", "accordion", "tooltip"]);
  });
});
