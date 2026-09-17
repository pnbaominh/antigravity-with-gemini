import path from "node:path";
import fs from "node:fs";
import { SENSITIVE_PATTERNS, SAFE_ENV_FILES } from "../config/constants.js";

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Checks if a relative path matches any sensitive file pattern.
 */
export function isSensitiveFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const basename = path.basename(normalized);

  // Allow explicit safe templates like .env.example
  if (SAFE_ENV_FILES.includes(basename)) {
    return false;
  }

  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(basename) || pattern.test(normalized));
}

/**
 * Resolves and validates a target path within a workspace root.
 * Enforces realpath resolution to prevent symlink traversal and '../' directory traversal attacks.
 */
export function resolveSafePath(
  workspaceRoot: string,
  targetRelativeOrAbsolute: string
): { safePath: string; relativePath: string } {
  const rootReal = fs.realpathSync(path.resolve(workspaceRoot));
  
  // Resolve the combined path
  let candidate = path.isAbsolute(targetRelativeOrAbsolute)
    ? path.resolve(targetRelativeOrAbsolute)
    : path.resolve(rootReal, targetRelativeOrAbsolute);

  // Normalize separators
  candidate = path.normalize(candidate);

  // Check if target exists; if it exists, resolve symlink realpath
  let candidateReal = candidate;
  if (fs.existsSync(candidate)) {
    candidateReal = fs.realpathSync(candidate);
  } else {
    // If file doesn't exist yet, resolve its existing parent directory
    let parent = path.dirname(candidate);
    while (!fs.existsSync(parent) && parent !== path.dirname(parent)) {
      parent = path.dirname(parent);
    }
    if (fs.existsSync(parent)) {
      const parentReal = fs.realpathSync(parent);
      const relativeToParent = path.relative(parent, candidate);
      candidateReal = path.resolve(parentReal, relativeToParent);
    }
  }

  // Calculate relative path from real workspace root
  const relative = path.relative(rootReal, candidateReal);

  // If relative path starts with '..' or is absolute (on windows drive change), it's escaping the workspace
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SecurityError(
      `Access denied: path "${targetRelativeOrAbsolute}" escapes workspace root.`
    );
  }

  // Check if path is in sensitive file patterns
  if (isSensitiveFile(relative)) {
    throw new SecurityError(
      `Access denied: file "${relative}" is restricted for security (sensitive credential/key).`
    );
  }

  return {
    safePath: candidateReal,
    relativePath: relative.replace(/\\/g, "/"),
  };
}
