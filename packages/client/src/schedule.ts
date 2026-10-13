/**
 * 4D: construction schedule generated from the model, element status at a date, and the
 * planned-cost S-curve (4D + 5D).
 *
 * Sequence (per story, bottom to top):
 *   V(story)  "Columns & walls"  - columns, walls, braces and other vertical/frame elements of the story
 *   H(story)  "Beams & slab"     - beams, slabs and other horizontal elements of the story
 *   V(n) starts after H(n-1) finishes + lag; H(n) starts the working day after V(n) finishes.
 * Durations are in working days (calendar = working weekdays minus holidays). A task whose dates were
 * edited keeps them, and the tasks after it are re-sequenced from its finish (simple forward pass,
 * not a full CPM with float).
 *
 * Dates are ISO "YYYY-MM-DD" strings handled in UTC so time zones never shift a day.
 */
import type { GeometrySnapshot } from "./schemas.js";
import { areaCategory, frameCategory, type ElementQuantity } from "./quantities.js";
import { elementCost, type RateTable } from "./costing.js";

export interface ScheduleSettings {
  startDate: string;
  /** Working days for columns & walls of one story. */
  verticalDays: number;
  /** Working days for beams & slab of one story. */
  horizontalDays: number;
  /** Working days between a story's slab and the next story's columns (e.g. curing). */
  lagDays: number;
  /** 0 = Sunday ... 6 = Saturday. */
  workingWeekdays: number[];
  holidays: string[];
}

export function defaultScheduleSettings(today = new Date()): ScheduleSettings {
  return {
    startDate: toIso(today),
    verticalDays: 5,
    horizontalDays: 7,
    lagDays: 2,
    workingWeekdays: [1, 2, 3, 4, 5, 6],
    holidays: [],
  };
}

export type Phase = "Vertical" | "Horizontal";

export interface ScheduleTask {
  id: string;
  name: string;
  story: string;
  phase: Phase;
  /** First working day (inclusive). */
  start: string;
  /** Last working day (inclusive). */
  finish: string;
  /** Working days between start and finish inclusive. */
  durationDays: number;
  /** "frame:<name>" / "area:<name>" */
  elements: string[];
  /** True when start/finish came from a manual edit. */
  edited: boolean;
}

export type TaskOverrides = Record<string, { start: string; finish: string }>;

// ------------------------------------------------------------------ dates & calendar

const DAY = 86_400_000;

export function toIso(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

export function parseIso(s: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date "${s}" (expected YYYY-MM-DD)`);
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Invalid date "${s}"`);
  return t;
}

