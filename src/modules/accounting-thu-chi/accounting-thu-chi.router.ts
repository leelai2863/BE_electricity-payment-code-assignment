import { Router } from "express";
import {
  createThuChiHandler,
  createThuChiBankCatalogHandler,
  createThuChiSourceCatalogHandler,
  deleteThuChiBankCatalogHandler,
  deleteThuChiSourceCatalogHandler,
  getThuChiByIdHandler,
  listThuChiHandler,
  listThuChiBankCatalogHandler,
  listThuChiSourceCatalogHandler,
  previewHaCuocHandler,
  removeThuChiHandler,
  updateThuChiBankCatalogHandler,
  updateThuChiSourceCatalogHandler,
  updateThuChiHandler,
} from "./accounting-thu-chi.controller";

const router = Router();

router.get("/", listThuChiHandler);
router.get("/bank-catalog", listThuChiBankCatalogHandler);
router.post("/bank-catalog", createThuChiBankCatalogHandler);
router.patch("/bank-catalog/:id", updateThuChiBankCatalogHandler);
router.delete("/bank-catalog/:id", deleteThuChiBankCatalogHandler);
router.get("/source-catalog", listThuChiSourceCatalogHandler);
router.post("/source-catalog", createThuChiSourceCatalogHandler);
router.patch("/source-catalog/:id", updateThuChiSourceCatalogHandler);
router.delete("/source-catalog/:id", deleteThuChiSourceCatalogHandler);
router.get("/ha-cuoc/preview", previewHaCuocHandler);
router.get("/:id", getThuChiByIdHandler);
router.post("/", createThuChiHandler);
router.patch("/:id", updateThuChiHandler);
router.delete("/:id", removeThuChiHandler);

export default router;
