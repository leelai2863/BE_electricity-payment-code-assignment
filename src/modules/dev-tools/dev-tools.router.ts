import { Router } from "express";
import { DevToolsController } from "./dev-tools.controller";

const router = Router();

/** Dangerous endpoint: purge all business mock/test data in BE DB. */
router.post("/purge-mock-data", DevToolsController.purgeMockData);

export default router;

