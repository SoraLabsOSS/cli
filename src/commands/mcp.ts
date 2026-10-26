import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { select } from "@clack/prompts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "@/mcp/server.js";
import { bar, done, error, sanitize } from "@/utils/colors.js";

export type McpClient =
  | "cursor"
  | "claude"
  | "vscode"
  | "antigravity"
  | "windsurf";

export interface McpOptions {
  client?: string;
  cwd?: string;
}

interface ClientMeta {
  description: string;
  key: "mcpServers" | "servers";
  label: string;
  path: string;
}

const CLIENT_DEFINITIONS: Record<McpClient, ClientMeta> = {
  antigravity: {
    description: "Antigravity IDE / Agent MCP config",
    key: "mcpServers",
    label: "Antigravity",
    path: ".antigravity/mcp.json",
  },
  claude: {
    description: "Claude Code / Claude Desktop MCP config",
    key: "mcpServers",
    label: "Claude Code",
    path: ".mcp.json",
  },
  cursor: {
    description: "Cursor AI editor configuration",
    key: "mcpServers",
    label: "Cursor",
    path: ".cursor/mcp.json",
  },
  vscode: {
    description: "VS Code with Copilot / MCP extension",
    key: "servers",
    label: "VS Code",
    path: ".vscode/mcp.json",
  },
  windsurf: {
    description: "Windsurf Cascade AI editor",
    key: "mcpServers",
    label: "Windsurf",
    path: ".codeium/windsurf/mcp_config.json",
  },
};

const SORA_SERVER_CONFIG = {
  args: ["@soralabs/cli", "mcp"],
  command: "npx",
};

/**
 * Starts the Sora CLI Model Context Protocol (MCP) server over standard I/O.
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Configures the Sora MCP server in the specified AI client's configuration file.
 */
export async function initMcpClient(
  options: McpOptions = {}
): Promise<boolean> {
  const cwd = options.cwd ?? process.cwd();
  let clientKey = options.client?.toLowerCase() as McpClient | undefined;

  const validClients = Object.keys(CLIENT_DEFINITIONS) as McpClient[];

  if (clientKey && !validClients.includes(clientKey)) {
    error(
      `Unknown MCP client "${options.client}". Available: ${validClients.join(", ")}`
    );
    return false;
  }

  if (!clientKey) {
    if (process.stdin.isTTY) {
      const choice = await select({
        message: "Which AI assistant / client would you like to configure?",
        options: validClients.map((key) => ({
          hint: CLIENT_DEFINITIONS[key].description,
          label: CLIENT_DEFINITIONS[key].label,
          value: key,
        })),
      });

      if (!choice || typeof choice !== "string") {
        done("MCP configuration cancelled.");
        return true;
      }

      clientKey = choice as McpClient;
    } else {
      clientKey = "cursor";
    }
  }

  const clientInfo = CLIENT_DEFINITIONS[clientKey];
  const configPath = resolve(cwd, clientInfo.path);

  let existingConfig: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf8");
      existingConfig = JSON.parse(raw);
    } catch {
      existingConfig = {};
    }
  }

  const rootKey = clientInfo.key;
  const currentServers = (existingConfig[rootKey] ?? {}) as Record<
    string,
    unknown
  >;

  const updatedConfig = {
    ...existingConfig,
    [rootKey]: {
      ...currentServers,
      sora: SORA_SERVER_CONFIG,
    },
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), "utf8");

  done(
    `Sora MCP server configured for ${clientInfo.label} in ${sanitize(clientInfo.path)}.`
  );
  bar(
    "Next steps: Restart your AI assistant to activate Sora UI component search and installation tools."
  );
  return true;
}
