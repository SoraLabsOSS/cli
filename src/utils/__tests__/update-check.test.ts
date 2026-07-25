import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  fetchLatestVersion,
  isNewer,
  parseVersionParts,
  printUpdateNotice,
  startUpdateCheck,
} from "@/utils/update-check.js";

describe("parseVersionParts", () => {
  test("parses standard semver", () => {
    expect(parseVersionParts("1.2.3")).toEqual([1, 2, 3]);
  });

  test("parses two-part version", () => {
    expect(parseVersionParts("2.0")).toEqual([2, 0]);
  });

  test("parses single-part version", () => {
    expect(parseVersionParts("5")).toEqual([5]);
  });

  test("treats non-numeric parts as 0", () => {
    expect(parseVersionParts("1.beta.3")).toEqual([1, 0, 3]);
  });

  test("handles empty string", () => {
    expect(parseVersionParts("")).toEqual([0]);
  });
});

describe("isNewer", () => {
  test("detects major version bump", () => {
    expect(isNewer("2.0.0", "1.9.9")).toBe(true);
  });

  test("detects minor version bump", () => {
    expect(isNewer("1.5.0", "1.4.9")).toBe(true);
  });

  test("detects patch version bump", () => {
    expect(isNewer("1.0.2", "1.0.1")).toBe(true);
  });

  test("returns false for same version", () => {
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
  });

  test("returns false for older version", () => {
    expect(isNewer("1.0.0", "2.0.0")).toBe(false);
  });

  test("handles different length versions", () => {
    expect(isNewer("1.0.1", "1.0")).toBe(true);
    expect(isNewer("1.0", "1.0.0")).toBe(false);
  });

  test("compares numerically not lexicographically", () => {
    expect(isNewer("1.10.0", "1.9.0")).toBe(true);
    expect(isNewer("1.9.0", "1.10.0")).toBe(false);
  });

  test("prerelease suffix splits on dots (quirk: 1.2.3-beta.1 > 1.2.3)", () => {
    expect(parseVersionParts("1.2.3-beta.1")).toEqual([1, 2, 3, 1]);
    expect(isNewer("1.2.3-beta.1", "1.2.3")).toBe(true);
  });

  test("leading v is treated as 0 (parseInt('v1') is NaN)", () => {
    expect(parseVersionParts("v1.2.3")).toEqual([0, 2, 3]);
  });
});

function mockFetch(handler: () => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => handler()) as unknown as typeof fetch;
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
  delete process.env.SORA_NO_UPDATE_CHECK;
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  delete process.env.SORA_NO_UPDATE_CHECK;
});

describe("fetchLatestVersion", () => {
  test("returns the published version even when it isn't newer", async () => {
    restoreFetch = mockFetch(() => jsonResponse({ version: "0.1.0" }));

    expect(await fetchLatestVersion()).toBe("0.1.0");
  });

  test("returns null on a network failure", async () => {
    restoreFetch = mockFetch(() => {
      throw new TypeError("fetch failed");
    });

    expect(await fetchLatestVersion()).toBeNull();
  });

  test("returns null on a non-ok response", async () => {
    restoreFetch = mockFetch(() => new Response("boom", { status: 500 }));

    expect(await fetchLatestVersion()).toBeNull();
  });

  test("still fetches when SORA_NO_UPDATE_CHECK is set (env guard is the caller's job)", async () => {
    process.env.SORA_NO_UPDATE_CHECK = "1";
    restoreFetch = mockFetch(() => jsonResponse({ version: "1.2.3" }));

    expect(await fetchLatestVersion()).toBe("1.2.3");
  });
});

describe("startUpdateCheck", () => {
  test("resolves the latest version when a newer one is published", async () => {
    restoreFetch = mockFetch(() => jsonResponse({ version: "9.9.9" }));

    const latest = await startUpdateCheck("0.1.0");

    expect(latest).toBe("9.9.9");
  });

  test("resolves null when already up to date", async () => {
    restoreFetch = mockFetch(() => jsonResponse({ version: "0.1.0" }));

    const latest = await startUpdateCheck("0.1.0");

    expect(latest).toBeNull();
  });

  test("resolves null when the current version is newer than npm's", async () => {
    restoreFetch = mockFetch(() => jsonResponse({ version: "0.1.0" }));

    const latest = await startUpdateCheck("9.9.9");

    expect(latest).toBeNull();
  });

  test("resolves null on a non-ok response instead of throwing", async () => {
    restoreFetch = mockFetch(() => new Response("boom", { status: 500 }));

    const latest = await startUpdateCheck("0.1.0");

    expect(latest).toBeNull();
  });

  test("resolves null on a network failure instead of throwing", async () => {
    restoreFetch = mockFetch(() => {
      throw new TypeError("fetch failed");
    });

    const latest = await startUpdateCheck("0.1.0");

    expect(latest).toBeNull();
  });

  test("resolves null on a malformed (non-JSON) response", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not json{{{", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })) as unknown as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };

    const latest = await startUpdateCheck("0.1.0");

    expect(latest).toBeNull();
  });

  test("resolves null without fetching when SORA_NO_UPDATE_CHECK is set", async () => {
    process.env.SORA_NO_UPDATE_CHECK = "1";
    let fetchCalled = false;
    restoreFetch = mockFetch(() => {
      fetchCalled = true;
      return jsonResponse({ version: "9.9.9" });
    });

    const latest = await startUpdateCheck("0.1.0");

    expect(latest).toBeNull();
    expect(fetchCalled).toBe(false);
  });
});

describe("printUpdateNotice", () => {
  test("prints to console.error (stderr), including both versions", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    printUpdateNotice("2.0.0", "1.0.0");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const printed = String(errorSpy.mock.calls[0]?.[0]);
    expect(printed).toContain("1.0.0");
    expect(printed).toContain("2.0.0");
    expect(printed).toContain("npm i -g @soralabsoss/sora-cli");

    errorSpy.mockRestore();
  });
});
