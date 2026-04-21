import { Router } from "express";
import {
  createThuChiHandler,
  createThuChiBankCatalogHandler,
  deleteThuChiBankCatalogHandler,
  getThuChiByIdHandler,
  listThuChiHandler,
  listThuChiBankCatalogHandler,
  removeThuChiHandler,
  updateThuChiBankCatalogHandler,
  updateThuChiHandler,
} from "./accounting-thu-chi.controller";

const router = Router();

router.get("/", listThuChiHandler);
router.get("/bank-catalog", listThuChiBankCatalogHandler);
router.post("/bank-catalog", createThuChiBankCatalogHandler);
router.patch("/bank-catalog/:id", updateThuChiBankCatalogHandler);
router.delete("/bank-catalog/:id", deleteThuChiBankCatalogHandler);
router.get("/:id", getThuChiByIdHandler);
router.post("/", createThuChiHandler);
router.patch("/:id", updateThuChiHandler);
router.delete("/:id", removeThuChiHandler);

export default router;
