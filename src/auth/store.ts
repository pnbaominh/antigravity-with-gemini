import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getWorkspaceStateDirectory } from "../config/paths.js";

export interface AuthToken {
  token: string;
  workspaceRoot: string;
  clientId: string;
  createdAt: number;
  expiresAt: number;
  refreshToken?: string;
}

export class TokenStore {
  private memoryTokens: Map<string, AuthToken> = new Map();
  private stateDir: string;

  constructor(workspaceRoot: string) {
    this.stateDir = getWorkspaceStateDirectory(workspaceRoot);
    this.loadPersistedTokens();
  }

  createToken(
    workspaceRoot: string,
    clientId: string = "gemini-client",
    ttlMs: number = 30 * 24 * 60 * 60 * 1000 // 30 days
  ): AuthToken {
    const tokenStr = "g2a_" + crypto.randomBytes(24).toString("hex");
    const refreshToken = "g2a_rf_" + crypto.randomBytes(32).toString("hex");
    const now = Date.now();

    const token: AuthToken = {
      token: tokenStr,
      workspaceRoot: path.resolve(workspaceRoot),
      clientId,
      createdAt: now,
      expiresAt: now + ttlMs,
      refreshToken,
    };

    this.memoryTokens.set(tokenStr, token);
    this.savePersistedTokens();
    return token;
  }

  validateToken(tokenStr: string, currentWorkspaceRoot?: string): boolean {
    const token = this.memoryTokens.get(tokenStr);
    if (!token) return false;

    if (Date.now() > token.expiresAt) {
      this.memoryTokens.delete(tokenStr);
      this.savePersistedTokens();
      return false;
    }

    if (currentWorkspaceRoot) {
      const normalizedCurrent = path.resolve(currentWorkspaceRoot);
      const normalizedTokenWs = path.resolve(token.workspaceRoot);
      if (normalizedCurrent !== normalizedTokenWs) {
        return false;
      }
    }

    return true;
  }

  revokeToken(tokenStr: string): boolean {
    const deleted = this.memoryTokens.delete(tokenStr);
    if (deleted) this.savePersistedTokens();
    return deleted;
  }

  private loadPersistedTokens() {
    const file = path.join(this.stateDir, "tokens.json");
    if (fs.existsSync(file)) {
      try {
        const list: AuthToken[] = JSON.parse(fs.readFileSync(file, "utf-8"));
        const now = Date.now();
        for (const t of list) {
          if (t.expiresAt > now) {
            this.memoryTokens.set(t.token, t);
          }
        }
      } catch {
        // ignore read error
      }
    }
  }

  private savePersistedTokens() {
    const file = path.join(this.stateDir, "tokens.json");
    try {
      const list = Array.from(this.memoryTokens.values());
      fs.writeFileSync(file, JSON.stringify(list, null, 2), "utf-8");
    } catch {
      // ignore write error
    }
  }
}
