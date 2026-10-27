import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { env as cfEnv } from "cloudflare:workers";
import { z } from "zod";
import { Agent } from "./ai/agent.js";

function createMcpServer() {
  const server = new McpServer({ name: "flytripvisa", version: "1.0.0" });

  server.registerTool("agent", {...}, async ({ message }) => {
    const agent = new Agent(cfEnv);
    const result = await agent.run(message, {});
    return { content: [{ type: "text", text: result.response }] };
  });

  server.registerTool("ai_chat", {...}, async ({ messages, max_tokens }) => {
    ...
  });

  server.registerTool("health", {...}, async () => {...});

  return server;
}

export const mcpHandler = createMcpHandler(createMcpServer, { route: "/mcp" });
