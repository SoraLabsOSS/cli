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
import { initMcpClient } from "@/commands/mcp.js";

describe("mcp command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `sora-test-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

  test("rejects unknown client name", async () => {
    const success = await initMcpClient({ client: "unknown-ai", cwd: tempDir });
    expect(success).toBe(false);
  });

  test("configures cursor mcp in .cursor/mcp.json", async () => {
    const success = await initMcpClient({ client: "cursor", cwd: tempDir });
    expect(success).toBe(true);

    const configPath = join(tempDir, ".cursor", "mcp.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.mcpServers.sora).toBeDefined();
    expect(config.mcpServers.sora.command).toBe("npx");
    expect(config.mcpServers.sora.args).toEqual(["@soralabs/cli", "mcp"]);
  });

  test("configures claude mcp in .mcp.json", async () => {
    const success = await initMcpClient({ client: "claude", cwd: tempDir });
    expect(success).toBe(true);

    const configPath = join(tempDir, ".mcp.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.mcpServers.sora).toBeDefined();
  });

  test("configures vscode mcp under servers key in .vscode/mcp.json", async () => {
    const success = await initMcpClient({ client: "vscode", cwd: tempDir });
    expect(success).toBe(true);

    const configPath = join(tempDir, ".vscode", "mcp.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.servers.sora).toBeDefined();
  });

  test("configures antigravity mcp in .antigravity/mcp.json", async () => {
    const success = await initMcpClient({
      client: "antigravity",
      cwd: tempDir,
    });
    expect(success).toBe(true);

    const configPath = join(tempDir, ".antigravity", "mcp.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.mcpServers.sora).toBeDefined();
  });

  test("preserves existing mcp servers when updating configuration", async () => {
    const configDir = join(tempDir, ".cursor");
    mkdirSync(configDir, { recursive: true });
    const initialConfig = {
      mcpServers: {
        otherTool: {
          args: ["serve"],
          command: "other-cli",
        },
      },
    };
    writeFileSync(
      join(configDir, "mcp.json"),
      JSON.stringify(initialConfig),
      "utf8"
    );

    const success = await initMcpClient({ client: "cursor", cwd: tempDir });
    expect(success).toBe(true);

    const config = JSON.parse(
      readFileSync(join(configDir, "mcp.json"), "utf8")
    );
    expect(config.mcpServers.otherTool).toBeDefined();
    expect(config.mcpServers.sora).toBeDefined();
  });
});
