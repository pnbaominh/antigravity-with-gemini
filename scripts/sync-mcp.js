import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const defaultTargetDir = path.join(
  os.homedir(),
  ".gemini",
  "antigravity",
  "mcp",
  "antigravity-with-gemini"
);

export async function syncMcpArtifacts(targetDir = defaultTargetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 1. Generate tool schemas from compiled MCP server
  let toolCount = 0;
  try {
    const { createG2AMcpServer } = await import("../dist/mcp/server.js");
    let zodToJsonSchema;
    try {
      const zjs = await import("zod-to-json-schema");
      zodToJsonSchema = zjs.zodToJsonSchema;
    } catch {}

    const server = createG2AMcpServer(projectRoot);
    const tools = server._registeredTools || {};

    for (const [name, tool] of Object.entries(tools)) {
      let jsonSchema;
      if (zodToJsonSchema && tool.inputSchema && tool.inputSchema._def) {
        jsonSchema = zodToJsonSchema(tool.inputSchema);
      } else {
        jsonSchema = {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {},
        };
      }

      const content = {
        name,
        description: tool.description,
        parameters: jsonSchema,
      };

      const outPath = path.join(targetDir, `${name}.json`);
      fs.writeFileSync(outPath, JSON.stringify(content, null, 2), "utf-8");
      toolCount++;
    }
  } catch (err) {
    console.warn(`[sync-mcp] Warning while generating schemas: ${err?.message}`);
  }

  // 2. Synchronize instructions.md
  try {
    const { MCP_INSTRUCTIONS } = await import("../dist/mcp/schemas.js");
    if (MCP_INSTRUCTIONS) {
      fs.writeFileSync(path.join(targetDir, "instructions.md"), MCP_INSTRUCTIONS, "utf-8");
    }
  } catch {
    // If not compiled yet, fallback to reading file if exists
    const localInstructions = path.join(projectRoot, "docs", "instructions.md");
    if (fs.existsSync(localInstructions)) {
      fs.copyFileSync(localInstructions, path.join(targetDir, "instructions.md"));
    }
  }

  // 3. Synchronize core governance & documentation files
  const filesToCopy = ["RULES.md", "README.md", "README.vi.md"];
  for (const f of filesToCopy) {
    const src = path.join(projectRoot, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(targetDir, f));
    }
  }

  // 4. Synchronize complete docs directory
  const docsSrc = path.join(projectRoot, "docs");
  if (fs.existsSync(docsSrc)) {
    const docsDest = path.join(targetDir, "docs");
    fs.mkdirSync(docsDest, { recursive: true });
    const docs = fs.readdirSync(docsSrc);
    for (const doc of docs) {
      const docPath = path.join(docsSrc, doc);
      if (fs.statSync(docPath).isFile()) {
        fs.copyFileSync(docPath, path.join(docsDest, doc));
      }
    }
  }

  console.log(
    `[sync-mcp] ✓ Successfully synchronized ${toolCount} MCP tool schemas, instructions, and documentation to:\n  ${targetDir}`
  );
}

// Run directly when executed
syncMcpArtifacts().catch((err) => {
  console.error("[sync-mcp] Error:", err);
});
