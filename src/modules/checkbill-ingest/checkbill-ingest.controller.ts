import type { Request, Response } from "express";
import { ingestChargesSnapshot } from "./checkbill-ingest.service";

export const CheckbillIngestController = {
  async ingest(req: Request, res: Response) {
    const result = await ingestChargesSnapshot(req.headers, req.body);
    res.status(result.status).json(result.payload);
  },

  deprecatedProcess(_req: Request, res: Response) {
    res.status(410).json({
      error:
        "Automatic batch processing was removed; approve each row on the Quet cuoc (billing scan) screen.",
    });
  },
};
