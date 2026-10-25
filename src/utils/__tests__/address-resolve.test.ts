import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig, RegistryItem } from "@/types.js";
import {
  fetchComponentByAddress,
  readFromLocalFile,
} from "@/utils/registry.js";
import { resolveTree } from "@/utils/tree.js";

const tmpDir = join(process.cwd(), ".tmp-test-address-resolve");

const dummyConfig: ProjectConfig = {
  aliasConfigured: true,
  aliases: {
    components: "@/components",
    hooks: "@/hooks",
    lib: "@/lib",
    utils: "@/lib/utils",
  },
  componentPath: "components/sora-ui",
  cwd: tmpDir,
  packageManager: "bun",
  registries: {
    "@custom": "https://custom-registry.example.com/r",
  },
  srcDir: "",
  tsconfigPathsConfigured: true,
};

describe("Local file resolution", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { force: true, recursive: true });
    } catch {
      // cleanup
    }
  });

  test("reads and validates a local component JSON file", async () => {
    const itemPath = join(tmpDir, "local-card.json");
    const itemData: RegistryItem = {
      files: [{ path: "components/ui/card.tsx", type: "registry:ui" }],
      name: "local-card",
      type: "registry:ui",
    };
    writeFileSync(itemPath, JSON.stringify(itemData), "utf8");

    const read = readFromLocalFile("./local-card.json", tmpDir);
    expect(read.name).toBe("local-card");
    expect(read.files).toHaveLength(1);

    const resolved = await fetchComponentByAddress(
      { path: "./local-card.json", scheme: "file" },
      dummyConfig
    );
    expect(resolved.item.name).toBe("local-card");
    expect(resolved.fromShadcn).toBe(false);
  });

  test("resolves tree starting from local file specifier", async () => {
    const childPath = join(tmpDir, "child.json");
    const parentPath = join(tmpDir, "parent.json");

    const childItem: RegistryItem = {
      files: [{ path: "components/ui/child.tsx", type: "registry:ui" }],
      name: "child",
      type: "registry:ui",
    };
    const parentItem: RegistryItem = {
      files: [{ path: "components/ui/parent.tsx", type: "registry:ui" }],
      name: "parent",
      registryDependencies: ["./child.json"],
      type: "registry:ui",
    };

    writeFileSync(childPath, JSON.stringify(childItem), "utf8");
    writeFileSync(parentPath, JSON.stringify(parentItem), "utf8");

    const tree = await resolveTree(
      "./parent.json",
      undefined,
      new Set(),
      undefined,
      false,
      dummyConfig
    );

    expect(tree.item.name).toBe("parent");
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.item.name).toBe("child");
  });
});
