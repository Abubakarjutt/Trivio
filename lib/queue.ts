import { Queue } from "bullmq";

export type ExtractionJob = {
  attachmentId: string;
  organisationId: string;
  userId: string;
};

export const extractionQueue = new Queue<ExtractionJob>("ai-extraction", {
  connection: { host: "localhost", port: 6379 },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});
