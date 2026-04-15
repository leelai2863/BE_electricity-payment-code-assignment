import { Router } from "express";
import { CustomerAccountController } from "./customer-accounts.controller";

const router = Router();

router.get("/", CustomerAccountController.list);
router.post("/import", CustomerAccountController.import);
router.delete("/:id", CustomerAccountController.delete);
router.patch("/:id", CustomerAccountController.patch);

export default router;