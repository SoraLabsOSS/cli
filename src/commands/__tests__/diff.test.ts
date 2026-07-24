import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diff } from "@/commands/diff.js";
import { detectConfig } from "@/utils/detect.js";

function mockFetch(handler: (url: string) => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) =>
    handler(String(input))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const CARD_CONTENT = 'export const Card = () => <div className="card" />;\n';

const CARD_COMPONENT = {
  files: [
    {
      content: CARD_CONTENT,
      path: "card.tsx",
      type: "registry:ui",
    },
  ],
  name: "card",
  registryDependencies: [],
  type: "registry:ui",
};

let tempDir: string;
let restoreFetch: (() => void) | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sora-diff-cmd-"));
  delete process.env.SORA_REGISTRY_URL;
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  rmSync(tempDir, { force: true, recursive: true });
  delete process.env.SORA_REGISTRY_URL;
  mock.restore();
});

describe("diff", () => {
  test("fails fast when no component names are given", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    const result = await diff([], { cwd: tempDir });

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    const [firstCall] = errorSpy.mock.calls;
    expect(String(firstCall?.[1])).toContain("Specify at least one component");
  });

  test("reports up to date when the local file matches the registry", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    const config = detectConfig(tempDir);
    mkdirSync(join(tempDir, config.componentPath), { recursive: true });
    writeFileSync(
      join(tempDir, config.componentPath, "card.tsx"),
      CARD_CONTENT,
      "utf8"
    );

    const result = await diff(["card"], { cwd: tempDir });

    expect(result).toBe(true);
  });

  test("reports not-installed suffix when files aren't written yet", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));

    const result = await diff(["card"], { cwd: tempDir });

    expect(result).toBe(true);
  });

  test("detects a changed local file", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    const config = detectConfig(tempDir);
    mkdirSync(join(tempDir, config.componentPath), { recursive: true });
    writeFileSync(
      join(tempDir, config.componentPath, "card.tsx"),
      "// locally modified\n",
      "utf8"
    );
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    spyOn(process.stdout, "write").mockImplementation(() => true);

    const result = await diff(["card"], { cwd: tempDir });

    expect(result).toBe(true);
    logSpy.mockRestore();
  });

  test("returns false and reports the error when resolution fails", async () => {
    restoreFetch = mockFetch(() => new Response("Not Found", { status: 404 }));
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    const result = await diff(["nonexistent"], { cwd: tempDir });

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  test("honors a custom --path for target resolution", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    mkdirSync(join(tempDir, "custom"), { recursive: true });
    writeFileSync(join(tempDir, "custom", "card.tsx"), CARD_CONTENT, "utf8");

    const result = await diff(["card"], { cwd: tempDir, path: "custom" });

    expect(result).toBe(true);
  });
});
