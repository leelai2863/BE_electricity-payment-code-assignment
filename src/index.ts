import "dotenv/config";
import "@/types/express-augment";
import express from "express";
import cors from "cors";
import { bootstrapElecSharedLogger } from "@/lib/elec-shared-logger";
import { attachFujiIdentityFromHeaders } from "@/lib/fuji-identity.middleware";
import agenciesRouter from "@/modules/agencies/agencies.router";
import billingScanRouter from "@/modules/billing-scan/billing-scan.router";
import checkbillIngestRouter from "@/modules/checkbill-ingest/checkbill-ingest.router";
import electricBillsRouter from "@/modules/electric-bills/electric-bills.router";
import { startPaymentDeadlineSyncWorker } from "@/modules/electric-bills/payment-deadline-sync.service";
import vouchersRouter from "@/modules/vouchers/vouchers.router";
import customerAccountsRouter from "@/modules/customer-accounts/customer-accounts.router";
import devToolsRouter from "@/modules/dev-tools/dev-tools.router";
import accountingThuChiRouter from "@/modules/accounting-thu-chi/accounting-thu-chi.router";

bootstrapElecSharedLogger();

const app = express();
const PORT = process.env.PORT ?? 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "50mb" }));
app.use(attachFujiIdentityFromHeaders);

app.use("/api/agencies", agenciesRouter);
app.use("/api/billing-scan", billingScanRouter);
app.use("/api/checkbill", checkbillIngestRouter);
app.use("/api/electric-bills", electricBillsRouter);
app.use("/api/vouchers", vouchersRouter);
app.use("/api/customer-accounts", customerAccountsRouter);
app.use("/api/dev-tools", devToolsRouter);
app.use("/api/accounting/thu-chi", accountingThuChiRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

startPaymentDeadlineSyncWorker();

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
