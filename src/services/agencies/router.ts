import { Router, type Request, type Response } from "express";
import { agenciesAsTreeRoots } from "@/lib/agency-registry";
import {
  createAgency,
  deleteAgency,
  isMongoDuplicateKeyError,
  listAgencyOptions,
  updateAgencyName,
} from "@/lib/agency-repository";

const router = Router();

async function listHandler(_req: Request, res: Response) {
  try {
    const data = await listAgencyOptions();
    res.json({ data });
  } catch (e) {
    console.error("GET /api/agencies error:", e);
    res.status(500).json({ error: "Lỗi đọc danh sách đại lý" });
  }
}

/** GET /api/agencies — danh sách đại lý (MongoDB) */
router.get("/", listHandler);

/** GET /api/agencies/options — cùng nội dung với GET / (tương thích UI cũ) */
router.get("/options", listHandler);

/** GET /api/agencies/tree — cây cho trang Đại lý */
router.get("/tree", async (_req: Request, res: Response) => {
  try {
    const opts = await listAgencyOptions();
    res.json({ data: agenciesAsTreeRoots(opts) });
  } catch (e) {
    console.error("GET /api/agencies/tree error:", e);
    res.status(500).json({ error: "Lỗi đọc cây đại lý" });
  }
});

/** POST /api/agencies — thêm đại lý (body: { name, code? }) */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as { name?: string; code?: string };
  const name = typeof body.name === "string" ? body.name : "";
  const code = typeof body.code === "string" ? body.code : undefined;
  try {
    const data = await createAgency({ name, code });
    res.json({ data });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Không tạo được")) {
      res.status(400).json({ error: e.message });
      return;
    }
    if (e instanceof Error && e.message === "Tên đại lý không được để trống") {
      res.status(400).json({ error: e.message });
      return;
    }
    if (isMongoDuplicateKeyError(e)) {
      res.status(400).json({ error: "Mã đại lý đã tồn tại" });
      return;
    }
    console.error("POST /api/agencies error:", e);
    res.status(500).json({ error: "Lỗi lưu đại lý" });
  }
});

/** PATCH /api/agencies/:id — sửa tên đại lý (body: { name }) */
router.patch("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  const body = req.body as { name?: string };
  const name = typeof body.name === "string" ? body.name : "";
  try {
    const data = await updateAgencyName({ id, name });
    res.json({ data });
  } catch (e) {
    if (e instanceof Error && e.message === "ID đại lý không hợp lệ") {
      res.status(400).json({ error: e.message });
      return;
    }
    if (e instanceof Error && e.message === "Tên đại lý không được để trống") {
      res.status(400).json({ error: e.message });
      return;
    }
    if (e instanceof Error && e.message === "Không tìm thấy đại lý") {
      res.status(404).json({ error: e.message });
      return;
    }
    console.error("PATCH /api/agencies/:id error:", e);
    res.status(500).json({ error: "Lỗi cập nhật đại lý" });
  }
});

/** DELETE /api/agencies/:id — xóa mềm đại lý */
router.delete("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  try {
    await deleteAgency(id);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "ID đại lý không hợp lệ") {
      res.status(400).json({ error: e.message });
      return;
    }
    if (e instanceof Error && e.message === "Không tìm thấy đại lý") {
      res.status(404).json({ error: e.message });
      return;
    }
    console.error("DELETE /api/agencies/:id error:", e);
    res.status(500).json({ error: "Lỗi xóa đại lý" });
  }
});

export default router;
