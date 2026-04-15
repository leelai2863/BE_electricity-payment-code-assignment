import { Router } from "express";
import { AgenciesController } from "./agencies.controller";

const router = Router();

/** GET /api/agencies */
router.get("/", AgenciesController.list);
router.get("/options", AgenciesController.list);
router.get("/tree", AgenciesController.tree);

/** POST /api/agencies */
router.post("/", AgenciesController.create);

/** PATCH /api/agencies/:id */
router.patch("/:id", AgenciesController.update);

/** DELETE /api/agencies/:id */
router.delete("/:id", AgenciesController.delete);

export default router;