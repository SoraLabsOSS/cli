import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "@/commands/validate.js";

describe("validate command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `sora-test-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

  test("fails when registry.json is not found", async () => {
    const valid = await validate("nonexistent.json", {
      cwd: tempDir,
      json: true,
    });
    expect(valid).toBe(false);
  });

  test("fails on invalid JSON syntax", async () => {
    const filePath = join(tempDir, "registry.json");
    writeFileSync(filePath, "{ invalid json", "utf8");

    const valid = await validate("registry.json", { cwd: tempDir, json: true });
    expect(valid).toBe(false);
  });

  test("fails when root is missing name or items", async () => {
    const filePath = join(tempDir, "registry.json");
    writeFileSync(
      filePath,
      JSON.stringify({ homepage: "https://example.com" }),
      "utf8"
    );

    const valid = await validate("registry.json", { cwd: tempDir, json: true });
    expect(valid).toBe(false);
  });

  test("fails when component referenced file does not exist on disk", async () => {
    const filePath = join(tempDir, "registry.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        homepage: "https://example.com",
        items: [
          {
            files: [{ path: "components/missing.tsx", type: "registry:ui" }],
            name: "button",
            type: "registry:ui",
          },
        ],
        name: "test-registry",
      }),
      "utf8"
    );

    const valid = await validate("registry.json", { cwd: tempDir, json: true });
    expect(valid).toBe(false);
  });

  test("fails on duplicate component names", async () => {
    const compPath = join(tempDir, "button.tsx");
    writeFileSync(compPath, "export const Button = () => null;", "utf8");

    const filePath = join(tempDir, "registry.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        homepage: "https://example.com",
        items: [
          {
            files: [{ path: "button.tsx", type: "registry:ui" }],
            name: "button",
            type: "registry:ui",
          },
          {
            files: [{ path: "button.tsx", type: "registry:ui" }],
            name: "button",
            type: "registry:ui",
          },
        ],
        name: "test-registry",
      }),
      "utf8"
    );

    const valid = await validate("registry.json", { cwd: tempDir, json: true });
    expect(valid).toBe(false);
  });

  test("fails on circular self-referencing registryDependencies", async () => {
    const compPath = join(tempDir, "button.tsx");
    writeFileSync(compPath, "export const Button = () => null;", "utf8");

    const filePath = join(tempDir, "registry.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        homepage: "https://example.com",
        items: [
          {
            files: [{ path: "button.tsx", type: "registry:ui" }],
            name: "button",
            registryDependencies: ["button"],
            type: "registry:ui",
          },
        ],
        name: "test-registry",
      }),
      "utf8"
    );

    const valid = await validate("registry.json", { cwd: tempDir, json: true });
    expect(valid).toBe(false);
  });

  test("passes on a well-formed registry definition", async () => {
    const compPath = join(tempDir, "button.tsx");
    writeFileSync(compPath, "export const Button = () => null;", "utf8");

    const filePath = join(tempDir, "registry.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        homepage: "https://example.com",
        items: [
          {
            dependencies: ["clsx"],
            files: [{ path: "button.tsx", type: "registry:ui" }],
            name: "button",
            title: "Button",
            type: "registry:ui",
          },
        ],
        name: "test-registry",
      }),
      "utf8"
    );

    const valid = await validate("registry.json", { cwd: tempDir, json: true });
    expect(valid).toBe(true);
  });
});
