# 4D construction simulation

The **4D Simulation** tab turns the model into a construction sequence and plays it back in 3D. The MCP tool
`etabs_generate_schedule` produces the same schedule for AI assistants.

## How the schedule is generated

ETABS has no schedule data, so a baseline is generated from the model, one story at a time, bottom to top:

| Task | Elements | Duration |
| --- | --- | --- |
| Columns & walls · *story* | columns, walls, braces and other non-beam frames of the story | *vertical days* per story |
| Beams & slab · *story* | beams, slabs/ramps and other areas of the story | *horizontal days* per story |

- The next story's columns start after the slab below plus a **lag** (e.g. curing or striking).
- All durations are **working days**: choose the working weekdays and list holidays (YYYY-MM-DD).
- Stories without elements get no tasks.

## Editing dates

- Change a task's start or finish in the task table, or import dates from CSV (`id,start,finish`
  columns, e.g. after adjusting them in MS Project or Excel).
- An edited task keeps its dates, and the tasks after it are re-sequenced from its finish. This is a simple
  forward pass, not a full critical-path (CPM) schedule with float and logic links.
- **Reset edited dates** goes back to the generated baseline.
- Settings and edited dates are saved per model in the browser, and included in the project JSON export.

## Playback

- The slider and **Play** step through calendar days.
- Elements of tasks that have not started are hidden; elements under construction are drawn in amber; finished
  elements use the normal colours (any *Colour by* mode).
- The bar shows how many objects are built, under construction and still to go.

## 5D: planned cost over time

When sections are available, each task's cost is the sum of its elements' costs (same rates as the
**BOQ & Cost** tab). The cost is spread evenly over the task's working days, giving the **planned-value S-curve**.
Sample rates are flagged everywhere they are used.
