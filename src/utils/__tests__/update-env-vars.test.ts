import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryItem } from "@/types.js";
import {
  assertSafeEnvVars,
  collectEnvVars,
  findEnvFile,
  mergeEnvContent,
  parseEnvKeys,
  updateEnvVars,
} from "@/utils/update-env-vars.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sora-env-test-"));
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("assertSafeEnvVars", () => {
  test("allows valid identifiers and single-line values", () => {
    expect(() =>
      assertSafeEnvVars({
        API_KEY: "secret123",
        NEXT_PUBLIC_URL: "https://example.com",
      })
    ).not.toThrow();
  });

  test("rejects invalid env var names", () => {
    expect(() =>
      assertSafeEnvVars({
        "INVALID-NAME": "val",
      })
    ).toThrow('Registry returned an invalid env var name: "INVALID-NAME"');

    expect(() =>
      assertSafeEnvVars({
        "123_KEY": "val",
      })
    ).toThrow('Registry returned an invalid env var name: "123_KEY"');
  });

  test("rejects multiline values to prevent injection", () => {
    expect(() =>
      assertSafeEnvVars({
        KEY: "val1\nEXTRA_INJECTED_KEY=bad",
      })
    ).toThrow("must be a single-line string");

    expect(() =>
      assertSafeEnvVars({
        KEY: "val1\rEXTRA_INJECTED_KEY=bad",
      })
    ).toThrow("must be a single-line string");
  });
});

describe("collectEnvVars", () => {
  test("merges envVars across items with later items winning", () => {
    const items: RegistryItem[] = [
      {
        envVars: {
          API_URL: "https://api.v1.example.com",
          KEY_A: "val-a",
        },
        files: [],
        name: "item-a",
        type: "registry:ui",
      },
      {
        envVars: {
          API_URL: "https://api.v2.example.com",
          KEY_B: "val-b",
        },
        files: [],
        name: "item-b",
        type: "registry:ui",
      },
    ];

    const merged = collectEnvVars(items);
    expect(merged).toEqual({
      API_URL: "https://api.v2.example.com",
      KEY_A: "val-a",
      KEY_B: "val-b",
    });
  });

  test("ignores items without envVars", () => {
    const items: RegistryItem[] = [
      { files: [], name: "item-a", type: "registry:ui" },
    ];
    expect(collectEnvVars(items)).toEqual({});
  });
});

describe("parseEnvKeys", () => {
  test("extracts keys and ignores comments and blank lines", () => {
    const content = `
# Comment
KEY_1=value1
export KEY_2="value2"
  KEY_3=value3

# Another comment
KEY_4=
`;
    const keys = parseEnvKeys(content);
    expect([...keys]).toEqual(["KEY_1", "KEY_2", "KEY_3", "KEY_4"]);
  });
});

describe("mergeEnvContent", () => {
  test("appends only new keys, preserving existing keys and values", () => {
    const existing = "API_KEY=existing-secret\n# Note\n";
    const toAdd = {
      API_KEY: "different-secret",
      NEW_KEY: "default-val",
    };

    const { added, content } = mergeEnvContent(existing, toAdd);
    expect(added).toEqual(["NEW_KEY"]);
    expect(content).toContain("API_KEY=existing-secret");
    expect(content).toContain("NEW_KEY=default-val");
  });

  test("returns unchanged if all keys already exist", () => {
    const existing = "KEY_A=1\nKEY_B=2\n";
    const toAdd = { KEY_A: "3", KEY_B: "4" };
    const { added, content } = mergeEnvContent(existing, toAdd);
    expect(added).toEqual([]);
    expect(content).toBe(existing);
  });
});

describe("findEnvFile", () => {
  test("defaults to .env.local if no file exists", () => {
    expect(findEnvFile(tempDir)).toBe(join(tempDir, ".env.local"));
  });

  test("picks .env.local first if it exists", () => {
    writeFileSync(join(tempDir, ".env.local"), "A=1\n");
    writeFileSync(join(tempDir, ".env"), "B=2\n");
    expect(findEnvFile(tempDir)).toBe(join(tempDir, ".env.local"));
  });

  test("picks .env if .env.local is missing", () => {
    writeFileSync(join(tempDir, ".env"), "B=2\n");
    expect(findEnvFile(tempDir)).toBe(join(tempDir, ".env"));
  });

  test("picks .env.example if others are missing", () => {
    writeFileSync(join(tempDir, ".env.example"), "C=3\n");
    expect(findEnvFile(tempDir)).toBe(join(tempDir, ".env.example"));
  });
});

describe("updateEnvVars", () => {
  test("returns no-vars when envVars is empty", () => {
    const outcome = updateEnvVars({}, tempDir);
    expect(outcome.status).toBe("no-vars");
  });

  test("creates .env.local when no env file exists", () => {
    const outcome = updateEnvVars(
      { STRIPE_SECRET_KEY: "sk_test_123" },
      tempDir
    );
    expect(outcome.status).toBe("updated");
    if (outcome.status === "updated") {
      expect(outcome.added).toEqual(["STRIPE_SECRET_KEY"]);
      expect(outcome.path).toBe(".env.local");
    }

    const created = readFileSync(join(tempDir, ".env.local"), "utf8");
    expect(created).toContain("STRIPE_SECRET_KEY=sk_test_123");
  });

  test("syncs with .env.example if present alongside .env.local", () => {
    writeFileSync(join(tempDir, ".env.local"), "EXISTING=1\n");
    writeFileSync(join(tempDir, ".env.example"), "EXISTING=1\n");

    const outcome = updateEnvVars({ NEW_VAR: "secret" }, tempDir);

    expect(outcome.status).toBe("updated");
    if (outcome.status === "updated") {
      expect(outcome.added).toEqual(["NEW_VAR"]);
      expect(outcome.exampleAdded).toEqual(["NEW_VAR"]);
    }

    expect(readFileSync(join(tempDir, ".env.local"), "utf8")).toContain(
      "NEW_VAR=secret"
    );
    expect(readFileSync(join(tempDir, ".env.example"), "utf8")).toContain(
      "NEW_VAR=secret"
    );
  });

  test("dryRun reports would-update without touching disk", () => {
    const outcome = updateEnvVars({ SECRET: "123" }, tempDir, { dryRun: true });
    expect(outcome.status).toBe("would-update");
    expect(existsSync(join(tempDir, ".env.local"))).toBe(false);
  });

  test("reports unchanged when all variables exist", () => {
    writeFileSync(join(tempDir, ".env.local"), "VAR_A=1\n");
    const outcome = updateEnvVars({ VAR_A: "different" }, tempDir);
    expect(outcome.status).toBe("unchanged");
  });
});
