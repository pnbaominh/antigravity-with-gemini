import path from "node:path";
import fs from "node:fs";

export interface SingletonLockCleanupResult {
  readonly profileDir: string;
  readonly removedLockFiles: readonly string[];
  readonly lockedByActiveProcessFiles: readonly string[];
  readonly lockErrorCodes: readonly string[];
  readonly isClean: boolean;
}

/**
 * Normalizes any workspace file or directory path:
 * 1. Resolves relative path to absolute path.
 * 2. On Windows, normalizes drive letter to uppercase (e.g., c:\repo -> C:/repo).
 * 3. Converts all path backslashes (\) to POSIX forward slashes (/).
 */
export function normalizeWorkspacePath(inputPath: string): string {
  if (!inputPath) return "";
  let resolved = path.resolve(inputPath).replace(/\\/g, "/");

  // Normalize Windows drive letter: c:/... -> C:/...
  if (/^[a-z]:\//i.test(resolved)) {
    resolved = resolved.charAt(0).toUpperCase() + resolved.slice(1);
  }

  return resolved;
}

/**
 * Normalizes all CRLF newlines to standard POSIX LF (\n).
 */
export function normalizeLineEndings(text: string): string {
  if (!text) return "";
  return text.replace(/\r\n/g, "\n");
}

/**
 * Resolves platform-specific executable commands for Windows vs POSIX.
 * On Windows, commands like 'npm' and 'npx' require the '.cmd' extension for spawn/exec.
 */
export function getPlatformCommand(cmd: "npm" | "npx" | "git" | string): string {
  if (process.platform === "win32") {
    if (cmd === "npm" || cmd === "npx") {
      return `${cmd}.cmd`;
    }
  }
  return cmd;
}

/**
 * Safely cleans up Chromium/Playwright singleton lock files from a user data directory:
 * - SingletonLock
 * - SingletonCookie
 * - SingletonSocket
 * - lockfile
 *
 * Catches Windows EBUSY / EPERM errors when a browser instance is actively holding the lock.
 */
export async function cleanupBrowserSingletonLocks(
  profileDir: string
): Promise<SingletonLockCleanupResult> {
  const targetDir = path.resolve(profileDir);
  const lockNames = [
    "SingletonLock",
    "SingletonCookie",
    "SingletonSocket",
    "lockfile",
  ];

  const removedLockFiles: string[] = [];
  const lockedByActiveProcessFiles: string[] = [];
  const lockErrorCodes: string[] = [];

  if (!fs.existsSync(targetDir)) {
    return {
      profileDir: targetDir,
      removedLockFiles,
      lockedByActiveProcessFiles,
      lockErrorCodes,
      isClean: true,
    };
  }

  for (const lockName of lockNames) {
    const lockPath = path.join(targetDir, lockName);
    if (fs.existsSync(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
        removedLockFiles.push(lockName);
      } catch (err: any) {
        const code = err?.code || "UNKNOWN";
        lockErrorCodes.push(code);
        lockedByActiveProcessFiles.push(lockName);
      }
    }
  }

  const isClean = lockedByActiveProcessFiles.length === 0;

  return {
    profileDir: targetDir,
    removedLockFiles,
    lockedByActiveProcessFiles,
    lockErrorCodes,
    isClean,
  };
}
