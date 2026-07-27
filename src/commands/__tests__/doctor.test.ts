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
import { doctor } from "@/commands/doctor.js";

interface CheckResult {
  id: string;
  label: string;
  message: string;
  status: "fail" | "pass" | "warn";
}

const SUMMARY_LINE_PATTERN = /\d+ passed, \d+ warnings?, \d+ failed/;

const REGISTRY_JSON = {
  homepage: "https://ui.soralabs.io.vn",
  items: [],
  name: "sora-ui",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function isNpmRegistryUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "registry.npmjs.org";
  } catch {
    return false;
  }
}

/**
 * doctor() fires both the registry reachability check and the npm
 * update check in parallel — route by host so each can be controlled
 * independently per test.
 */
function mockFetch(options: {
  npmVersion?: string;
  registry?: () => Response;
}) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (isNpmRegistryUrl(url)) {
      return Promise.resolve(
        jsonResponse({ version: options.npmVersion ?? "0.0.1" })
      );
    }
    return Promise.resolve(
      options.registry ? options.registry() : jsonResponse(REGISTRY_JSON)
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function writeJson(dir: string, filename: string, data: unknown) {
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2), "utf8");
}

let tempDir: string;
let restoreFetch: (() => void) | undefined;
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sora-doctor-cmd-"));
  delete process.env.SORA_REGISTRY_URL;
  delete process.env.SORA_NO_UPDATE_CHECK;
  logSpy = spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  rmSync(tempDir, { force: true, recursive: true });
  delete process.env.SORA_REGISTRY_URL;
  delete process.env.SORA_NO_UPDATE_CHECK;
  mock.restore();
});

function getJsonResults(): CheckResult[] {
  const jsonCall = logSpy.mock.calls.find((call: unknown[]) =>
    String(call[0]).trim().startsWith("[")
  );
  return JSON.parse(String(jsonCall?.[0])) as CheckResult[];
}

function resultFor(id: string): CheckResult | undefined {
  return getJsonResults().find((r) => r.id === id);
}

