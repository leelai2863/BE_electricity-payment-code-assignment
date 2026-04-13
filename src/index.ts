import "dotenv/config";
import express from "express";
import cors from "cors";
import agenciesRouter from "@/services/agencies/router";
import billingScanRouter from "@/services/billing-scan/router";
import electricBillsRouter from "@/services/electric-bills/router";
import vouchersRouter from "@/services/vouchers/router";
import customerAccountsRouter from "@/services/customer-accounts/router";

const app = express();
const PORT = process.env.PORT ?? 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "50mb" }));

app.use("/api/agencies", agenciesRouter);
app.use("/api/billing-scan", billingScanRouter);
app.use("/api/electric-bills", electricBillsRouter);
app.use("/api/vouchers", vouchersRouter);
app.use("/api/customer-accounts", customerAccountsRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
