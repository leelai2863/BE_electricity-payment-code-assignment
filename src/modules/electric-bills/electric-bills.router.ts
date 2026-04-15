import { Router } from "express";
import {
  getUnassignedHandler,
  getInvoiceListHandler,
  getInvoiceCompletedMonthsHandler,
  getInvoiceCompletedHandler,
  getMailQueueHandler,
  createRefundFeeRuleHandler,
  patchRefundLineStatesHandler,
  migrateRefundLocalStorageHandler,
  getAssignedCodesHandler,
  assignAgencyHandler,
  patchElectricBillHandler,
} from "./electric-bills.controller";

const router = Router();

router.get("/unassigned", getUnassignedHandler);
router.get("/invoice-list", getInvoiceListHandler);
router.get("/invoice-completed-months", getInvoiceCompletedMonthsHandler);
router.get("/invoice-completed", getInvoiceCompletedHandler);
router.get("/mail-queue", getMailQueueHandler);
router.post("/refund-fee-rules", createRefundFeeRuleHandler);
router.patch("/refund-line-states", patchRefundLineStatesHandler);
router.post("/refund-migrate-localstorage", migrateRefundLocalStorageHandler);
router.get("/assigned-codes", getAssignedCodesHandler);
router.post("/assign", assignAgencyHandler);
router.patch("/:id", patchElectricBillHandler);

export default router;