import { Router, type Request, type Response } from "express";
import { connectDB } from "@/lib/mongodb";
import { SystemModule } from "@/models/SystemModule";

const router = Router();

/** GET /api/system-modules — đọc danh mục đã import (kiểm tra sau deploy / seed Excel). */
router.get("/", async (_req: Request, res: Response) => {
  try {
    await connectDB();
    const rows = await SystemModule.find().sort({ rowIndex: 1 }).lean();
    res.json({
      data: rows.map((d) => ({
        _id: String(d._id),
        code: d.code,
        name: d.name,
        parentCode: d.parentCode,
        rowIndex: d.rowIndex,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      source: "mongodb",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không đọc được MongoDB";
    res.status(503).json({ error: message, data: [] });
  }
});

export default router;
