import { Router } from "express";
import { BillingScanController } from "./billing-scan.controller";

const router = Router();

/** Jobs (Deprecated) */
router.get("/jobs", BillingScanController.deprecatedJob);
router.post("/jobs", BillingScanController.deprecatedJob);

/** History */
router.get("/history", BillingScanController.getHistory);

/** Scanned Codes */
router.get("/scanned-codes", BillingScanController.getScannedCodes);

export default router;