describe("doctor", () => {
  test("passes overall on a clean, fully-configured project", async () => {
    restoreFetch = mockFetch({ npmVersion: "0.0.1" });
    writeJson(tempDir, "package.json", {
      dependencies: { clsx: "^2.0.0", react: "^18.0.0", tailwindcss: "^4.0.0" },
    });
    writeFileSync(join(tempDir, "package-lock.json"), "{}", "utf8");
    writeJson(tempDir, "tsconfig.json", {
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    });
    mkdirSync(join(tempDir, "src"), { recursive: true });

    const ok = await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(ok).toBe(true);
    const results = getJsonResults();
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });

  test("fails overall when the registry is unreachable", async () => {
    restoreFetch = mockFetch({
      npmVersion: "0.0.1",
      registry: () => new Response("boom", { status: 500 }),
    });

    const ok = await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(ok).toBe(false);
    expect(resultFor("registry")?.status).toBe("fail");
  });

  test("warns when multiple lockfiles are present", async () => {
    restoreFetch = mockFetch({});
    writeFileSync(join(tempDir, "package-lock.json"), "{}", "utf8");
    writeFileSync(join(tempDir, "yarn.lock"), "", "utf8");

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("package-manager")?.status).toBe("warn");
  });

  test("does not warn when both bun lockfile formats are present (same manager)", async () => {
    restoreFetch = mockFetch({});
    writeFileSync(join(tempDir, "bun.lock"), "{}", "utf8");
    writeFileSync(join(tempDir, "bun.lockb"), "", "utf8");

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("package-manager")?.status).toBe("pass");
  });

  test("warns instead of a misleading pass when run outside any Node project", async () => {
    restoreFetch = mockFetch({});
    // No package.json/lockfile anywhere — e.g. running `sora doctor` from a
    // bare home directory, not a project at all.

    await doctor("0.0.1", { cwd: tempDir, json: true });

    const projectResult = resultFor("project-root");
    expect(projectResult?.status).toBe("warn");
    expect(projectResult?.message).toContain(
      "doesn't look like a Node.js project"
    );
    const pmResult = resultFor("package-manager");
    expect(pmResult?.status).toBe("warn");
    expect(pmResult?.message).toContain("doesn't look like a Node.js project");
  });

  test("project-root passes when package.json exists anywhere up the tree", async () => {
    restoreFetch = mockFetch({});
    const nested = join(tempDir, "a", "b");
    mkdirSync(nested, { recursive: true });
    writeJson(tempDir, "package.json", { name: "root-only" });

    await doctor("0.0.1", { cwd: nested, json: true });

    expect(resultFor("project-root")?.status).toBe("pass");
  });

  test("fails on invalid components.json", async () => {
    restoreFetch = mockFetch({});
    writeFileSync(join(tempDir, "components.json"), "not json{{{", "utf8");

    const ok = await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(ok).toBe(false);
    expect(resultFor("components-json")?.status).toBe("fail");
  });

  test("warns when components.json aliases isn't an object", async () => {
    restoreFetch = mockFetch({});
    writeJson(tempDir, "components.json", { aliases: "not-an-object" });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("components-json")?.status).toBe("warn");
  });

  test("reports an astro-alias check for astro projects instead of path-alias", async () => {
    restoreFetch = mockFetch({});
    writeFileSync(
      join(tempDir, "astro.config.mjs"),
      "export default {}",
      "utf8"
    );

    await doctor("0.0.1", { cwd: tempDir, json: true });

    const results = getJsonResults();
    expect(results.some((r) => r.id === "astro-alias")).toBe(true);
    expect(results.some((r) => r.id === "path-alias")).toBe(false);
    expect(resultFor("astro-alias")?.status).toBe("warn");
  });

  test("treats a malformed package.json as absent, not fatal", async () => {
    restoreFetch = mockFetch({});
    writeFileSync(join(tempDir, "package.json"), "not json{{{", "utf8");

    const ok = await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(ok).toBe(true);
    expect(resultFor("tailwind")?.status).toBe("warn");
  });

  test("passes astro-alias when the alias is configured", async () => {
    restoreFetch = mockFetch({});
    writeFileSync(
      join(tempDir, "astro.config.mjs"),
      "export default {}",
      "utf8"
    );
    writeJson(tempDir, "tsconfig.json", {
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    });
    mkdirSync(join(tempDir, "src"), { recursive: true });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("astro-alias")?.status).toBe("pass");
  });

  test("warns astro-alias when only components.json aliases exist (Vite needs tsconfig paths)", async () => {
    restoreFetch = mockFetch({});
    writeFileSync(
      join(tempDir, "astro.config.mjs"),
      "export default {}",
      "utf8"
    );
    writeJson(tempDir, "components.json", {
      aliases: { components: "@/components" },
    });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("astro-alias")?.status).toBe("warn");
  });

  test("warns when tailwind is missing", async () => {
    restoreFetch = mockFetch({});
    writeJson(tempDir, "package.json", {});

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("tailwind")?.status).toBe("warn");
  });

  test("warns on a pre-v3 tailwind version", async () => {
    restoreFetch = mockFetch({});
    writeJson(tempDir, "package.json", {
      dependencies: { tailwindcss: "^2.2.19" },
    });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    const result = resultFor("tailwind");
    expect(result?.status).toBe("warn");
    expect(result?.message).toContain("require Tailwind v3 or later");
  });

  test("warns on tailwind v3 without a config file", async () => {
    restoreFetch = mockFetch({});
    writeJson(tempDir, "package.json", {
      dependencies: { tailwindcss: "^3.4.0" },
    });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("tailwind")?.status).toBe("warn");
    expect(resultFor("tailwind")?.message).toContain("no tailwind.config");
  });

  test("passes on tailwind v3 with a config file present", async () => {
    restoreFetch = mockFetch({});
    writeJson(tempDir, "package.json", {
      dependencies: { tailwindcss: "^3.4.0" },
    });
    writeFileSync(
      join(tempDir, "tailwind.config.js"),
      "module.exports = {}",
      "utf8"
    );

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("tailwind")?.status).toBe("pass");
  });

  test("passes on tailwind v4 without requiring a config file", async () => {
    restoreFetch = mockFetch({});
    writeJson(tempDir, "package.json", {
      dependencies: { tailwindcss: "^4.0.0" },
    });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    const result = resultFor("tailwind");
    expect(result?.status).toBe("pass");
    expect(result?.message).toContain("v4 uses CSS-first config");
  });

  test("finds a tailwind v3 config at the monorepo root where the dependency is declared", async () => {
    restoreFetch = mockFetch({});
    const root = join(tempDir, "monorepo");
    const workspacePkg = join(root, "packages", "ui");
    mkdirSync(workspacePkg, { recursive: true });
    writeJson(root, "package.json", {
      devDependencies: { tailwindcss: "^3.4.0" },
    });
    writeFileSync(
      join(root, "tailwind.config.ts"),
      "export default {}",
      "utf8"
    );
    writeJson(workspacePkg, "package.json", { name: "@workspace/ui" });

    await doctor("0.0.1", { cwd: workspacePkg, json: true });

    expect(resultFor("tailwind")?.status).toBe("pass");
  });

  test("ignores a tailwind config above where the dependency is declared", async () => {
    restoreFetch = mockFetch({});
    // Config lives at tempDir, but the dependency is declared one level
    // deeper — an unrelated config above the project must not count.
    writeFileSync(
      join(tempDir, "tailwind.config.js"),
      "module.exports = {}",
      "utf8"
    );
    const project = join(tempDir, "project");
    mkdirSync(project, { recursive: true });
    writeJson(project, "package.json", {
      dependencies: { tailwindcss: "^3.4.0" },
    });

    await doctor("0.0.1", { cwd: project, json: true });

    expect(resultFor("tailwind")?.status).toBe("warn");
    expect(resultFor("tailwind")?.message).toContain("no tailwind.config");
  });

  test("warns when react is missing", async () => {
    restoreFetch = mockFetch({});
    writeJson(tempDir, "package.json", {});

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("react")?.status).toBe("warn");
  });

  test("passes when react is found in dependencies", async () => {
    restoreFetch = mockFetch({});
    writeJson(tempDir, "package.json", {
      dependencies: { react: "^18.2.0" },
    });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    const result = resultFor("react");
    expect(result?.status).toBe("pass");
    expect(result?.message).toContain("18.2.0");
  });

  test("finds tailwind/react in an ancestor package.json (monorepo workspace)", async () => {
    restoreFetch = mockFetch({});
    const workspaceRoot = join(tempDir, "monorepo-root");
    const workspacePkg = join(workspaceRoot, "packages", "ui");
    mkdirSync(workspacePkg, { recursive: true });
    writeJson(workspaceRoot, "package.json", {
      devDependencies: { react: "^19.0.0", tailwindcss: "^4.0.0" },
    });
    // The workspace package itself declares neither — a common pattern
    // where shared devDependencies live only at the monorepo root.
    writeJson(workspacePkg, "package.json", { name: "@workspace/ui" });

    const ok = await doctor("0.0.1", { cwd: workspacePkg, json: true });

    expect(ok).toBe(true);
    const tailwindResult = resultFor("tailwind");
    const reactResult = resultFor("react");
    expect(tailwindResult?.status).toBe("pass");
    expect(tailwindResult?.message).toContain("4.0.0");
    expect(reactResult?.status).toBe("pass");
    expect(reactResult?.message).toContain("19.0.0");
  });

  test("warns when tailwind/react are absent all the way up the ancestor chain", async () => {
    restoreFetch = mockFetch({});
    const nested = join(tempDir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });

    await doctor("0.0.1", { cwd: nested, json: true });

    expect(resultFor("tailwind")?.status).toBe("warn");
    expect(resultFor("react")?.status).toBe("warn");
  });

  test("passes utils-deps when lib/utils.ts isn't installed yet", async () => {
    restoreFetch = mockFetch({});

    await doctor("0.0.1", { cwd: tempDir, json: true });

    const result = resultFor("utils-deps");
    expect(result?.status).toBe("pass");
    expect(result?.message).toContain("not installed yet");
  });

  test("fails utils-deps when lib/utils.ts exists but clsx/tailwind-merge are missing", async () => {
    restoreFetch = mockFetch({});
    mkdirSync(join(tempDir, "lib"), { recursive: true });
    writeFileSync(join(tempDir, "lib", "utils.ts"), "export {}", "utf8");
    writeJson(tempDir, "package.json", {});

    const ok = await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(ok).toBe(false);
    expect(resultFor("utils-deps")?.status).toBe("fail");
  });

  test("checks src/lib/utils.ts when the project uses a src directory", async () => {
    restoreFetch = mockFetch({});
    writeJson(tempDir, "tsconfig.json", {
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    });
    mkdirSync(join(tempDir, "src", "lib"), { recursive: true });
    writeFileSync(join(tempDir, "src", "lib", "utils.ts"), "export {}", "utf8");
    writeJson(tempDir, "package.json", {});

    const ok = await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(ok).toBe(false);
    expect(resultFor("utils-deps")?.status).toBe("fail");
  });

  test("passes utils-deps when clsx/tailwind-merge live at the monorepo root", async () => {
    restoreFetch = mockFetch({});
    const root = join(tempDir, "monorepo");
    const workspacePkg = join(root, "packages", "ui");
    mkdirSync(join(workspacePkg, "lib"), { recursive: true });
    writeJson(root, "package.json", {
      dependencies: { clsx: "^2.0.0", "tailwind-merge": "^2.0.0" },
    });
    writeJson(workspacePkg, "package.json", { name: "@workspace/ui" });
    writeFileSync(join(workspacePkg, "lib", "utils.ts"), "export {}", "utf8");

    await doctor("0.0.1", { cwd: workspacePkg, json: true });

    expect(resultFor("utils-deps")?.status).toBe("pass");
  });

  test("warns with the latest version when a newer sora-cli is published", async () => {
    restoreFetch = mockFetch({ npmVersion: "9.9.9" });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    const result = resultFor("cli-version");
    expect(result?.status).toBe("warn");
    expect(result?.message).toContain("9.9.9");
  });

  test("passes cli-version when already up to date", async () => {
    restoreFetch = mockFetch({ npmVersion: "0.0.1" });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    expect(resultFor("cli-version")?.status).toBe("pass");
  });

  test("skips the npm update check when SORA_NO_UPDATE_CHECK is set", async () => {
    process.env.SORA_NO_UPDATE_CHECK = "1";
    restoreFetch = mockFetch({ npmVersion: "9.9.9" });

    await doctor("0.0.1", { cwd: tempDir, json: true });

    const result = resultFor("cli-version");
    expect(result?.status).toBe("pass");
    expect(result?.message).toContain("disabled via SORA_NO_UPDATE_CHECK");
  });

  test("warns cli-version when npm is unreachable instead of claiming up to date", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (isNpmRegistryUrl(url)) {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve(jsonResponse(REGISTRY_JSON));
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };

    await doctor("0.0.1", { cwd: tempDir, json: true });

    const result = resultFor("cli-version");
    expect(result?.status).toBe("warn");
    expect(result?.message).toContain("couldn't reach npm");
  });

  test("human mode prints a pass/warn/fail summary line, warnings/failures on stderr", async () => {
    restoreFetch = mockFetch({
      registry: () => new Response("boom", { status: 500 }),
    });

    await doctor("0.0.1", { cwd: tempDir, json: false });

    const output = logSpy.mock.calls
      .map((call: unknown[]) => call.map(String).join(" "))
      .join("\n");
    expect(output).toMatch(SUMMARY_LINE_PATTERN);
    expect(output).not.toContain("Registry:");
    const errOutput = errorSpy.mock.calls
      .map((call: unknown[]) => call.map(String).join(" "))
      .join("\n");
    expect(errOutput).toContain("Registry:");
  });

  test("passes through a custom --registry to the reachability check", async () => {
    let requestedUrl = "";
    const original = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (isNpmRegistryUrl(url)) {
        return Promise.resolve(jsonResponse({ version: "0.0.1" }));
      }
      requestedUrl = url;
      return Promise.resolve(jsonResponse(REGISTRY_JSON));
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };

    await doctor("0.0.1", {
      cwd: tempDir,
      json: true,
      registry: "https://custom.example.com",
    });

    expect(requestedUrl).toBe("https://custom.example.com/r/registry.json");
  });
});
