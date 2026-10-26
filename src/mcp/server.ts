import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { detectConfig } from "@/utils/detect.js";
import { fetchComponent, fetchRegistry } from "@/utils/registry.js";

const MCP_TOOLS = [
  {
    description:
      "List all components available in the Sora UI or specified registry.",
    inputSchema: {
      properties: {
        registry: {
          description: 'Registry key (default: "ui") or a custom registry URL.',
          type: "string",
        },
      },
      type: "object",
    },
    name: "list_components",
  },
  {
    description:
      "Search for components by keyword matching against their name, title, or description.",
    inputSchema: {
      properties: {
        limit: {
          description: "Maximum number of search results to return.",
          type: "number",
        },
        query: {
          description: "Search keyword or phrase.",
          type: "string",
        },
        registry: {
          description: 'Registry key (default: "ui") or a custom registry URL.',
          type: "string",
        },
      },
      required: ["query"],
      type: "object",
    },
    name: "search_components",
  },
  {
    description:
      "Retrieve full metadata, dependencies, and file contents for a specific component.",
    inputSchema: {
      properties: {
        name: {
          description: "The component name to inspect.",
          type: "string",
        },
        registry: {
          description: 'Registry key (default: "ui") or a custom registry URL.',
          type: "string",
        },
      },
      required: ["name"],
      type: "object",
    },
    name: "view_component",
  },
  {
    description:
      "Generate the exact CLI command to add one or more components to the current project.",
    inputSchema: {
      properties: {
        components: {
          description: "Array of component names to install.",
          items: { type: "string" },
          type: "array",
        },
        force: {
          description: "Whether to include the --force flag.",
          type: "boolean",
        },
        path: {
          description: "Custom installation directory path.",
          type: "string",
        },
        registry: {
          description: "Custom registry key or URL.",
          type: "string",
        },
        yes: {
          description: "Whether to include the --yes flag.",
          type: "boolean",
        },
      },
      required: ["components"],
      type: "object",
    },
    name: "get_add_command",
  },
  {
    description:
      "Detect and return the current project's configuration (package manager, path aliases, RSC compatibility).",
    inputSchema: {
      properties: {},
      type: "object",
    },
    name: "get_project_config",
  },
];

async function handleListComponents(
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const registry =
    typeof args.registry === "string" ? args.registry : undefined;
  const catalog = await fetchRegistry(registry);
  return {
    content: [{ text: JSON.stringify(catalog.items, null, 2), type: "text" }],
  };
}

async function handleSearchComponents(
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const query = String(args.query ?? "").toLowerCase();
  const registry =
    typeof args.registry === "string" ? args.registry : undefined;
  const limit = typeof args.limit === "number" ? args.limit : 20;

  const catalog = await fetchRegistry(registry);
  const matches = catalog.items.filter((item) => {
    const matchName = item.name.toLowerCase().includes(query);
    const matchTitle = (item.title ?? "").toLowerCase().includes(query);
    const matchDesc = (item.description ?? "").toLowerCase().includes(query);
    return matchName || matchTitle || matchDesc;
  });

  return {
    content: [
      { text: JSON.stringify(matches.slice(0, limit), null, 2), type: "text" },
    ],
  };
}

async function handleViewComponent(
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const componentName = String(args.name ?? "");
  const registry =
    typeof args.registry === "string" ? args.registry : undefined;
  const item = await fetchComponent(componentName, registry);
  return {
    content: [{ text: JSON.stringify(item, null, 2), type: "text" }],
  };
}

function handleGetAddCommand(args: Record<string, unknown>): CallToolResult {
  const components = Array.isArray(args.components)
    ? args.components.map(String)
    : [];
  const parts = ["npx", "@soralabs/cli", "add", ...components];

  if (args.registry && typeof args.registry === "string") {
    parts.push("--registry", args.registry);
  }
  if (args.path && typeof args.path === "string") {
    parts.push("--path", args.path);
  }
  if (args.force) {
    parts.push("--force");
  }
  if (args.yes) {
    parts.push("--yes");
  }

  return {
    content: [{ text: parts.join(" "), type: "text" }],
  };
}

function handleGetProjectConfig(): CallToolResult {
  const config = detectConfig(process.cwd());
  return {
    content: [{ text: JSON.stringify(config, null, 2), type: "text" }],
  };
}

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "sora",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: MCP_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    try {
      if (name === "list_components") {
        return await handleListComponents(args);
      }
      if (name === "search_components") {
        return await handleSearchComponents(args);
      }
      if (name === "view_component") {
        return await handleViewComponent(args);
      }
      if (name === "get_add_command") {
        return handleGetAddCommand(args);
      }
      if (name === "get_project_config") {
        return handleGetProjectConfig();
      }

      return {
        content: [{ text: `Unknown tool name: ${name}`, type: "text" }],
        isError: true,
      };
    } catch (err) {
      return {
        content: [
          {
            text: `Error executing ${name}: ${(err as Error).message}`,
            type: "text",
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
