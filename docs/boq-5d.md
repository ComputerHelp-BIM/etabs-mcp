# BOQ and 5D costing

The **BOQ & Cost** tab (web app) and the MCP tool `etabs_get_boq` measure the live ETABS model and price it. The
same code (`packages/client/src/quantities.ts`, `costing.ts`) runs in both, so the numbers agree.

## What is measured

| BOQ item | Unit | Rule |
| --- | --- | --- |
| Concrete *grade* in columns/beams/braces | m³ | section area × centre-line length (joint to joint) |
| Concrete *grade* in slabs/walls | m³ | polygon area × section thickness |
| Formwork to columns | m² | section perimeter × length |
| Formwork to beams | m² | (width + 2 × depth) × length: soffit plus both sides over the full depth |
| Formwork to slabs / walls | m² | soffit area / both faces |
| Reinforcement | kg | concrete volume × kg/m³ ratio per element type (editable; defaults: columns 180, beams 150, slabs 90, walls 110) |
| Structural steel *grade* | t | net section area × length × density (from the material's unit weight, or 7850 kg/m³) |

All quantities are reported in SI (m, m², m³, kg, t) whatever the model's units. They are **gross** quantities:
nothing is deducted where beams frame into columns or slabs sit on beams, which typically overstates a net
measurement by 3-8 %. Objects whose section has no dimensions or thickness (Section Designer, decks, missing
sections) are listed as *unmeasured* rather than guessed.

Rebar from the kg/m³ ratios is an estimate. From 0.6.0, ETABS concrete design results can replace the ratio for
designed frames.

## Rates (5D)

- One rate per concrete grade (`concrete:C35`), per formwork element type (`formwork:Beam`), one for reinforcement
  (`rebar`), and one per steel grade (`steel:S355`).
- A new model starts with **sample INR rates**, clearly flagged in the app and in MCP output (`ratesAreSamples`).
  They are there so the screen is not empty, not as market prices.
- **Currency:** INR by default. The picker lists INR and the ten most traded currencies (USD, EUR, JPY, GBP, CNY,
  AUD, CAD, CHF, HKD, SGD; BIS 2022 FX-turnover ranking); *Other* accepts any ISO 4217 code. Changing it **relabels**
  amounts and never converts rates (sample rates stay flagged as INR samples). Amounts are written as
  `INR 1,72,51,247`: the code avoids an ambiguous `$`, and digit grouping and short forms follow the currency
  (lakh/crore for INR, e.g. `1.7Cr`; thousands/millions elsewhere, e.g. `17.3M`).
- **Rates CSV:** two columns, `rate_key,rate`, plus an optional `currency,XXX` row. Edit it in Excel and import it.
  Invalid rows are reported and skipped.
- **Project JSON:** settings + rates (+ the 4D schedule from 0.4.0) for this model. Use it to back up or share a
  project; browser storage alone can be cleared.

## Exports

- **BOQ CSV:** code, description, story (when grouped by story), unit, quantity, number of objects, rate, amount.
  Text cells that start with `= + - @` are prefixed with `'` so spreadsheet apps do not run them as formulas.
