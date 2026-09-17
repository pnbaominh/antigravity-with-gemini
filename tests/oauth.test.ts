import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { PairingManager } from "../src/auth/pairing.js";
import { TokenStore } from "../src/auth/store.js";
import { OAuthServer } from "../src/auth/oauth.js";

describe("OAuth 2.1 PKCE Flow", () => {
  const ws = "test-ws-oauth";
  const pairingManager = new PairingManager();
  const tokenStore = new TokenStore(ws);
  const oauthServer = new OAuthServer(pairingManager, tokenStore);

  it("should complete full PKCE authorization with pairing code", () => {
    const codeVerifier = "abcdefghijklmnopqrstuvwxyz1234567890-_~.";
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const clientId = "gemini-test-client";

    const pairingCode = pairingManager.generateCode(ws);

    // 1. Authorize
    const authResult = oauthServer.authorizeWithPairingCode({
      workspaceRoot: ws,
      pairingCode,
      clientId,
      codeChallenge,
      codeChallengeMethod: "S256",
    });

    expect(authResult.success).toBe(true);
    expect(authResult.authCode).toBeDefined();

    // 2. Token Exchange
    const tokenResult = oauthServer.exchangeToken({
      authCode: authResult.authCode!,
      codeVerifier,
      clientId,
    });

    expect(tokenResult.success).toBe(true);
    expect(tokenResult.token).toBeDefined();
    expect(tokenResult.token!.token).toMatch(/^g2a_/);

    // 3. Validate Token
    expect(tokenStore.validateToken(tokenResult.token!.token, ws)).toBe(true);
  });
});
