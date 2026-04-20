import { Router } from "express";
import {
  createBankCatalogEntryHandler,
  createThuChiHandler,
  getThuChiByIdHandler,
  listBankCatalogHandler,
  listThuChiHandler,
  removeBankCatalogEntryHandler,
  removeThuChiHandler,
  updateBankCatalogEntryHandler,
  updateThuChiHandler,
} from "./accounting-thu-chi.controller";

const router = Router();

/** Phải khai báo trước `/:id` để không bị nuốt bởi param id */
router.get("/bank-catalog", listBankCatalogHandler);
router.post("/bank-catalog", createBankCatalogEntryHandler);
router.patch("/bank-catalog/:id", updateBankCatalogEntryHandler);
router.delete("/bank-catalog/:id", removeBankCatalogEntryHandler);

router.get("/", listThuChiHandler);
router.get("/:id", getThuChiByIdHandler);
router.post("/", createThuChiHandler);
router.patch("/:id", updateThuChiHandler);
router.delete("/:id", removeThuChiHandler);

export default router;
