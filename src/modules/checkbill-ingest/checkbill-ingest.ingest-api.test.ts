import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectDBMock: vi.fn(),
  findOneMock: vi.fn(),
  createMock: vi.fn(),
  bulkWriteMock: vi.fn(),
  historyFindMock: vi.fn(),
  findBillsByYearMonthMock: vi.fn(),
  findNonCancelledSplitsByOriginalBillIdsMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  connectDB: mocks.connectDBMock,
}));

vi.mock("@/models/CheckbillIngestBatch", () => ({
  CheckbillIngestBatch: {
    findOne: mocks.findOneMock,
    create: mocks.createMock,
  },
}));

vi.mock("@/models/ChargesStagingRow", () => ({
  ChargesStagingRow: {
    bulkWrite: mocks.bulkWriteMock,
  },
}));

vi.mock("@/models/BillingScanHistory", () => ({
  BillingScanHistory: {
    find: mocks.historyFindMock,
  },
}));

vi.mock("@/modules/electric-bills/electric-bills.repository", () => ({
  findBillsByYearMonth: mocks.findBillsByYearMonthMock,
  findNonCancelledSplitsByOriginalBillIds: mocks.findNonCancelledSplitsByOriginalBillIdsMock,
}));

import { CheckbillIngestController } from "./checkbill-ingest.controller";

function mockFindOneResult(result: unknown) {
  mocks.findOneMock.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(result),
    }),
  });
}

function buildValidPayload() {
  return {
    event_type: "checkbill.charges_snapshot",
    job_id: "job-001",
    charges_snapshot: {
      snapshot_id: 1001,
      completed_at: "2026-04-15T10:00:00.000Z",
      items_truncated: false,
      items: [
        {
          nguon: "EVNCPC",
          ma_kh: "PA123456789",
          so_tien_display: "120.000",
          so_tien_vnd: 120000,
          ten_kh: "Cong ty A",
        },
      ],
    },
  };
}

describe("POST /api/checkbill/charges-snapshot", () => {
  const app = express();
  app.use(express.json());
  app.post("/api/checkbill/charges-snapshot", CheckbillIngestController.ingest);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHECKBILL_INGEST_SECRET = "test-secret";
    process.env.RECEIVED_INGEST_MAX_ITEMS = "5";
    process.env.GATEWAY_CALLBACK_URL = "";
    mocks.connectDBMock.mockResolvedValue(undefined);
    mockFindOneResult(null);
    mocks.createMock.mockResolvedValue({
      _id: "batch-001",
    });
    mocks.bulkWriteMock.mockResolvedValue({ upsertedCount: 1 });
    mocks.historyFindMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    });
    mocks.findBillsByYearMonthMock.mockResolvedValue([]);
    mocks.findNonCancelledSplitsByOriginalBillIdsMock.mockResolvedValue([]);
  });

  it("returns 401 when missing secret auth", async () => {
    const res = await request(app).post("/api/checkbill/charges-snapshot").send(buildValidPayload());

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "Unauthorized",
      code: "INVALID_SECRET",
    });
  });

  it("returns 400 when event_type is wrong", async () => {
    const res = await request(app)
      .post("/api/checkbill/charges-snapshot")
      .set("Authorization", "Bearer test-secret")
      .send({
        event_type: "other",
        job_id: "j",
        charges_snapshot: { items: [] },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/event_type/);
  });

  it("returns 400 when payload is missing required envelope", async () => {
    const res = await request(app)
      .post("/api/checkbill/charges-snapshot")
      .set("Authorization", "Bearer test-secret")
      .send({
        event_type: "checkbill.charges_snapshot",
        charges_snapshot: {},
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Thiếu job_id hoặc charges_snapshot",
    });
  });

  it("returns 200 ACK and batch data when auth and payload are valid", async () => {
    const res = await request(app)
      .post("/api/checkbill/charges-snapshot")
      .set("X-Api-Key", "test-secret")
      .send(buildValidPayload());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({
      batchId: "batch-001",
      jobId: "job-001",
      snapshotId: 1001,
      itemsAccepted: 1,
    });
    expect(mocks.createMock).toHaveBeenCalledTimes(1);
    expect(mocks.bulkWriteMock).toHaveBeenCalledTimes(1);
  });

  it("drops rows already existing in staging by dedupe hash", async () => {
    mocks.bulkWriteMock.mockResolvedValue({ upsertedCount: 0 });
    const res = await request(app)
      .post("/api/checkbill/charges-snapshot")
      .set("Authorization", "Bearer test-secret")
      .send(buildValidPayload());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.itemsAccepted).toBe(0);
    expect(res.body.data.duplicateRowsDropped).toBe(1);
    expect(mocks.bulkWriteMock).toHaveBeenCalledTimes(1);
  });

  it("drops rows already approved (has_bill) in the same completed month", async () => {
    mocks.historyFindMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ customerCode: "PA123456789", amount: 120000 }]),
      }),
    });
    const res = await request(app)
      .post("/api/checkbill/charges-snapshot")
      .set("Authorization", "Bearer test-secret")
      .send(buildValidPayload());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.itemsAccepted).toBe(0);
    expect(res.body.data.duplicateRowsDropped).toBe(1);
    expect(mocks.bulkWriteMock).not.toHaveBeenCalled();
  });

  it("drops row when amount matches split1/split2 of non-cancelled hạ cước (cùng tháng mã hóa đơn)", async () => {
    mocks.findBillsByYearMonthMock.mockResolvedValue([
      { _id: "507f1f77bcf86cd799439011", customerCode: "PA123456789" },
    ]);
    mocks.findNonCancelledSplitsByOriginalBillIdsMock.mockResolvedValue([
      {
        originalBillId: "507f1f77bcf86cd799439011",
        split1: { amount: 100_000 },
        split2: { amount: 120_000 },
      },
    ]);
    const res = await request(app)
      .post("/api/checkbill/charges-snapshot")
      .set("Authorization", "Bearer test-secret")
      .send(buildValidPayload());

    expect(res.status).toBe(200);
    expect(res.body.data.itemsAccepted).toBe(0);
    expect(res.body.data.duplicateRowsDropped).toBe(1);
    expect(mocks.bulkWriteMock).not.toHaveBeenCalled();
  });
});

