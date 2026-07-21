import Redis from "ioredis";

function parseRedisUrl(url: string): { host: string; port: number } {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port) || 6379 };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

const { host, port } = parseRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379");

export const redis = new Redis({
  host,
  port,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});
