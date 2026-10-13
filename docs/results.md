# Analysis and design results

The **Results** tab, the `/api/v1/results/*` and `/api/v1/design/concrete` endpoints, and the MCP results tools
read analysis output from the model open in ETABS. The model must be analysed in ETABS first; the bridge never
runs the analysis.

## Choosing what to read

Pick load cases (only *Finished* cases can be selected) and/or combinations, then **Show results**. The bridge
selects them for output in ETABS (`Results.Setup`), which changes the output selection of your ETABS session
but never model data. That is why these calls are allowed without "Allow write operations".

| View | Source | Notes |
| --- | --- | --- |
| Reactions | `Results.BaseReact` | Base forces and moments. Envelopes give *Max* and *Min* steps. The **Applied gravity** column compares FZ with the load takedown of the pattern with the same name (plus self-weight where the pattern includes it); a mismatch points to missing or misdirected loads. |
| Drifts | `Results.StoryDrifts` | Envelope per story and direction with the governing case, a configurable drift limit (default 0.004 = h/250), and a pass/fail line. |
| Deformed shape | `Results.JointDispl` | Joints moved by a scale factor (auto: largest displacement ≈ 5 % of the building size); members and slabs follow their joints, in the analytical or solid view. Rotations and deflection along members are not drawn. |
| Frame forces | `Results.FrameForce` | P, V2, V3, T, M2, M3 at output stations of one frame; M3 and V2 charts. |
| Concrete design | `DesignConcrete.GetSummaryResultsBeam/Column` | Required top/bottom/longitudinal steel, shear Av/s, PMM ratios per frame and station. |

All values are in the model's present units.

## Design reinforcement in the BOQ

In **Results › Concrete design**, tick *Use this required reinforcement in the BOQ*. Then, for every designed
frame:

- longitudinal steel = max over stations of (top + bottom) for beams, or the PMM area for columns, × length;
- shear steel = mean required Av/s × length × (b + d) (a two-leg closed stirrup);
- mass = volume × 7850 kg/m³.

This is **required** steel (no laps, anchorage, minimum bars or rounding up to bar sizes), so provided steel will be
higher. Frames that were not designed, and slabs and walls, keep the kg/m³ ratios. The same option is
`useDesignRebar` in the MCP tool `etabs_get_boq`.

## Large models

Frame forces and joint displacements for every object and combination can be millions of rows. The endpoints page
(`offset`, `limit`), the web app reads one frame at a time, and the MCP tools default to small pages.
