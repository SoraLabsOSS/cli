import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseAddArgs,
  parseDiffArgs,
  parseDoctorArgs,
  parseListArgs,
  resolveCwd,
} from "@/utils/args.js";

describe("parseAddArgs", () => {
  test("parses boolean flags as false by default", () => {
    const parsed = parseAddArgs([]);
    expect(parsed.force).toBe(false);
    expect(parsed.yes).toBe(false);
    expect(parsed["dry-run"]).toBe(false);
    expect(parsed.silent).toBe(false);
    expect(parsed.view).toBe(false);
  });

  test("parses long boolean flags", () => {
    const parsed = parseAddArgs([
      "--force",
      "--yes",
      "--dry-run",
      "--silent",
      "--view",
    ]);
    expect(parsed.force).toBe(true);
    expect(parsed.yes).toBe(true);
    expect(parsed["dry-run"]).toBe(true);
    expect(parsed.silent).toBe(true);
    expect(parsed.view).toBe(true);
  });

  test("parses short boolean flag aliases", () => {
    const parsed = parseAddArgs(["-f", "-y", "-s"]);
    expect(parsed.force).toBe(true);
    expect(parsed.yes).toBe(true);
    expect(parsed.silent).toBe(true);
  });

  test("short boolean aliases before positionals do not swallow names", () => {
    const parsed = parseAddArgs(["-f", "-y", "-s", "card", "accordion"]);
    expect(parsed.force).toBe(true);
    expect(parsed.yes).toBe(true);
    expect(parsed.silent).toBe(true);
    expect(parsed._.map(String)).toEqual(["card", "accordion"]);
  });

  test("parses string flags", () => {
    const parsed = parseAddArgs([
      "--path",
      "src/ui",
      "--registry",
      "ui",
      "--cwd",
      "packages/ui",
    ]);
    expect(parsed.path).toBe("src/ui");
    expect(parsed.registry).toBe("ui");
    expect(parsed.cwd).toBe("packages/ui");
  });

  test("string flags are undefined when not provided", () => {
    const parsed = parseAddArgs([]);
    expect(parsed.path).toBeUndefined();
    expect(parsed.registry).toBeUndefined();
    expect(parsed.cwd).toBeUndefined();
  });

  test("collects positional args in _", () => {
    const parsed = parseAddArgs([
      "card",
      "--force",
      "accordion",
      "--path",
      "src/ui",
      "tooltip",
    ]);
    expect(parsed._.map(String)).toEqual(["card", "accordion", "tooltip"]);
    expect(parsed.force).toBe(true);
    expect(parsed.path).toBe("src/ui");
  });

  test("returns empty _ when only flags are given", () => {
    const parsed = parseAddArgs(["--force", "--yes"]);
    expect(parsed._).toEqual([]);
  });

  test("resolves -c alias to cwd", () => {
    const parsed = parseAddArgs(["-c", "packages/ui"]);
    expect(parsed.cwd).toBe("packages/ui");
  });
});

describe("parseListArgs", () => {
  test("parses --json as false by default", () => {
    const parsed = parseListArgs([]);
    expect(parsed.json).toBe(false);
  });

  test("parses --json flag", () => {
    const parsed = parseListArgs(["--json"]);
    expect(parsed.json).toBe(true);
  });

  test("parses --registry string flag", () => {
    const parsed = parseListArgs(["--registry", "ui"]);
    expect(parsed.registry).toBe("ui");
  });
});

describe("parseDiffArgs", () => {
  test("parses string flags", () => {
    const parsed = parseDiffArgs([
      "--path",
      "src/ui",
      "--registry",
      "ui",
      "--cwd",
      "packages/ui",
    ]);
    expect(parsed.path).toBe("src/ui");
    expect(parsed.registry).toBe("ui");
    expect(parsed.cwd).toBe("packages/ui");
  });

  test("collects positional component names", () => {
    const parsed = parseDiffArgs(["card", "accordion", "--path", "src/ui"]);
    expect(parsed._.map(String)).toEqual(["card", "accordion"]);
  });

  test("resolves -c alias to cwd", () => {
    const parsed = parseDiffArgs(["-c", "packages/ui", "card"]);
    expect(parsed.cwd).toBe("packages/ui");
    expect(parsed._.map(String)).toEqual(["card"]);
  });
});

describe("parseDoctorArgs", () => {
  test("parses --json as false by default", () => {
    const parsed = parseDoctorArgs([]);
    expect(parsed.json).toBe(false);
  });

  test("parses --json and string flags together", () => {
    const parsed = parseDoctorArgs([
      "--json",
      "--registry",
      "ui",
      "--cwd",
      "packages/ui",
    ]);
    expect(parsed.json).toBe(true);
    expect(parsed.registry).toBe("ui");
    expect(parsed.cwd).toBe("packages/ui");
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
