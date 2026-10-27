import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { search } from "@/commands/search.js";

const MOCK_REGISTRY = {
  homepage: "https://ui.soralabs.studio",
  items: [
    {
      description: "Smooth interactive text animation effect.",
      name: "text-effect",
      title: "Text Effect",
      type: "registry:ui",
    },
    {
      description: "Interactive button with ripple effect.",
      name: "button",
      title: "Button",
      type: "registry:ui",
    },
    {
      description: "Custom debounced state hook.",
      name: "use-debounce",
      title: "useDebounce",
      type: "registry:hook",
    },
    {
      description: "Internal preview component.",
      name: "demo-text-effect",
      title: "Demo Text Effect",
      type: "registry:ui",
    },
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

describe("search command", () => {
  test("searches by query string matching name, title, or description", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_REGISTRY));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    const ok = await search({ query: "animation" });
    expect(ok).toBe(true);

    const output = logSpy.mock.calls
      .map((call) => call.map(String).join(" "))
      .join("\n");
    expect(output).toContain("text-effect");
    expect(output).not.toContain("button");
    expect(output).not.toContain("use-debounce");
  });

  test("filters by item type", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_REGISTRY));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    await search({ type: "hook" });

    const output = logSpy.mock.calls
      .map((call) => call.map(String).join(" "))
      .join("\n");
    expect(output).toContain("use-debounce");
    expect(output).not.toContain("text-effect");
    expect(output).not.toContain("button");
  });

  test("outputs json when --json is passed", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_REGISTRY));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    await search({ json: true, query: "button" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("button");
  });

  test("respects result limits", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_REGISTRY));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    await search({ json: true, limit: 1 });

    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed).toHaveLength(1);
  });

  test("reports when no items match", async () => {
    restoreFetch = mockFetch(() => jsonResponse(MOCK_REGISTRY));
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

    const ok = await search({ query: "nonexistent-widget" });
    expect(ok).toBe(true);

    const output = logSpy.mock.calls
      .map((call) => call.map(String).join(" "))
      .join("\n");
    expect(output).toContain(
      'No components found matching "nonexistent-widget"'
    );
  });
});
