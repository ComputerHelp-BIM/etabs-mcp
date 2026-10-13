/**
 * Currencies offered for BOQ rates and costs.
 *
 * INR is the default, followed by the ten most traded currencies (BIS Triennial Central Bank
 * Survey 2022, share of global FX turnover). Any other ISO 4217 code can still be entered.
 *
 * Changing the currency RELABELS amounts; it never converts rates (there is no exchange-rate
 * source, and silently converting a cost plan would be wrong). The UI says so next to the picker.
 *
 * Amounts are shown as "CODE 1,234" rather than with a symbol: "$" alone is ambiguous between USD,
 * AUD, CAD and SGD, which matters on a cost report. Digit grouping and compact notation follow the
 * currency's home convention, e.g. INR uses lakh/crore (12,34,567 and 1.2Cr).
 */

export interface CurrencyOption {
  /** ISO 4217 code. */
  code: string;
  name: string;
  /** Common symbol, shown in the picker only. */
  symbol: string;
  /** Locale whose digit grouping and compact notation are used for this currency. */
  locale: string;
}

export const DEFAULT_CURRENCY = "INR";

export const CURRENCIES: readonly CurrencyOption[] = [
  { code: "INR", name: "Indian rupee", symbol: "₹", locale: "en-IN" },
  { code: "USD", name: "US dollar", symbol: "$", locale: "en-US" },
  { code: "EUR", name: "Euro", symbol: "€", locale: "en-IE" },
  { code: "JPY", name: "Japanese yen", symbol: "¥", locale: "en-JP" },
  { code: "GBP", name: "Pound sterling", symbol: "£", locale: "en-GB" },
  { code: "CNY", name: "Chinese yuan", symbol: "CN¥", locale: "en-CN" },
  { code: "AUD", name: "Australian dollar", symbol: "A$", locale: "en-AU" },
  { code: "CAD", name: "Canadian dollar", symbol: "C$", locale: "en-CA" },
  { code: "CHF", name: "Swiss franc", symbol: "CHF", locale: "en-CH" },
  { code: "HKD", name: "Hong Kong dollar", symbol: "HK$", locale: "en-HK" },
  { code: "SGD", name: "Singapore dollar", symbol: "S$", locale: "en-SG" },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** The listed currency for a code, or undefined for any other code. */
export function currencyOption(code: string): CurrencyOption | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** A syntactically valid ISO 4217 code (three letters, upper case). */
export function isCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

export interface MoneyFormat {
  /** "12,34,567": whole units with the currency's digit grouping, no code (for table cells). */
  amount(n: number): string;
  /** "INR 12,34,567": as amount, prefixed with the currency code. */
  full(n: number): string;
  /** "1.2Cr" / "12.3M": compact amount without the code, for tiles and chart axes. */
  compact(n: number): string;
}

const cache = new Map<string, MoneyFormat>();

/** Formatters for a currency code; unknown codes use the browser's locale. */
export function moneyFormat(code: string): MoneyFormat {
  const key = code.toUpperCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const locale = BY_CODE.get(key)?.locale;
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const short = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const amount = (n: number) => whole.format(Number.isFinite(n) ? n : 0);
  const format: MoneyFormat = {
    amount,
    full: (n) => `${key} ${amount(n)}`,
    compact: (n) => short.format(Number.isFinite(n) ? n : 0),
  };
  cache.set(key, format);
  return format;
}
