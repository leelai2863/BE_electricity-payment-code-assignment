import { Router } from "express";
import { BillingScanController } from "./billing-scan.controller";

const router = Router();

/** Jobs (Deprecated) */
router.get("/jobs", BillingScanController.deprecatedJob);
router.post("/jobs", BillingScanController.deprecatedJob);

/** History */
router.get("/history", BillingScanController.getHistory);

/** Scanned codes — ChargesStagingRow from checkbill ingest */
router.get("/scanned-codes", BillingScanController.getScannedCodes);
router.post("/scanned-codes/approve-batch", BillingScanController.approveScannedCodesBatch);
router.post("/scanned-codes/:id/approve", BillingScanController.approveScannedCode);
router.post("/dev/seed-local-mock", BillingScanController.seedLocalMock);

export default router;