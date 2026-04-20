import { Router } from "express";
import {
  createThuChiHandler,
  getThuChiByIdHandler,
  listThuChiHandler,
  removeThuChiHandler,
  updateThuChiHandler,
} from "./accounting-thu-chi.controller";

const router = Router();

router.get("/", listThuChiHandler);
router.get("/:id", getThuChiByIdHandler);
router.post("/", createThuChiHandler);
router.patch("/:id", updateThuChiHandler);
router.delete("/:id", removeThuChiHandler);

export default router;
