import { describe, expect, test } from "bun:test";
import type { RegistryItem } from "@/types.js";
import {
  collectNpmDeps,
  flattenTree,
  type ResolvedNode,
} from "@/utils/tree.js";

const makeItem = (
  name: string,
  overrides?: Partial<RegistryItem>
): RegistryItem => ({
  files: [],
  name,
  type: "registry:ui",
  ...overrides,
});

describe("flattenTree", () => {
  test("returns single item for leaf node", () => {
    const node: ResolvedNode = { children: [], item: makeItem("button") };
    expect(flattenTree(node)).toEqual([makeItem("button")]);
  });

  test("returns children before parent (depth-first post-order)", () => {
    const child: ResolvedNode = { children: [], item: makeItem("utils") };
    const parent: ResolvedNode = {
      children: [child],
      item: makeItem("button"),
    };
    const result = flattenTree(parent);
    expect(result.map((i) => i.name)).toEqual(["utils", "button"]);
  });

  test("flattens deeply nested tree", () => {
    const grandchild: ResolvedNode = { children: [], item: makeItem("c") };
    const child: ResolvedNode = { children: [grandchild], item: makeItem("b") };
    const root: ResolvedNode = { children: [child], item: makeItem("a") };
    expect(flattenTree(root).map((i) => i.name)).toEqual(["c", "b", "a"]);
  });

  test("handles multiple children", () => {
    const child1: ResolvedNode = { children: [], item: makeItem("dep1") };
    const child2: ResolvedNode = { children: [], item: makeItem("dep2") };
    const root: ResolvedNode = {
      children: [child1, child2],
      item: makeItem("root"),
    };
    expect(flattenTree(root).map((i) => i.name)).toEqual([
      "dep1",
      "dep2",
      "root",
    ]);
  });
});

describe("collectNpmDeps", () => {
  test("collects dependencies from multiple items", () => {
    const items = [
      makeItem("a", { dependencies: ["react", "clsx"] }),
      makeItem("b", { dependencies: ["clsx", "tailwind-merge"] }),
    ];
    const result = collectNpmDeps(items);
    expect(result.dependencies).toEqual(["react", "clsx", "tailwind-merge"]);
  });

  test("deduplicates dependencies", () => {
    const items = [
      makeItem("a", { dependencies: ["react"] }),
      makeItem("b", { dependencies: ["react"] }),
    ];
    expect(collectNpmDeps(items).dependencies).toEqual(["react"]);
  });

  test("collects devDependencies separately", () => {
    const items = [
      makeItem("a", {
        dependencies: ["react"],
        devDependencies: ["@types/react"],
      }),
    ];
    const result = collectNpmDeps(items);
    expect(result.dependencies).toEqual(["react"]);
    expect(result.devDependencies).toEqual(["@types/react"]);
  });

  test("handles items with no dependencies", () => {
    const items = [makeItem("a"), makeItem("b")];
    const result = collectNpmDeps(items);
    expect(result.dependencies).toEqual([]);
    expect(result.devDependencies).toEqual([]);
  });

  test("handles empty items array", () => {
    const result = collectNpmDeps([]);
    expect(result.dependencies).toEqual([]);
    expect(result.devDependencies).toEqual([]);
  });
});
