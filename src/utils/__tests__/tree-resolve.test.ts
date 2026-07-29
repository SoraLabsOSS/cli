import { describe, expect, mock, test } from "bun:test";
import type { RegistryItem } from "@/types.js";

const makeItem = (
  name: string,
  overrides?: Partial<RegistryItem>
): RegistryItem => ({
  files: [],
  name,
  type: "registry:ui",
  ...overrides,
});

/**
 * resolveTree calls fetchComponent/fetchShadcnComponent from registry.ts,
 * which do real network fetches — mock the module so cycle-detection/dedup
 * and the shadcn fallback can be exercised without a live registry. The
 * mocked ComponentNotFoundError class must be the one thrown by the mocked
 * fetchers, since tree.ts's instanceof check sees the mocked module.
 */
class MockComponentNotFoundError extends Error {}

function mockFetchComponent(
  items: Record<string, RegistryItem>,
  shadcnItems: Record<string, RegistryItem> = {}
) {
  const calls: string[] = [];
  const shadcnCalls: string[] = [];
  mock.module("@/utils/registry.js", () => ({
    ComponentNotFoundError: MockComponentNotFoundError,
    fetchComponent: mock((name: string) => {
      calls.push(name);
      const item = items[name];
      if (!item) {
        throw new MockComponentNotFoundError(`Component "${name}" not found.`);
      }
      return Promise.resolve(item);
    }),
    fetchShadcnComponent: mock((name: string) => {
      shadcnCalls.push(name);
      const item = shadcnItems[name];
      if (!item) {
        throw new MockComponentNotFoundError(
          `Component "${name}" not found in the shadcn/ui base registry.`
        );
      }
      return Promise.resolve(item);
    }),
  }));
  return { calls, shadcnCalls };
}

describe("resolveTree", () => {
  test("resolves a linear dependency chain", async () => {
    mockFetchComponent({
      a: makeItem("a", { registryDependencies: ["b"] }),
      b: makeItem("b"),
    });
    const { resolveTree } = await import("@/utils/tree.js");

    const tree = await resolveTree("a");

    expect(tree.item.name).toBe("a");
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.item.name).toBe("b");
  });

  test("does not infinite-loop on a direct cycle (a -> b -> a)", async () => {
    mockFetchComponent({
      a: makeItem("a", { registryDependencies: ["b"] }),
      b: makeItem("b", { registryDependencies: ["a"] }),
    });
    const { resolveTree } = await import("@/utils/tree.js");

    const tree = await resolveTree("a");

    expect(tree.item.name).toBe("a");
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.item.name).toBe("b");
    // b -> a is the cycle edge; it must be dropped, not re-descended.
    expect(tree.children[0]?.children).toHaveLength(0);
  });

  test("does not infinite-loop on a self-referencing dependency", async () => {
    mockFetchComponent({
      a: makeItem("a", { registryDependencies: ["a"] }),
    });
    const { resolveTree } = await import("@/utils/tree.js");

    const tree = await resolveTree("a");

    expect(tree.item.name).toBe("a");
    expect(tree.children).toHaveLength(0);
  });

  test("fetches a shared dependency only once (dedup)", async () => {
    const { calls } = mockFetchComponent({
      a: makeItem("a", { registryDependencies: ["shared", "b"] }),
      b: makeItem("b", { registryDependencies: ["shared"] }),
      shared: makeItem("shared"),
    });
    const { resolveTree } = await import("@/utils/tree.js");

    await resolveTree("a");

    expect(calls.filter((name) => name === "shared")).toHaveLength(1);
  });

  test("skips the shadcn base 'utils' dependency", async () => {
    mockFetchComponent({
      a: makeItem("a", { registryDependencies: ["utils"] }),
    });
    const { resolveTree } = await import("@/utils/tree.js");

    const tree = await resolveTree("a");

    expect(tree.children).toHaveLength(0);
  });

  test("strips namespace prefix from registry dependency refs", async () => {
    const { calls } = mockFetchComponent({
      button: makeItem("button", {
        registryDependencies: ["@soralabs/utils-helper"],
      }),
      "utils-helper": makeItem("utils-helper"),
    });
    const { resolveTree } = await import("@/utils/tree.js");

    const tree = await resolveTree("button");

    expect(calls).toEqual(["button", "utils-helper"]);
    expect(tree.children[0]?.item.name).toBe("utils-helper");
  });

  test("falls back to the shadcn registry for a bare dep the product registry lacks", async () => {
    const { shadcnCalls } = mockFetchComponent(
      {
        "stagger-button": makeItem("stagger-button", {
          registryDependencies: ["utils", "button"],
        }),
      },
      { button: makeItem("button") }
    );
    const { resolveTree } = await import("@/utils/tree.js");

    const tree = await resolveTree("stagger-button");

    expect(shadcnCalls).toEqual(["button"]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.item.name).toBe("button");
  });

  test("resolves a shadcn item's own deps from the shadcn registry directly", async () => {
    const { calls, shadcnCalls } = mockFetchComponent(
      {
        a: makeItem("a", { registryDependencies: ["dialog"] }),
      },
      {
        button: makeItem("button"),
        dialog: makeItem("dialog", { registryDependencies: ["button"] }),
      }
    );
    const { resolveTree } = await import("@/utils/tree.js");

    const tree = await resolveTree("a");

    expect(calls).toEqual(["a", "dialog"]);
    expect(shadcnCalls).toEqual(["dialog", "button"]);
    expect(tree.children[0]?.children[0]?.item.name).toBe("button");
  });

  test("does not fall back to shadcn for namespaced refs", async () => {
    const { shadcnCalls } = mockFetchComponent(
      {
        a: makeItem("a", { registryDependencies: ["@soralabs/missing"] }),
      },
      { missing: makeItem("missing") }
    );
    const { resolveTree } = await import("@/utils/tree.js");

    await expect(resolveTree("a")).rejects.toThrow(
      'Component "missing" not found.'
    );
    expect(shadcnCalls).toEqual([]);
  });

  test("throws the product registry error when shadcn lacks the dep too", async () => {
    const { shadcnCalls } = mockFetchComponent({
      a: makeItem("a", { registryDependencies: ["ghost"] }),
    });
    const { resolveTree } = await import("@/utils/tree.js");

    await expect(resolveTree("a")).rejects.toThrow(
      'Component "ghost" not found.'
    );
    expect(shadcnCalls).toEqual(["ghost"]);
  });
});
