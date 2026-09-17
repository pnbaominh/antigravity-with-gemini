import net from "node:net";

export async function isPortAvailable(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

export async function findAvailablePort(
  preferredPort: number,
  maxAttempts: number = 20,
  host: string = "127.0.0.1"
): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = preferredPort + offset;
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  throw new Error(`Could not find an available port near ${preferredPort} after ${maxAttempts} attempts.`);
}
