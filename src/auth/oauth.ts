import crypto from "node:crypto";
import { PairingManager } from "./pairing.js";
import { TokenStore, type AuthToken } from "./store.js";

export interface AuthCodeState {
  code: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  workspaceRoot: string;
  expiresAt: number;
}

export class OAuthServer {
  private authCodes: Map<string, AuthCodeState> = new Map();
  private pairingManager: PairingManager;
  private tokenStore: TokenStore;

  constructor(pairingManager: PairingManager, tokenStore: TokenStore) {
    this.pairingManager = pairingManager;
    this.tokenStore = tokenStore;
  }

  /**
   * Generates authorization code if pairing code is valid.
   */
  authorizeWithPairingCode(params: {
    workspaceRoot: string;
    pairingCode: string;
    clientId: string;
    codeChallenge: string;
    codeChallengeMethod?: string;
  }): { success: boolean; authCode?: string; error?: string } {
    const verification = this.pairingManager.verifyCode(params.workspaceRoot, params.pairingCode);
    if (!verification.success) {
      return { success: false, error: verification.error };
    }

    const authCode = "g2a_auth_" + crypto.randomBytes(24).toString("hex");
    const state: AuthCodeState = {
      code: authCode,
      clientId: params.clientId,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod || "S256",
      workspaceRoot: params.workspaceRoot,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min TTL
    };

    this.authCodes.set(authCode, state);
    return { success: true, authCode };
  }

  /**
   * Exchanges authCode + codeVerifier for an AuthToken (OAuth 2.1 PKCE).
   */
  exchangeToken(params: {
    authCode: string;
    codeVerifier: string;
    clientId: string;
  }): { success: boolean; token?: AuthToken; error?: string } {
    const authState = this.authCodes.get(params.authCode);
    if (!authState) {
      return { success: false, error: "Invalid or expired authorization code." };
    }

    if (Date.now() > authState.expiresAt) {
      this.authCodes.delete(params.authCode);
      return { success: false, error: "Authorization code expired." };
    }

    if (authState.clientId !== params.clientId) {
      return { success: false, error: "Client ID mismatch." };
    }

    // Verify PKCE
    const valid = this.verifyPKCE(params.codeVerifier, authState.codeChallenge, authState.codeChallengeMethod);
    if (!valid) {
      return { success: false, error: "Invalid PKCE code_verifier." };
    }

    this.authCodes.delete(params.authCode);
    const token = this.tokenStore.createToken(authState.workspaceRoot, authState.clientId);
    return { success: true, token };
  }

  private verifyPKCE(verifier: string, challenge: string, method: string): boolean {
    if (method === "plain") {
      return verifier === challenge;
    }
    // S256 (default)
    const hash = crypto.createHash("sha256").update(verifier).digest("base64url");
    return hash === challenge;
  }
}
