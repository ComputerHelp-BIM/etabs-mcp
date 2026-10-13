/**
 * 5D costing: a rate table applied to BOQ lines and to individual elements.
 * Rates are user data (edited in the web app, exported/imported as JSON/CSV); the defaults
 * are clearly marked samples so screens are never empty, not market prices.
 */
import type { BoqLine, ElementCategory, ElementQuantity } from "./quantities.js";
import { rateKeyFor } from "./quantities.js";

export interface RateTable {
  /** ISO 4217 code shown with amounts, e.g. "INR", "USD", "AED". */
  currency: string;
  /** Rate per BOQ unit, keyed by BoqLine.rateKey (concrete:<grade>, formwork:<category>, rebar, steel:<grade>, other:<material>). */
  rates: Record<string, number>;
  /** True while the table still contains the generated sample rates. */
  isSample: boolean;
}

/** Sample rates (INR) used to pre-fill a new rate table. Replace with your own. */
export const SAMPLE_RATES_INR = {
  concrete: 7000, // per m³
  formwork: { Column: 750, Beam: 700, Brace: 750, Slab: 600, Wall: 650, Other: 700 } as Record<ElementCategory, number>, // per m²
  rebar: 78, // per kg
  steel: 95000, // per t
  other: 0,
};

/** Builds a rate table with one entry per rate key used by `lines`; existing rates are kept. */
export function defaultRateTable(lines: readonly BoqLine[], existing?: RateTable, currency = "INR"): RateTable {
  const rates: Record<string, number> = {};
  for (const l of lines) {
    if (l.rateKey in rates) continue;
    const kept = existing?.rates[l.rateKey];
    if (kept !== undefined) {
      rates[l.rateKey] = kept;
      continue;
    }
    switch (l.item) {
      case "Concrete":
        rates[l.rateKey] = SAMPLE_RATES_INR.concrete;
        break;
      case "Formwork":
        rates[l.rateKey] = SAMPLE_RATES_INR.formwork[l.category];
        break;
      case "Reinforcement":
        rates[l.rateKey] = SAMPLE_RATES_INR.rebar;
        break;
      case "Structural steel":
        rates[l.rateKey] = SAMPLE_RATES_INR.steel;
        break;
      default:
        rates[l.rateKey] = SAMPLE_RATES_INR.other;
    }
  }
  return { currency: existing?.currency ?? currency, rates, isSample: existing?.isSample ?? true };
}

export interface PricedLine extends BoqLine {
  rate: number;
  amount: number;
}

export interface CostSummary {
  currency: string;
  total: number;
  byItem: Record<string, number>;
  byCategory: Record<string, number>;
  byStory: Record<string, number>;
  /** Rate keys used by the BOQ but missing from the table (priced at 0). */
  missingRates: string[];
}

export function priceBoq(lines: readonly BoqLine[], table: RateTable): PricedLine[] {
  return lines.map((l) => {
    const rate = table.rates[l.rateKey] ?? 0;
    return { ...l, rate, amount: rate * l.quantity };
  });
}

/** Cost of one element (used by 4D to spread cost over time and by "colour by cost"). */
export function elementCost(e: ElementQuantity, table: RateTable): number {
  const r = (key: string) => table.rates[key] ?? 0;
  if (e.family === "Concrete") {
    return (
      e.concreteVolume * r(rateKeyFor("Concrete", e.category, e.material)) +
      e.formwork * r(rateKeyFor("Formwork", e.category, null)) +
      e.rebar * r(rateKeyFor("Reinforcement", e.category, null))
    );
  }
  if (e.family === "Steel") return (e.steel / 1000) * r(rateKeyFor("Structural steel", e.category, e.material));
  return e.concreteVolume * r(rateKeyFor("Other material", e.category, e.material || "unknown"));
}

/**
 * Totals by item, category and story. `byStory` is computed from elements (so it is available
 * even when the BOQ is grouped by item).
 */
export function summarizeCost(priced: readonly PricedLine[], elements: readonly ElementQuantity[], table: RateTable): CostSummary {
  const byItem: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byStory: Record<string, number> = {};
  const missing = new Set<string>();
  let total = 0;
  for (const l of priced) {
    total += l.amount;
    byItem[l.item] = (byItem[l.item] ?? 0) + l.amount;
    byCategory[l.category] = (byCategory[l.category] ?? 0) + l.amount;
    if (!(l.rateKey in table.rates)) missing.add(l.rateKey);
  }
  for (const e of elements) byStory[e.story] = (byStory[e.story] ?? 0) + elementCost(e, table);
  return { currency: table.currency, total, byItem, byCategory, byStory, missingRates: [...missing].sort() };
}

// ------------------------------------------------------------------ CSV

/**
 * RFC 4180 CSV field. Text starting with = + - @ (or tab/CR) gets a leading apostrophe so
 * spreadsheet apps treat it as text, not a formula (CSV injection); numbers are left as-is.
 */
export function csvField(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF/LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** BOQ as CSV (priced when rates are given). Quantities rounded to 3 d.p., amounts to 2. */
export function boqToCsv(lines: readonly PricedLine[] | readonly BoqLine[], currency?: string): string {
  const priced = lines.length > 0 && "amount" in lines[0]!;
  const header = ["Code", "Description", "Story", "Unit", "Quantity", "Objects", ...(priced ? [`Rate (${currency ?? ""})`, `Amount (${currency ?? ""})`] : [])];
  const body = lines.map((l) => [
    l.code,
    l.description,
    l.story ?? "",
    l.unit,
    round(l.quantity, 3),
    l.count,
    ...(priced ? [round((l as PricedLine).rate, 2), round((l as PricedLine).amount, 2)] : []),
  ]);
  return toCsv([header, ...body]);
}

/** Rate table as CSV: rate_key,rate (first row is a header; currency in a comment-like first data row). */
export function ratesToCsv(table: RateTable): string {
  return toCsv([["rate_key", "rate"], ["currency", table.currency], ...Object.entries(table.rates).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v])]);
}

/** Parses ratesToCsv output (or a hand-made sheet with the same two columns). Invalid rates are reported, not guessed. */
export function ratesFromCsv(text: string): { table: RateTable; errors: string[] } {
  const rows = parseCsv(text);
  const errors: string[] = [];
  const rates: Record<string, number> = {};
  let currency = "INR";
  rows.forEach((r, i) => {
    const key = (r[0] ?? "").trim();
    const raw = (r[1] ?? "").trim();
    if (i === 0 && key.toLowerCase() === "rate_key") return;
    if (!key) return;
    if (key.toLowerCase() === "currency") {
      if (/^[A-Za-z]{3}$/.test(raw)) currency = raw.toUpperCase();
      else errors.push(`Row ${i + 1}: currency must be a 3-letter code, got "${raw}"`);
      return;
    }
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) errors.push(`Row ${i + 1}: rate for "${key}" must be a non-negative number, got "${raw}"`);
    else rates[key] = n;
  });
  return { table: { currency, rates, isSample: false }, errors };
}
