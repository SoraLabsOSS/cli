import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

const UNSAFE_DEP = /unsafe dependency/;
const TEST_CWD = "/workspace/packages/ui";

/**
 * installDependencies shells out via node:child_process's `spawn` — mock it
 * so failure/stderr-capture behavior can be exercised without actually
 * invoking a package manager.
 */
class FakeChildProcess extends EventEmitter {
  stderr = new EventEmitter();
}

function mockSpawn(
  behavior: (args: string[]) => {
    code: number;
    stderr?: string;
    spawnError?: Error;
  }
) {
  const calls: string[][] = [];
  const options: { cwd?: string }[] = [];
  mock.module("node:child_process", () => ({
    spawn: mock((_cmd: string, args: string[], opts: { cwd?: string } = {}) => {
      calls.push(args);
      options.push(opts);
      const child = new FakeChildProcess();
      const { code, stderr, spawnError } = behavior(args);
      queueMicrotask(() => {
        if (spawnError) {
          child.emit("error", spawnError);
          return;
        }
        if (stderr) {
          child.stderr.emit("data", Buffer.from(stderr));
        }
        child.emit("close", code);
      });
      return child;
    }),
  }));
  return { calls, options };
}

describe("installDependencies", () => {
  test("resolves ok when the package manager exits 0", async () => {
    mockSpawn(() => ({ code: 0 }));
    const { installDependencies } = await import("@/utils/install.js");

    const result = await installDependencies(["react"], [], "npm", TEST_CWD);

    expect(result).toEqual({ ok: true });
  });

  test("captures stderr when the package manager exits non-zero", async () => {
    mockSpawn(() => ({
      code: 1,
      stderr: "npm error code E404\nnpm error 404 Not Found",
    }));
    const { installDependencies } = await import("@/utils/install.js");

    const result = await installDependencies(
      ["nonexistent-pkg"],
      [],
      "npm",
      TEST_CWD
    );

    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("npm error code E404\nnpm error 404 Not Found");
  });

  test("surfaces spawn errors (e.g. package manager not installed)", async () => {
    mockSpawn(() => ({
      code: 1,
      spawnError: new Error("spawn npm ENOENT"),
    }));
    const { installDependencies } = await import("@/utils/install.js");

    const result = await installDependencies(["react"], [], "npm", TEST_CWD);

    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("spawn npm ENOENT");
  });

  test("returns ok with no stderr when the command fails silently", async () => {
    mockSpawn(() => ({ code: 1 }));
    const { installDependencies } = await import("@/utils/install.js");

    const result = await installDependencies(["react"], [], "npm", TEST_CWD);

    expect(result).toEqual({ ok: false, stderr: undefined });
  });

  test("skips the devDependencies install when dependencies install fails", async () => {
    const { calls } = mockSpawn((args) => ({
      code: args.includes("-D") ? 0 : 1,
    }));
    const { installDependencies } = await import("@/utils/install.js");

    const result = await installDependencies(
      ["react"],
      ["@types/react"],
      "npm",
      TEST_CWD
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("runs a separate install for dependencies and devDependencies", async () => {
    const { calls } = mockSpawn(() => ({ code: 0 }));
    const { installDependencies } = await import("@/utils/install.js");

    const result = await installDependencies(
      ["react"],
      ["@types/react"],
      "npm",
      TEST_CWD
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      ["install", "react"],
      ["install", "-D", "@types/react"],
    ]);
  });

  test("rejects unsafe dependency names before spawning anything", async () => {
    const { calls } = mockSpawn(() => ({ code: 0 }));
    const { installDependencies } = await import("@/utils/install.js");

    await expect(
      installDependencies(["--registry=evil"], [], "npm", TEST_CWD)
    ).rejects.toThrow(UNSAFE_DEP);
    expect(calls).toHaveLength(0);
  });

  test("uses the right add args per package manager", async () => {
    const { calls } = mockSpawn(() => ({ code: 0 }));
    const { installDependencies } = await import("@/utils/install.js");

    await installDependencies(["motion"], [], "pnpm", TEST_CWD);

    expect(calls).toEqual([["add", "motion"]]);
  });

  test("spawns the package manager in the given cwd, not the process cwd", async () => {
    const { options } = mockSpawn(() => ({ code: 0 }));
    const { installDependencies } = await import("@/utils/install.js");

    await installDependencies(["react"], [], "npm", TEST_CWD);

    expect(options[0]?.cwd).toBe(TEST_CWD);
    expect(options[0]?.cwd).not.toBe(process.cwd());
  });
});
