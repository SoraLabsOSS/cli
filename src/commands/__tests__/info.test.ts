import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { info } from "@/commands/info.js";

const MOCK_ITEM = {
  dependencies: ["motion", "clsx"],
  description: "An animated text component.",
  devDependencies: ["@types/react"],
  files: [{ path: "components/text-effect.tsx", type: "registry:ui" }],
  name: "text-effect",
  registryDependencies: ["button"],
  title: "Text Effect",
  type: "registry:ui",
};

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

let restoreFetch: (() => void) | undefined;

beforeEach(() => {
  delete process.env.SORA_REGISTRY_URL;
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  delete process.env.SORA_REGISTRY_URL;
  mock.restore();
});

describe("info command", () => {
  test("returns false when component name is missing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );
    const ok = await info({});
    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  test("displays component metadata and dependencies", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_ITEM));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    const ok = await info({ component: "text-effect" });
    expect(ok).toBe(true);

    const output = logSpy.mock.calls
      .map((call) => call.map(String).join(" "))
      .join("\n");
    expect(output).toContain("text-effect");
    expect(output).toContain("motion, clsx");
    expect(output).toContain("button");
    expect(output).toContain("npx @soralabs/cli add text-effect");
  });

  test("outputs json when --json is passed", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_ITEM));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    const ok = await info({ component: "text-effect", json: true });
    expect(ok).toBe(true);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed.name).toBe("text-effect");
    expect(parsed.dependencies).toEqual(["motion", "clsx"]);
  });
});
