import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NO_TTY_PATTERN = /no TTY available/;

const CARD_COMPONENT = {
  dependencies: ["clsx"],
  files: [
    {
      content:
        'import { cn } from "@/lib/utils";\nexport const Card = () => <div className={cn("card")} />;\n',
      path: "card.tsx",
      type: "registry:ui",
    },
  ],
  name: "card",
  registryDependencies: ["utils"],
  type: "registry:ui",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function mockFetch(handler: (url: string) => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) =>
    handler(String(input))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

class FakeChildProcess extends EventEmitter {
  stderr = new EventEmitter();
}

/** Mocks node:child_process's spawn so no real package manager runs. */
function mockSpawn(code = 0) {
  const calls: string[][] = [];
  mock.module("node:child_process", () => ({
    spawn: mock((_cmd: string, args: string[]) => {
      calls.push(args);
      const child = new FakeChildProcess();
      queueMicrotask(() => child.emit("close", code));
      return child;
    }),
  }));
  return calls;
}

let tempDir: string;
let restoreFetch: (() => void) | undefined;
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sora-add-cmd-"));
  delete process.env.SORA_REGISTRY_URL;
  logSpy = spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  rmSync(tempDir, { force: true, recursive: true });
  delete process.env.SORA_REGISTRY_URL;
  mock.restore();
});

describe("add", () => {
  test("returns false and reports an unknown registry", async () => {
    const { add } = await import("@/commands/add.js");

    const ok = await add(["card"], { cwd: tempDir, registry: "nope" });

    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  test("returns false with no TTY and no component names given", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    const { add } = await import("@/commands/add.js");

    const ok = await add([], { cwd: tempDir });

    expect(ok).toBe(false);
    const errOutput = errorSpy.mock.calls
      .map((call: unknown[]) => call.map(String).join(" "))
      .join("\n");
    expect(errOutput).toContain("No components specified");
  });

  test("returns false when component resolution fails", async () => {
    restoreFetch = mockFetch(() => new Response("Not Found", { status: 404 }));
    const { add } = await import("@/commands/add.js");

    const ok = await add(["nonexistent"], { cwd: tempDir, yes: true });

    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  test("dry-run writes nothing and never installs packages", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    const spawnCalls = mockSpawn();
    const { add } = await import("@/commands/add.js");

    const ok = await add(["card"], { cwd: tempDir, dryRun: true, yes: true });

    expect(ok).toBe(true);
    expect(existsSync(join(tempDir, "components/sora-ui/card.tsx"))).toBe(
      false
    );
    expect(existsSync(join(tempDir, "lib/utils.ts"))).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });

  test("--view prints resolved file contents and writes nothing", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    const spawnCalls = mockSpawn();
    const { add } = await import("@/commands/add.js");

    const ok = await add(["card"], { cwd: tempDir, view: true });

    expect(ok).toBe(true);
    expect(existsSync(join(tempDir, "components/sora-ui/card.tsx"))).toBe(
      false
    );
    expect(spawnCalls).toHaveLength(0);
    const output = logSpy.mock.calls
      .map((call: unknown[]) => call.map(String).join(" "))
      .join("\n");
    expect(output).toContain("Card");
  });

  test("writes the component file, ensures utils.ts, and installs deps with --yes --force", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    const spawnCalls = mockSpawn(0);
    const { add } = await import("@/commands/add.js");

    const ok = await add(["card"], { cwd: tempDir, force: true, yes: true });

    expect(ok).toBe(true);
    const written = readFileSync(
      join(tempDir, "components/sora-ui/card.tsx"),
      "utf8"
    );
    expect(written).toContain("Card");
    expect(existsSync(join(tempDir, "lib/utils.ts"))).toBe(true);
    expect(spawnCalls).toContainEqual(["install", "clsx", "tailwind-merge"]);
  });

  test("still returns true when the npm install step fails", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    mockSpawn(1);
    const { add } = await import("@/commands/add.js");

    const ok = await add(["card"], { cwd: tempDir, force: true, yes: true });

    expect(ok).toBe(true);
    expect(existsSync(join(tempDir, "components/sora-ui/card.tsx"))).toBe(true);
  });

  test("does not reinstall dependencies already present in package.json", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { clsx: "^2.0.0", "tailwind-merge": "^3.0.0" },
      }),
      "utf8"
    );
    const spawnCalls = mockSpawn(0);
    const { add } = await import("@/commands/add.js");

    await add(["card"], { cwd: tempDir, force: true, yes: true });

    expect(spawnCalls).toHaveLength(0);
  });

  test("throws when confirmation is required but there's no TTY (not --yes/--dry-run)", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    const { add } = await import("@/commands/add.js");

    await expect(add(["card"], { cwd: tempDir })).rejects.toThrow(
      NO_TTY_PATTERN
    );
  });

  test("skips (does not hang on) a file conflict when there's no TTY and --force wasn't passed", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(tempDir, "components/sora-ui"), { recursive: true });
    const target = join(tempDir, "components/sora-ui/card.tsx");
    writeFileSync(target, "// pre-existing local content, differs\n", "utf8");
    const { add } = await import("@/commands/add.js");

    const ok = await add(["card"], { cwd: tempDir, yes: true });

    expect(ok).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(
      "// pre-existing local content, differs\n"
    );
    const warnOutput = errorSpy.mock.calls
      .map((call: unknown[]) => call.map(String).join(" "))
      .join("\n");
    expect(warnOutput).toContain("no TTY available to prompt");
  });

  test("respects a custom --path for where files are written", async () => {
    restoreFetch = mockFetch(() => jsonResponse(CARD_COMPONENT));
    mockSpawn(0);
    const { add } = await import("@/commands/add.js");

    const ok = await add(["card"], {
      cwd: tempDir,
      force: true,
      path: "custom/components",
      yes: true,
    });

    expect(ok).toBe(true);
    expect(existsSync(join(tempDir, "custom/components/card.tsx"))).toBe(true);
  });
});
