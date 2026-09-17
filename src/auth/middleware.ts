import type { IncomingMessage, ServerResponse } from "node:http";
import { TokenStore } from "./store.js";

export function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers["authorization"];
  if (!auth) return null;

  const parts = auth.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1].trim();
  }
  return null;
}

export function createAuthMiddleware(tokenStore: TokenStore, workspaceRoot: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // Whitelisted routes
    const url = req.url || "/";
    if (
      url === "/" ||
      url.startsWith("/?") ||
      url.startsWith("/health") ||
      url.startsWith("/api/health") ||
      url.startsWith("/api/status") ||
      url.startsWith("/api/plans") ||
      url.startsWith("/api/plan") ||
      url.startsWith("/pair") ||
      url.startsWith("/api/pair") ||
      url.startsWith("/oauth/authorize") ||
      url.startsWith("/oauth/token") ||
      url === "/.well-known/oauth-authorization-server"
    ) {
      return next();
    }

    const token = extractBearerToken(req);
    if (!token) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="g2a-mcp", error="unauthorized"',
      });
      res.end(JSON.stringify({ error: "Missing or invalid Bearer token" }));
      return;
    }

    if (!tokenStore.validateToken(token, workspaceRoot)) {
      res.writeHead(403, {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="g2a-mcp", error="invalid_token"',
      });
      res.end(JSON.stringify({ error: "Token expired or not authorized for this workspace" }));
      return;
    }

    next();
  };
}
