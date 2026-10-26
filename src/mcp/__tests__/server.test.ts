import { describe, expect, test } from "bun:test";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "@/mcp/server.js";

describe("mcp server", () => {
  test("creates server instance and registers expected tools", async () => {
    const server = createMcpServer();
    expect(server).toBeDefined();

    // Directly test the tool list request handler registered on server
    const listHandler = (server as any)._requestHandlers?.get(
      ListToolsRequestSchema.shape.method.value
    );
    expect(listHandler).toBeDefined();

    const result = await listHandler({ method: "tools/list", params: {} }, {});
    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBe(5);

    const toolNames = result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("list_components");
    expect(toolNames).toContain("search_components");
    expect(toolNames).toContain("view_component");
    expect(toolNames).toContain("get_add_command");
    expect(toolNames).toContain("get_project_config");
  });

  test("executes get_add_command tool correctly", async () => {
    const server = createMcpServer();
    const callHandler = (server as any)._requestHandlers?.get(
      CallToolRequestSchema.shape.method.value
    );
    expect(callHandler).toBeDefined();

    const response = await callHandler(
      {
        method: "tools/call",
        params: {
          arguments: {
            components: ["text-effect", "button"],
            force: true,
            yes: true,
          },
          name: "get_add_command",
        },
      },
      {}
    );

    expect(response.content).toBeDefined();
    expect(response.content[0].text).toBe(
      "npx @soralabs/cli add text-effect button --force --yes"
    );
  });

  test("handles unknown tool gracefully", async () => {
    const server = createMcpServer();
    const callHandler = (server as any)._requestHandlers?.get(
      CallToolRequestSchema.shape.method.value
    );
    expect(callHandler).toBeDefined();

    const response = await callHandler(
      {
        method: "tools/call",
        params: {
          arguments: {},
          name: "nonexistent_tool",
        },
      },
      {}
    );

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Unknown tool name");
  });
});
