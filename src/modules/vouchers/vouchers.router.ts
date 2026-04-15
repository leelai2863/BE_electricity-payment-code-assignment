import { Router } from "express";
import {
  getVouchersController,
  ocrVoucherController,
  updateVoucherProfileController,
  approveVoucherController,
} from "./vouchers.controller";

const router = Router();

/** GET /api/vouchers?status= */
router.get("/", getVouchersController);

/** POST /api/vouchers/:id/ocr */
router.post("/:id/ocr", ocrVoucherController);

/** PATCH /api/vouchers/:id/profile */
router.patch("/:id/profile", updateVoucherProfileController);

/** POST /api/vouchers/:id/approve */
router.post("/:id/approve", approveVoucherController);

export default router;