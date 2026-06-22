import { Queue } from "bullmq";

export type ExtractionJob = {
  attachmentId: string;
  organisationId: string;
  userId: string;
};

function parseRedisUrl(url: string): { host: string; port: number } {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port) || 6379 };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

const redisConn = parseRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379");

export const extractionQueue = new Queue<ExtractionJob>("ai-extraction", {
  connection: redisConn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});
