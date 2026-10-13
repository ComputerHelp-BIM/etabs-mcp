import { describe, expect, it } from "vitest";
import { CURRENCIES, DEFAULT_CURRENCY, currencyOption, isCurrencyCode, moneyFormat } from "../src/lib/currency";

describe("currencies", () => {
  it("lists INR first (the default) and then the ten most traded currencies", () => {
    expect(DEFAULT_CURRENCY).toBe("INR");
    expect(CURRENCIES.map((c) => c.code)).toEqual(["INR", "USD", "EUR", "JPY", "GBP", "CNY", "AUD", "CAD", "CHF", "HKD", "SGD"]);
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length);
  });

  it("every listed currency is a valid ISO code that Intl knows", () => {
    for (const c of CURRENCIES) {
      expect(isCurrencyCode(c.code)).toBe(true);
      expect(() => new Intl.NumberFormat(c.locale, { style: "currency", currency: c.code })).not.toThrow();
    }
  });

  it("looks up listed codes case-insensitively and rejects others", () => {
    expect(currencyOption("usd")?.name).toBe("US dollar");
    expect(currencyOption("AED")).toBeUndefined();
    expect(isCurrencyCode("AED")).toBe(true);
    expect(isCurrencyCode("aed")).toBe(false);
    expect(isCurrencyCode("AE")).toBe(false);
  });

  it("formats INR with lakh/crore grouping and compact notation", () => {
    const inr = moneyFormat("INR");
    expect(inr.full(12345678.4)).toBe("INR 1,23,45,678");
    expect(inr.amount(150000)).toBe("1,50,000");
    expect(inr.compact(12345678)).toBe("1.2Cr");
    expect(inr.compact(250000)).toBe("2.5L");
  });

  it("formats other currencies with their usual grouping", () => {
    expect(moneyFormat("USD").full(12345678)).toBe("USD 12,345,678");
    expect(moneyFormat("EUR").compact(12345678)).toBe("12.3M");
    expect(moneyFormat("aed").full(1500)).toMatch(/^AED 1,?500$/);
  });

  it("never prints NaN or Infinity", () => {
    expect(moneyFormat("INR").full(Number.NaN)).toBe("INR 0");
    expect(moneyFormat("USD").compact(Number.POSITIVE_INFINITY)).toBe("0");
  });
});
