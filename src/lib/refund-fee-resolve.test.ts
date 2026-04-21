import { describe, expect, it } from "vitest";
import type { RefundFeeRuleDto } from "@/types/electric-bill";
import { resolveRefundRuleFromRules } from "@/lib/refund-fee-resolve";

function mkRule(partial: Partial<RefundFeeRuleDto>): RefundFeeRuleDto {
  return {
    _id: partial._id ?? Math.random().toString(36).slice(2),
    agencyName: partial.agencyName ?? "1. A NAM",
    feeName: partial.feeName ?? "Phi mac dinh",
    statusLabel: partial.statusLabel ?? "THUONG",
    conditionType: partial.conditionType ?? "manual",
    amountMin: partial.amountMin ?? null,
    amountMax: partial.amountMax ?? null,
    cardType: partial.cardType ?? null,
    pct: partial.pct ?? 0.88,
    effectiveFrom: partial.effectiveFrom ?? "2026-01-01T00:00:00.000Z",
    effectiveTo: partial.effectiveTo ?? null,
    isActive: partial.isActive ?? true,
  };
}

describe("resolveRefundRuleFromRules", () => {
  it("ưu tiên rule cardType trước amount/manual", () => {
    const rules: RefundFeeRuleDto[] = [
      mkRule({ conditionType: "manual", statusLabel: "THUONG", pct: 1 }),
      mkRule({ conditionType: "amount", statusLabel: "DUOI 100", amountMax: 100_000_000, pct: 0.8 }),
      mkRule({ conditionType: "cardType", statusLabel: "VP", cardType: "VP", pct: 0.5 }),
    ];
    const found = resolveRefundRuleFromRules(
      rules,
      "1. A NAM",
      90_000_000,
      "VP",
      new Date("2026-04-17T00:00:00.000Z")
    );
    expect(found?.statusLabel).toBe("VP");
    expect(found?.pct).toBe(0.5);
  });

  it("lọc theo khoảng effectiveFrom/effectiveTo", () => {
    const rules: RefundFeeRuleDto[] = [
      mkRule({
        statusLabel: "OLD",
        pct: 1.2,
        effectiveFrom: "2025-01-01T00:00:00.000Z",
        effectiveTo: "2025-12-31T00:00:00.000Z",
      }),
      mkRule({
        statusLabel: "NEW",
        pct: 0.9,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const found = resolveRefundRuleFromRules(
      rules,
      "1. A NAM",
      50_000_000,
      null,
      new Date("2026-04-17T00:00:00.000Z")
    );
    expect(found?.statusLabel).toBe("NEW");
    expect(found?.pct).toBe(0.9);
  });

  it("match amount band theo số tiền", () => {
    const rules: RefundFeeRuleDto[] = [
      mkRule({
        statusLabel: "DUOI 100",
        conditionType: "amount",
        amountMin: null,
        amountMax: 100_000_000,
        pct: 0.8,
      }),
      mkRule({
        statusLabel: "TREN 100",
        conditionType: "amount",
        amountMin: 100_000_001,
        amountMax: null,
        pct: 1.1,
      }),
    ];
    const found = resolveRefundRuleFromRules(
      rules,
      "1. A NAM",
      180_000_000,
      null,
      new Date("2026-04-17T00:00:00.000Z")
    );
    expect(found?.statusLabel).toBe("TREN 100");
    expect(found?.pct).toBe(1.1);
  });

  it("rule CỐ ĐỊNH (fixed) vẫn khớp mà không cần khoảng số tiền", () => {
    const rules: RefundFeeRuleDto[] = [
      mkRule({
        conditionType: "fixed",
        statusLabel: "CO DINH",
        pct: 0.88,
      }),
    ];
    const found = resolveRefundRuleFromRules(
      rules,
      "1. A NAM",
      50_000_000,
      null,
      new Date("2026-04-17T00:00:00.000Z")
    );
    expect(found?.conditionType).toBe("fixed");
    expect(found?.statusLabel).toBe("CO DINH");
    expect(found?.pct).toBe(0.88);
  });
});

