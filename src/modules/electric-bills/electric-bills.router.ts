import { Router } from "express";
import {
  getUnassignedHandler,
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
} from "./electric-bills.controller";

const router = Router();

router.get("/unassigned", getUnassignedHandler);
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
router.patch("/:id", patchElectricBillHandler);

export default router;