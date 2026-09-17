export const DEFAULT_PORT = 4140;
export const DEFAULT_HOST = "127.0.0.1";
export const APP_NAME = "antigravity-with-gemini";
export const CLI_NAME = "g2a";
export const PROTOCOL_VERSION = "1.0.0";
export const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_PAIRING_ATTEMPTS = 5;

export const DEFAULT_GEMINI_MODELS = {
  PLANNER: "gemini-2.5-pro",
  THINKING: "gemini-2.5-flash-thinking",
  FAST: "gemini-3.8-flash",
} as const;

export const SENSITIVE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /^\.git\/(config|credentials|HEAD)/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /credentials\.json$/i,
  /service-account.*\.json$/i,
  /token\.json$/i,
];

export const SAFE_ENV_FILES = [
  ".env.example",
  ".env.template",
  ".env.sample",
];
