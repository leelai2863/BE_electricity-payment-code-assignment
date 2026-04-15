import { Router } from "express";
import { CheckbillIngestController } from "./checkbill-ingest.controller";

const router = Router();

router.post("/charges-snapshot", CheckbillIngestController.ingest);
router.post("/charges-snapshot/:batchId/process", CheckbillIngestController.processBatch);
router.post("/charges-snapshot/process-pending", CheckbillIngestController.processPending);

export default router;

