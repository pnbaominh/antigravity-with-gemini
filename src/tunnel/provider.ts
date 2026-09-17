export interface TunnelInfo {
  url: string;
  provider: string;
  createdAt: string;
  pid?: number;
}

export interface TunnelProvider {
  start(localPort: number): Promise<TunnelInfo>;
  stop(): Promise<void>;
  getStatus(): TunnelInfo | null;
}
