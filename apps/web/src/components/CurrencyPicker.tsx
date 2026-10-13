import { useId, useState } from "react";
import { CURRENCIES, currencyOption, isCurrencyCode } from "../lib/currency";

const OTHER = "__other__";

export interface CurrencyPickerProps {
  /** Current ISO 4217 code. */
  value: string;
  /** Called with a valid upper-case code. */
  onChange: (code: string) => void;
}

/**
 * Currency select: INR (default) and the ten most traded currencies, or any other ISO 4217 code.
 * Render it with key={value} so an external change (e.g. importing a project) resets the draft.
 * Changing the currency relabels amounts; it never converts rates.
 */
export function CurrencyPicker({ value, onChange }: CurrencyPickerProps) {
  const listed = currencyOption(value) !== undefined;
  const [otherMode, setOtherMode] = useState(!listed);
  const [draft, setDraft] = useState(listed ? "" : value);
  const hintId = useId();
  const draftInvalid = draft.length > 0 && !isCurrencyCode(draft);

  return (
    <div className="currency-picker">
      <label className="inline">
        Currency{" "}
        <select
          value={otherMode ? OTHER : value}
          aria-describedby={hintId}
          onChange={(e) => {
            if (e.target.value === OTHER) {
              setOtherMode(true);
              setDraft(listed ? "" : value);
            } else {
              setOtherMode(false);
              onChange(e.target.value);
            }
          }}
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name} ({c.symbol})
            </option>
          ))}
          <option value={OTHER}>Other (ISO 4217 code)…</option>
        </select>
      </label>
      {otherMode && (
        <input
          className="short"
          value={draft}
          maxLength={3}
          placeholder="AED"
          autoFocus={listed}
          aria-label="Other currency code (ISO 4217, three letters)"
          aria-invalid={draftInvalid}
          onChange={(e) => {
            const code = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
            setDraft(code);
            if (isCurrencyCode(code)) onChange(code);
          }}
        />
      )}
      <p id={hintId} className="muted small">
        Changing the currency relabels amounts; it does not convert rates.
      </p>
    </div>
  );
}
