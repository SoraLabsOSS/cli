import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "@/commands/build.js";

describe("build command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `sora-test-build-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { force: true, recursive: true });
    } catch {
      // ignore
    }
  });

  test("fails if registry validation fails", async () => {
    const success = await build("nonexistent.json", { cwd: tempDir });
    expect(success).toBe(false);
  });

  test("compiles valid registry definition and embeds file contents", async () => {
    const compDir = join(tempDir, "components");
    mkdirSync(compDir, { recursive: true });
    const compContent =
      "export function TextEffect() { return <span>effect</span>; }";
    writeFileSync(join(compDir, "text-effect.tsx"), compContent, "utf8");

    const registryData = {
      homepage: "https://ui.soralabs.studio",
      items: [
        {
          dependencies: ["motion"],
          files: [
            {
              path: "components/text-effect.tsx",
              target: "components/ui/text-effect.tsx",
              type: "registry:ui",
            },
          ],
          name: "text-effect",
          title: "Text Effect",
          type: "registry:ui",
        },
      ],
      name: "sora-ui",
    };

    writeFileSync(
      join(tempDir, "registry.json"),
      JSON.stringify(registryData, null, 2),
      "utf8"
    );

    const success = await build("registry.json", {
      cwd: tempDir,
      output: "dist/r",
    });

    expect(success).toBe(true);

    const itemArtifactPath = join(tempDir, "dist", "r", "text-effect.json");
    expect(existsSync(itemArtifactPath)).toBe(true);

    const itemJson = JSON.parse(readFileSync(itemArtifactPath, "utf8"));
    expect(itemJson.name).toBe("text-effect");
    expect(itemJson.files[0].content).toBe(compContent);
    expect(itemJson.files[0].target).toBe("components/ui/text-effect.tsx");

    const catalogPath = join(tempDir, "dist", "r", "registry.json");
    expect(existsSync(catalogPath)).toBe(true);
    const catalogJson = JSON.parse(readFileSync(catalogPath, "utf8"));
    expect(catalogJson.name).toBe("sora-ui");
    expect(catalogJson.items.length).toBe(1);
    expect(catalogJson.items[0].name).toBe("text-effect");
  });
});
