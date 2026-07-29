import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ComponentNotFoundError,
  fetchComponent,
  fetchRegistry,
  fetchShadcnComponent,
  getAvailableComponents,
} from "@/utils/registry.js";

const REGISTRY_NOT_FOUND = /Registry not found/;
const RATE_LIMITED = /429.*rate limited/;
const COULD_NOT_REACH = /Could not reach/;
const TIMED_OUT = /timed out after 15s/;
const INVALID_JSON = /invalid JSON/;
const MALFORMED_REGISTRY = /Malformed registry/;
const COMPONENT_NOT_FOUND = /Component "nonexistent" not found/;
const MALFORMED_COMPONENT = /Malformed component/;
const SHADCN_NOT_FOUND = /not found in the shadcn\/ui base registry/;

const MOCK_REGISTRY = {
  homepage: "https://ui.soralabs.io.vn",
  items: [
    { name: "text-effect", type: "registry:ui" },
    { name: "demo-text-effect", type: "registry:ui" },
    { name: "use-hook", type: "registry:hook" },
    { name: "card", type: "registry:ui" },
  ],
  name: "sora-ui",
};

const MOCK_COMPONENT = {
  files: [
    {
      content: "export const Card = () => <div />;",
      path: "card.tsx",
      type: "registry:ui",
    },
  ],
  name: "card",
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

let restore: (() => void) | undefined;

beforeEach(() => {
  delete process.env.SORA_REGISTRY_URL;
});

afterEach(() => {
  restore?.();
  restore = undefined;
  delete process.env.SORA_REGISTRY_URL;
});

describe("fetchRegistry", () => {
  test("returns parsed registry on success", async () => {
    restore = mockFetch((url) => {
      expect(url).toContain("/r/registry.json");
      return jsonResponse(MOCK_REGISTRY);
    });
    const result = await fetchRegistry();
    expect(result.name).toBe("sora-ui");
    expect(result.items).toHaveLength(4);
  });

  test("throws on 404", async () => {
    restore = mockFetch(() => new Response("Not Found", { status: 404 }));
    await expect(fetchRegistry()).rejects.toThrow(REGISTRY_NOT_FOUND);
  });

  test("throws with detail on non-2xx", async () => {
    restore = mockFetch(
      () =>
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          statusText: "Too Many Requests",
        })
    );
    await expect(fetchRegistry()).rejects.toThrow(RATE_LIMITED);
  });

  test("throws on network failure", async () => {
    restore = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchRegistry()).rejects.toThrow(COULD_NOT_REACH);
  });

  test("throws a clear timeout message when the request times out", async () => {
    restore = mockFetch(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(fetchRegistry()).rejects.toThrow(TIMED_OUT);
  });

  test("throws on invalid JSON", async () => {
    restore = mockFetch(
      () =>
        new Response("not json{{{", {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
    );
    await expect(fetchRegistry()).rejects.toThrow(INVALID_JSON);
  });

  test("throws on malformed registry shape", async () => {
    restore = mockFetch(() => jsonResponse({ foo: "bar" }));
    await expect(fetchRegistry()).rejects.toThrow(MALFORMED_REGISTRY);
  });
});

describe("fetchComponent", () => {
  test("returns parsed component on success", async () => {
    restore = mockFetch((url) => {
      expect(url).toContain("/r/card.json");
      return jsonResponse(MOCK_COMPONENT);
    });
    const result = await fetchComponent("card");
    expect(result.name).toBe("card");
    expect(result.files).toHaveLength(1);
  });

  test("throws helpful message on 404", async () => {
    restore = mockFetch(() => new Response("Not Found", { status: 404 }));
    await expect(fetchComponent("nonexistent")).rejects.toThrow(
      COMPONENT_NOT_FOUND
    );
  });

  test("throws ComponentNotFoundError specifically on 404", async () => {
    restore = mockFetch(() => new Response("Not Found", { status: 404 }));
    await expect(fetchComponent("nonexistent")).rejects.toBeInstanceOf(
      ComponentNotFoundError
    );
  });

  test("throws on malformed component shape", async () => {
    restore = mockFetch(() => jsonResponse({ name: "x" }));
    await expect(fetchComponent("x")).rejects.toThrow(MALFORMED_COMPONENT);
  });
});

describe("fetchShadcnComponent", () => {
  const SHADCN_BUTTON = {
    dependencies: ["radix-ui"],
    files: [
      {
        content: "export const Button = () => <button />;",
        path: "registry/new-york-v4/ui/button.tsx",
        type: "registry:ui",
      },
    ],
    name: "button",
    type: "registry:ui",
  };

  test("fetches from the shadcn base registry and synthesizes targets", async () => {
    restore = mockFetch((url) => {
      expect(url).toBe(
        "https://ui.shadcn.com/r/styles/new-york-v4/button.json"
      );
      return jsonResponse(SHADCN_BUTTON);
    });
    const result = await fetchShadcnComponent("button");
    expect(result.files[0]?.target).toBe("components/ui/button.tsx");
  });

  test("keeps an existing target untouched", async () => {
    restore = mockFetch(() =>
      jsonResponse({
        ...SHADCN_BUTTON,
        files: [{ ...SHADCN_BUTTON.files[0], target: "custom/place.tsx" }],
      })
    );
    const result = await fetchShadcnComponent("button");
    expect(result.files[0]?.target).toBe("custom/place.tsx");
  });

  test("uses the project's shadcn style when provided", async () => {
    restore = mockFetch((url) => {
      expect(url).toBe("https://ui.shadcn.com/r/styles/radix-nova/button.json");
      return jsonResponse(SHADCN_BUTTON);
    });
    const result = await fetchShadcnComponent("button", "radix-nova");
    expect(result.name).toBe("button");
  });

  test("falls back to the default style when the styled variant is missing", async () => {
    const urls: string[] = [];
    restore = mockFetch((url) => {
      urls.push(url);
      if (url.includes("/custom-style/")) {
        return new Response("Not Found", { status: 404 });
      }
      return jsonResponse(SHADCN_BUTTON);
    });
    const result = await fetchShadcnComponent("button", "custom-style");
    expect(result.name).toBe("button");
    expect(urls).toEqual([
      "https://ui.shadcn.com/r/styles/custom-style/button.json",
      "https://ui.shadcn.com/r/styles/new-york-v4/button.json",
    ]);
  });

  test("throws ComponentNotFoundError on 404", async () => {
    restore = mockFetch(() => new Response("Not Found", { status: 404 }));
    await expect(fetchShadcnComponent("ghost")).rejects.toBeInstanceOf(
      ComponentNotFoundError
    );
    restore();
    restore = mockFetch(() => new Response("Not Found", { status: 404 }));
    await expect(fetchShadcnComponent("ghost")).rejects.toThrow(
      SHADCN_NOT_FOUND
    );
  });
});

describe("getAvailableComponents", () => {
  test("filters to registry:ui and excludes demo- prefix", async () => {
    restore = mockFetch(() => jsonResponse(MOCK_REGISTRY));
    const result = await getAvailableComponents();
    expect(result).toEqual(["text-effect", "card"]);
  });

  test("returns empty array when no ui components", async () => {
    restore = mockFetch(() =>
      jsonResponse({ homepage: "", items: [], name: "empty" })
    );
    const result = await getAvailableComponents();
    expect(result).toEqual([]);
  });
});
