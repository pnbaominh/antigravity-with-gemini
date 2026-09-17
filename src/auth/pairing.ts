import crypto from "node:crypto";
import { DEFAULT_PAIRING_TTL_MS, MAX_PAIRING_ATTEMPTS } from "../config/constants.js";

export interface PairingState {
  code: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  isUsed: boolean;
  workspaceRoot: string;
}

export class PairingManager {
  private activePairings: Map<string, PairingState> = new Map();

  generateCode(workspaceRoot: string, ttlMs: number = DEFAULT_PAIRING_TTL_MS): string {
    // Generate a secure 6-digit random number
    const code = crypto.randomInt(100000, 999999).toString();
    const now = Date.now();

    const state: PairingState = {
      code,
      createdAt: now,
      expiresAt: now + ttlMs,
      attempts: 0,
      isUsed: false,
      workspaceRoot,
    };

    this.activePairings.set(workspaceRoot, state);
    return code;
  }

  getActiveCode(workspaceRoot: string): string | null {
    const state = this.activePairings.get(workspaceRoot);
    if (!state) return null;
    if (Date.now() > state.expiresAt || state.isUsed || state.attempts >= MAX_PAIRING_ATTEMPTS) {
      this.activePairings.delete(workspaceRoot);
      return null;
    }
    return state.code;
  }

  verifyCode(workspaceRoot: string, inputCode: string): { success: boolean; error?: string } {
    const state = this.activePairings.get(workspaceRoot);

    if (!state) {
      return { success: false, error: "No active pairing code for this workspace. Generate a new one." };
    }

    if (Date.now() > state.expiresAt) {
      this.activePairings.delete(workspaceRoot);
      return { success: false, error: "Pairing code expired. Please generate a new code." };
    }

    if (state.isUsed) {
      return { success: false, error: "Pairing code has already been used." };
    }

    if (state.attempts >= MAX_PAIRING_ATTEMPTS) {
      this.activePairings.delete(workspaceRoot);
      return { success: false, error: "Too many failed attempts. Pairing code invalidated." };
    }

    state.attempts++;

    // Timing-safe comparison
    const expected = Buffer.from(state.code);
    const actual = Buffer.from(inputCode.padEnd(6, " ").slice(0, 6));

    if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
      state.isUsed = true;
      return { success: true };
    }

    const remaining = MAX_PAIRING_ATTEMPTS - state.attempts;
    return {
      success: false,
      error: `Invalid pairing code. ${remaining} attempt(s) remaining.`,
    };
  }

  revoke(workspaceRoot: string) {
    this.activePairings.delete(workspaceRoot);
  }
}
