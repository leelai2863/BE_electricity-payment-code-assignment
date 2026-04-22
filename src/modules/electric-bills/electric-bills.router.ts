import path from "path";
import fs from "fs";
import { Router } from "express";
import multer from "multer";
import {
  getUnassignedHandler,
  postUnassignedPaymentDeadlineSyncHandler,
  getInvoiceListHandler,
  getInvoiceCompletedMonthsHandler,
  getInvoiceCompletedHandler,
  getMailQueueHandler,
  listRefundFeeRulesHandler,
  createRefundFeeRuleHandler,
  updateRefundFeeRuleHandler,
  removeRefundFeeRuleHandler,
  patchRefundLineStatesHandler,
  migrateRefundLocalStorageHandler,
  getAssignedCodesHandler,
  assignAgencyHandler,
  patchElectricBillHandler,
  createManualElectricBillHandler,
  postDataExportAuditHandler,
  getPendingListHandler,
  setPendingHandler,
  resolvePendingHandler,
  uploadPendingImageHandler,
  createSplitHandler,
  patchSplitHandler,
  cancelSplitHandler,
  servePendingImageHandler,
} from "./electric-bills.controller";

const uploadDir = path.join(process.cwd(), "uploads", "pending");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(null, allowed.includes(file.mimetype));
  },
});

const router = Router();

router.get("/unassigned", getUnassignedHandler);
router.post("/unassigned/payment-deadline-sync", postUnassignedPaymentDeadlineSyncHandler);
router.get("/invoice-list", getInvoiceListHandler);
router.get("/invoice-completed-months", getInvoiceCompletedMonthsHandler);
router.get("/invoice-completed", getInvoiceCompletedHandler);
router.get("/mail-queue", getMailQueueHandler);
router.get("/refund-fee-rules", listRefundFeeRulesHandler);
router.post("/refund-fee-rules", createRefundFeeRuleHandler);
router.patch("/refund-fee-rules/:id", updateRefundFeeRuleHandler);
router.delete("/refund-fee-rules/:id", removeRefundFeeRuleHandler);
router.patch("/refund-line-states", patchRefundLineStatesHandler);
router.post("/refund-migrate-localstorage", migrateRefundLocalStorageHandler);
router.get("/assigned-codes", getAssignedCodesHandler);
router.post("/assign", assignAgencyHandler);
router.post("/manual", createManualElectricBillHandler);
router.post("/audit/data-export", postDataExportAuditHandler);

// Mã treo routes
router.get("/pending-list", getPendingListHandler);
router.get("/pending-images/:filename", servePendingImageHandler);

// Split routes (route cụ thể phải đứng trước route động)
router.patch("/splits/:splitId/cancel", cancelSplitHandler);
router.patch("/splits/:splitId/:splitIdx", patchSplitHandler);

// Bill-specific routes (must be before /:id catch-all)
router.patch("/:id/set-pending", setPendingHandler);
router.patch("/:id/resolve-pending", resolvePendingHandler);
router.post("/:id/upload-pending/:field", upload.single("file"), uploadPendingImageHandler);
router.post("/:id/split", createSplitHandler);

// Catch-all
router.patch("/:id", patchElectricBillHandler);

export default router;