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
 * resolveTree calls fetchComponent from registry.ts, which itself does a
 * real network fetch — mock the module so cycle-detection/dedup can be
 * exercised without a live registry.
 */
function mockFetchComponent(items: Record<string, RegistryItem>) {
  const calls: string[] = [];
  mock.module("@/utils/registry.js", () => ({
    fetchComponent: mock((name: string) => {
      calls.push(name);
      const item = items[name];
      if (!item) {
        throw new Error(`Component "${name}" not found.`);
      }
      return Promise.resolve(item);
    }),
  }));
  return calls;
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
    const calls = mockFetchComponent({
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
    const calls = mockFetchComponent({
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
});
