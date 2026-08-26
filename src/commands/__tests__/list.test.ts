import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { list } from "@/commands/list.js";

const REGISTRY_NOT_FOUND = /Registry not found/;

const MOCK_REGISTRY = {
  homepage: "https://ui.soralabs.studio",
  items: [
    { description: "A card.", name: "card", type: "registry:ui" },
    { name: "demo-card", type: "registry:ui" },
    { name: "use-hook", type: "registry:hook" },
  ],
  name: "sora-ui",
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

describe("list", () => {
  test("--json prints only the filtered items as JSON on stdout", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_REGISTRY));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    await list({ json: true });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(printed).toEqual([
      { description: "A card.", name: "card", type: "registry:ui" },
    ]);
  });

  test("human mode prints a summary line and each component", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_REGISTRY));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    await list({ json: false });

    const output = logSpy.mock.calls
      .map((call) => call.map(String).join(" "))
      .join("\n");
    expect(output).toContain("1 components available from sora-ui");
    expect(output).toContain("card");
    expect(output).toContain("A card.");
    expect(output).not.toContain("demo-card");
    expect(output).not.toContain("use-hook");
  });

  test("excludes registry:hook items and demo- prefixed items", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_REGISTRY));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    await list({ json: true });

    const printed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(printed).toHaveLength(1);
  });

  test("propagates registry fetch failures", async () => {
    restoreFetch = mockFetch(() => new Response("Not Found", { status: 404 }));

    await expect(list({ json: true })).rejects.toThrow(REGISTRY_NOT_FOUND);
  });

  test("passes through a custom registry URL", async () => {
    let requestedUrl = "";
    restoreFetch = mockFetch((url) => {
      requestedUrl = url;
      return jsonResponse(MOCK_REGISTRY);
    });
    spyOn(console, "log").mockImplementation(() => undefined);

    await list({ json: true, registry: "https://custom.example.com" });

    expect(requestedUrl).toBe("https://custom.example.com/r/registry.json");
  });
});