export function isoFromTime(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export class WorkCalendar {
  private readonly weekdays: Set<number>;
  private readonly holidays: Set<string>;

  constructor(settings: Pick<ScheduleSettings, "workingWeekdays" | "holidays">) {
    this.weekdays = new Set(settings.workingWeekdays);
    if (this.weekdays.size === 0) throw new Error("At least one working weekday is required");
    this.holidays = new Set(settings.holidays);
  }

  isWorkingDay(t: number): boolean {
    return this.weekdays.has(new Date(t).getUTCDay()) && !this.holidays.has(isoFromTime(t));
  }

  /** Same day if it is a working day, else the next working day. */
  nextWorkingDay(t: number): number {
    let d = t;
    for (let i = 0; i < 3660 && !this.isWorkingDay(d); i++) d += DAY;
    return d;
  }

  /** Finish date (inclusive) of a task of `days` working days starting at working day `start`. */
  finishAfter(start: number, days: number): number {
    let d = this.nextWorkingDay(start);
    for (let left = Math.max(1, days) - 1; left > 0; left--) d = this.nextWorkingDay(d + DAY);
    return d;
  }

  /** Working day `n` working days after `t` (n >= 0); n = 0 returns the next working day after t. */
  addWorkingDays(t: number, n: number): number {
    let d = this.nextWorkingDay(t + DAY);
    for (let i = 0; i < n; i++) d = this.nextWorkingDay(d + DAY);
    return d;
  }

  /** Working days in [from, to] inclusive. */
  countWorkingDays(from: number, to: number): number {
    let n = 0;
    for (let d = from; d <= to; d += DAY) if (this.isWorkingDay(d)) n++;
    return n;
  }
}

// ------------------------------------------------------------------ generation

export const elementKey = (kind: "frame" | "area", name: string) => `${kind}:${name}`;

/** Generates the story-by-story schedule; stories without elements get no tasks. */
export function generateSchedule(geometry: GeometrySnapshot, settings: ScheduleSettings, overrides: TaskOverrides = {}): ScheduleTask[] {
  const cal = new WorkCalendar(settings);
  const storyOrder = ["Base", ...geometry.stories.map((s) => s.name)];
  const groups = new Map<string, { V: string[]; H: string[] }>();
  const group = (story: string) => {
    let g = groups.get(story);
    if (!g) groups.set(story, (g = { V: [], H: [] }));
    return g;
  };
  for (const f of geometry.frames) {
    const c = frameCategory(f);
    group(f.story)[c === "Beam" ? "H" : "V"].push(elementKey("frame", f.name));
  }
  for (const a of geometry.areas) {
    const c = areaCategory(a);
    group(a.story)[c === "Wall" ? "V" : "H"].push(elementKey("area", a.name));
  }
  const ordered = [...groups.keys()].sort((a, b) => rank(storyOrder, a) - rank(storyOrder, b));

  const tasks: ScheduleTask[] = [];
  let ready = cal.nextWorkingDay(parseIso(settings.startDate)); // earliest start of the next task
  for (const story of ordered) {
    const g = groups.get(story)!;
    for (const phase of ["Vertical", "Horizontal"] as const) {
      const elements = phase === "Vertical" ? g.V : g.H;
      if (elements.length === 0) continue;
      const id = `${phase === "Vertical" ? "V" : "H"}-${story}`;
      const days = phase === "Vertical" ? settings.verticalDays : settings.horizontalDays;
      const o = overrides[id];
      let start: number;
      let finish: number;
      let edited = false;
      if (o && isValidRange(o)) {
        start = parseIso(o.start);
        finish = parseIso(o.finish);
        edited = true;
      } else {
        start = ready;
        finish = cal.finishAfter(start, days);
      }
      tasks.push({
        id,
        name: `${phase === "Vertical" ? "Columns & walls" : "Beams & slab"} - ${story}`,
        story,
        phase,
        start: isoFromTime(start),
        finish: isoFromTime(finish),
        durationDays: Math.max(1, cal.countWorkingDays(start, finish)),
        elements,
        edited,
      });
      ready = phase === "Horizontal" ? cal.addWorkingDays(finish, settings.lagDays) : cal.addWorkingDays(finish, 0);
    }
  }
  return tasks;
}

function rank(order: string[], story: string): number {
  const i = order.indexOf(story);
  return i < 0 ? -1 : i; // unknown stories first (below the base)
}

function isValidRange(o: { start: string; finish: string }): boolean {
  try {
    return parseIso(o.finish) >= parseIso(o.start);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ status at a date

export type ElementStatus = "not-started" | "in-progress" | "complete";

/** Status of every scheduled element on `date` (elements not in any task are absent). */
export function statusAt(tasks: readonly ScheduleTask[], date: string): Map<string, ElementStatus> {
  const t = parseIso(date);
  const out = new Map<string, ElementStatus>();
  for (const task of tasks) {
    const s = parseIso(task.start);
    const f = parseIso(task.finish);
    const status: ElementStatus = t < s ? "not-started" : t > f ? "complete" : "in-progress";
    for (const e of task.elements) out.set(e, status);
  }
  return out;
}

export function scheduleSpan(tasks: readonly ScheduleTask[]): { start: string; finish: string; calendarDays: number } | null {
  if (tasks.length === 0) return null;
  const start = Math.min(...tasks.map((t) => parseIso(t.start)));
  const finish = Math.max(...tasks.map((t) => parseIso(t.finish)));
  return { start: isoFromTime(start), finish: isoFromTime(finish), calendarDays: Math.round((finish - start) / DAY) + 1 };
}

// ------------------------------------------------------------------ 4D + 5D

export interface CostPoint {
  /** Date as UTC milliseconds. */
  t: number;
  /** Cumulative planned cost at the end of this day. */
  cumulative: number;
}

/** Cost of each task (sum of its elements' costs). */
export function taskCosts(tasks: readonly ScheduleTask[], elements: readonly ElementQuantity[], rates: RateTable): Map<string, number> {
  const cost = new Map(elements.map((e) => [elementKey(e.kind, e.name), elementCost(e, rates)]));
  return new Map(tasks.map((t) => [t.id, t.elements.reduce((s, k) => s + (cost.get(k) ?? 0), 0)]));
}

/** Planned value curve: each task's cost spread evenly over its working days. One point per calendar day. */
export function costCurve(tasks: readonly ScheduleTask[], costs: ReadonlyMap<string, number>, settings: Pick<ScheduleSettings, "workingWeekdays" | "holidays">): CostPoint[] {
  const span = scheduleSpan(tasks);
  if (!span) return [];
  const cal = new WorkCalendar(settings);
  const daily = new Map<number, number>();
  for (const task of tasks) {
    const s = parseIso(task.start);
    const f = parseIso(task.finish);
    const working: number[] = [];
    for (let d = s; d <= f; d += DAY) if (cal.isWorkingDay(d)) working.push(d);
    const days = working.length ? working : [s]; // an edited task on non-working days still spends its cost
    const per = (costs.get(task.id) ?? 0) / days.length;
    for (const d of days) daily.set(d, (daily.get(d) ?? 0) + per);
  }
  const points: CostPoint[] = [];
  let cumulative = 0;
  for (let d = parseIso(span.start); d <= parseIso(span.finish); d += DAY) {
    cumulative += daily.get(d) ?? 0;
    points.push({ t: d, cumulative });
  }
  return points;
}

// ------------------------------------------------------------------ CSV

/** Task table for MS Project / Excel: id,name,story,phase,start,finish,duration_days,objects */
export function tasksToCsvRows(tasks: readonly ScheduleTask[]): Array<Array<string | number>> {
  return [
    ["id", "name", "story", "phase", "start", "finish", "duration_days", "objects"],
    ...tasks.map((t) => [t.id, t.name, t.story, t.phase, t.start, t.finish, t.durationDays, t.elements.length]),
  ];
}

/**
 * Reads edited dates back from a task CSV (columns id,start,finish by header name). Rows whose id is
 * unknown, or whose dates are invalid or reversed, are reported and skipped.
 */
export function overridesFromCsvRows(rows: string[][], knownIds: ReadonlySet<string>): { overrides: TaskOverrides; errors: string[] } {
  const errors: string[] = [];
  const overrides: TaskOverrides = {};
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [ci, cs, cf] = [col("id"), col("start"), col("finish")];
  if (ci < 0 || cs < 0 || cf < 0) return { overrides, errors: ["The CSV needs a header row with id, start and finish columns."] };
  rows.slice(1).forEach((r, i) => {
    const id = (r[ci] ?? "").trim();
    const start = (r[cs] ?? "").trim();
    const finish = (r[cf] ?? "").trim();
    const row = i + 2;
    if (!knownIds.has(id)) return void errors.push(`Row ${row}: unknown task id "${id}"`);
    if (!isValidRange({ start, finish })) return void errors.push(`Row ${row}: invalid or reversed dates "${start}" to "${finish}"`);
    overrides[id] = { start, finish };
  });
  return { overrides, errors };
}
