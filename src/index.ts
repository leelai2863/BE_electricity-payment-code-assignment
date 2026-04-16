import "dotenv/config";
import express from "express";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import agenciesRouter from "@/modules/agencies/agencies.router";
import billingScanRouter from "@/modules/billing-scan/billing-scan.router";
import checkbillIngestRouter from "@/modules/checkbill-ingest/checkbill-ingest.router";
import electricBillsRouter from "@/modules/electric-bills/electric-bills.router";
import vouchersRouter from "@/modules/vouchers/vouchers.router";
import customerAccountsRouter from "@/modules/customer-accounts/customer-accounts.router";
import devToolsRouter from "@/modules/dev-tools/dev-tools.router";
import { BillingScanService } from "@/modules/billing-scan/billing-scan.service";

const app = express();
const PORT = process.env.PORT ?? 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "50mb" }));
app.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt;
    const ip = req.ip || req.socket.remoteAddress || "-";
    // Concise access log for all requests (curl, browser, services).
    console.log(`[REQ] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${elapsedMs}ms ip=${ip}`);
  });
  next();
});

app.use("/api/agencies", agenciesRouter);
app.use("/api/billing-scan", billingScanRouter);
app.use("/api/checkbill", checkbillIngestRouter);
app.use("/api/electric-bills", electricBillsRouter);
app.use("/api/vouchers", vouchersRouter);
app.use("/api/customer-accounts", customerAccountsRouter);
app.use("/api/dev-tools", devToolsRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);

  const shouldAutoSeed = String(process.env.BILLING_SCAN_LOCAL_MOCK_AUTO_SEED ?? "").trim() === "1";
  if (shouldAutoSeed) {
    void BillingScanService.seedLocalMockScannedCodes()
      .then((result) => {
        if (result.status === 410) {
          console.log(`[MOCK] Billing scan local seed skipped: ${JSON.stringify(result.payload)}`);
          return;
        }
        console.log(`[MOCK] Billing scan local seed skipped: ${JSON.stringify(result.payload)}`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown_error";
        console.error(`[MOCK] Billing scan local seed failed: ${message}`);
      });
  }
});
