import type { IncomingMessage, ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export class McpHttpHandler {
  private server: McpServer;
  private transports: Map<string, SSEServerTransport> = new Map();

  constructor(server: McpServer) {
    this.server = server;
  }

  async handleSse(req: IncomingMessage, res: ServerResponse) {
    const transport = new SSEServerTransport("/mcp/messages", res);
    this.transports.set(transport.sessionId, transport);

    req.on("close", () => {
      this.transports.delete(transport.sessionId);
    });

    await this.server.connect(transport);
  }

  async handleMessage(req: IncomingMessage, res: ServerResponse, url: URL) {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing sessionId parameter" }));
      return;
    }

    const transport = this.transports.get(sessionId);
    if (!transport) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found or expired" }));
      return;
    }

    await transport.handlePostMessage(req, res);
  }
}
