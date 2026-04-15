import type { Request, Response } from "express";
import {
  ingestChargesSnapshot,
  processIngestBatch,
  processPendingIngestBatches,
} from "./checkbill-ingest.service";

export const CheckbillIngestController = {
  async ingest(req: Request, res: Response) {
    const result = await ingestChargesSnapshot(req.headers, req.body);
    res.status(result.status).json(result.payload);
  },

  async processBatch(req: Request, res: Response) {
    const id = String(req.params.batchId ?? "");
    const result = await processIngestBatch(id);
    res.status(result.status).json(result.payload);
  },

  async processPending(req: Request, res: Response) {
    const result = await processPendingIngestBatches(req.query.limit);
    res.status(result.status).json(result.payload);
  },
};

