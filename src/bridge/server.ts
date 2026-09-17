import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { PairingManager } from "../auth/pairing.js";
import { TokenStore } from "../auth/store.js";
import { OAuthServer } from "../auth/oauth.js";
import { createAuthMiddleware } from "../auth/middleware.js";
import { createG2AMcpServer } from "../mcp/server.js";
import { McpHttpHandler } from "../mcp/http.js";
import { GeminiThinkingClient } from "../gemini/client.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { APP_NAME, PROTOCOL_VERSION } from "../config/constants.js";

export interface BridgeServerOptions {
  port: number;
  host: string;
  workspaceRoot: string;
  geminiApiKey?: string;
}

export class BridgeServer {
  private port: number;
  private host: string;
  private workspaceRoot: string;
  private server: http.Server | null = null;
  private pairingManager: PairingManager;
  private tokenStore: TokenStore;
  private oauthServer: OAuthServer;
  private geminiClient: GeminiThinkingClient;
  private mcpHttpHandler: McpHttpHandler;
  private workspaceManager: WorkspaceManager;

  constructor(options: BridgeServerOptions) {
    this.port = options.port;
    this.host = options.host;
    this.workspaceRoot = options.workspaceRoot;

    this.pairingManager = new PairingManager();
    this.tokenStore = new TokenStore(this.workspaceRoot);
    this.oauthServer = new OAuthServer(this.pairingManager, this.tokenStore);
    this.geminiClient = new GeminiThinkingClient(options.geminiApiKey);

    const mcpServer = createG2AMcpServer(this.workspaceRoot, {
      geminiClient: this.geminiClient,
    });
    this.mcpHttpHandler = new McpHttpHandler(mcpServer);
    this.workspaceManager = new WorkspaceManager(this.workspaceRoot);
  }

  getPairingManager(): PairingManager {
    return this.pairingManager;
  }

  getTokenStore(): TokenStore {
    return this.tokenStore;
  }

  getGeminiClient(): GeminiThinkingClient {
    return this.geminiClient;
  }

  async start(): Promise<{ port: number; host: string; url: string }> {
    const authMiddleware = createAuthMiddleware(this.tokenStore, this.workspaceRoot);

    this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      // Set CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      authMiddleware(req, res, () => {
        this.routeRequest(req, res);
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, this.host, () => {
        const url = `http://${this.host}:${this.port}`;
        resolve({ port: this.port, host: this.host, url });
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async routeRequest(req: IncomingMessage, res: ServerResponse) {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // Health check
    if (pathname === "/health" || pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          name: APP_NAME,
          version: PROTOCOL_VERSION,
          workspace: this.workspaceRoot,
        })
      );
      return;
    }

    // Status
    if (pathname === "/api/status") {
      const info = this.workspaceManager.getInfo();
      const activeCode = this.pairingManager.getActiveCode(this.workspaceRoot);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "running",
          workspace: info,
          hasActivePairingCode: !!activeCode,
          geminiConfigured: this.geminiClient.isConfigured(),
        })
      );
      return;
    }

    // Pairing authorization endpoint
    if (pathname === "/api/pair" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const { pairingCode, clientId, codeChallenge, codeChallengeMethod } = body || {};

      if (!pairingCode || !clientId || !codeChallenge) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Missing required fields: pairingCode, clientId, codeChallenge",
          })
        );
        return;
      }

      const result = this.oauthServer.authorizeWithPairingCode({
        workspaceRoot: this.workspaceRoot,
        pairingCode,
        clientId,
        codeChallenge,
        codeChallengeMethod,
      });

      if (!result.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ authCode: result.authCode }));
      return;
    }

    // OAuth token exchange endpoint
    if (pathname === "/oauth/token" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const { authCode, codeVerifier, clientId } = body || {};

      if (!authCode || !codeVerifier || !clientId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing authCode, codeVerifier, or clientId" }));
        return;
      }

      const result = this.oauthServer.exchangeToken({
        authCode,
        codeVerifier,
        clientId,
      });

      if (!result.success || !result.token) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: result.token.token,
          token_type: "bearer",
          expires_in: Math.floor((result.token.expiresAt - Date.now()) / 1000),
          refresh_token: result.token.refreshToken,
        })
      );
      return;
    }

    // MCP SSE endpoint
    if (pathname === "/mcp" && req.method === "GET") {
      await this.mcpHttpHandler.handleSse(req, res);
      return;
    }

    // MCP Messages endpoint
    if (pathname === "/mcp/messages" && req.method === "POST") {
      await this.mcpHttpHandler.handleMessage(req, res, parsedUrl);
      return;
    }

    // Not found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Not found: ${pathname}` }));
  }

  private readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(data || "{}"));
        } catch {
          resolve(null);
        }
      });
    });
  }
}
