import { Router } from "express";
import { CheckbillIngestController } from "./checkbill-ingest.controller";

const router = Router();

router.post("/charges-snapshot", CheckbillIngestController.ingest);
router.post("/charges-snapshot/:batchId/process", CheckbillIngestController.deprecatedProcess);
router.post("/charges-snapshot/process-pending", CheckbillIngestController.deprecatedProcess);

export default router;

