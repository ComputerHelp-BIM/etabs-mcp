import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  costCurve,
  defaultRateTable,
  defaultScheduleSettings,
  buildBoq,
  generateSchedule,
  isoFromTime,
  overridesFromCsvRows,
  parseCsv,
  parseIso,
  scheduleSpan,
  statusAt,
  taskCosts,
  tasksToCsvRows,
  toCsv,
  type ElementQuantity,
  type GeometrySnapshot,
  type ScheduleSettings,
  type ScheduleTask,
  type SectionsResult,
} from "@etabs-bridge/client";
import type { Project } from "../state/projectStore";
import { downloadText, pickTextFile } from "../state/projectStore";
import { GanttChart, LineChart } from "./charts";
import { DEFAULT_CURRENCY, moneyFormat } from "../lib/currency";
import type { Selection } from "./ModelViewer";

const ModelViewer = lazy(() => import("./ModelViewer").then((m) => ({ default: m.ModelViewer })));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY = 86_400_000;

interface Props {
  geometry: GeometrySnapshot;
  sections: SectionsResult | null;
  elements: ElementQuantity[] | null;
  project: Project;
  update: (fn: (p: Project) => Project) => void;
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

/** 4D construction simulation (+ 5D planned-cost curve when quantities are available). */
export function FourDView({ geometry, sections, elements, project, update }: Props) {
  const settings: ScheduleSettings = useMemo(() => project.schedule ?? defaultScheduleSettings(), [project.schedule]);
  const overrides = useMemo(() => project.taskOverrides ?? {}, [project.taskOverrides]);
  const [message, setMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  const { tasks, error } = useMemo<{ tasks: ScheduleTask[]; error: string | null }>(() => {
    try {
      return { tasks: generateSchedule(geometry, settings, overrides), error: null };
    } catch (e) {
      return { tasks: [], error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settings/overrides are derived from project
  }, [geometry, project.schedule, project.taskOverrides]);
  const span = scheduleSpan(tasks);

  // Playback: day index from the schedule start.
  const totalDays = span ? Math.round((parseIso(span.finish) - parseIso(span.start)) / DAY) + 1 : 0;
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setDay((d) => Math.min(totalDays, d + speed)), 250);
    return () => clearInterval(id);
  }, [playing, speed, totalDays]);
  useEffect(() => {
    if (playing && day >= totalDays) setPlaying(false);
  }, [playing, day, totalDays]);
  const current = span ? Math.min(parseIso(span.start) + day * DAY, parseIso(span.finish) + DAY) : null;
  const currentIso = current !== null ? isoFromTime(current) : null;
  const status = useMemo(() => (currentIso ? statusAt(tasks, currentIso) : null), [tasks, currentIso]);

  // 5D: cost per task and planned value curve.
  const rateTable = useMemo(
    () => (elements ? defaultRateTable(buildBoq(elements, { settings: project.quantitySettings }), project.rateTable ?? undefined) : null),
    [elements, project.quantitySettings, project.rateTable],
  );
  const costs = useMemo(() => (elements && rateTable ? taskCosts(tasks, elements, rateTable) : null), [tasks, elements, rateTable]);
  const currency = rateTable?.currency ?? DEFAULT_CURRENCY;
  const money = moneyFormat(currency);
  const curve = useMemo(() => (costs ? costCurve(tasks, costs, settings) : []), [tasks, costs, settings]);
  const costToDate = current !== null ? (curve.filter((p) => p.t <= current - DAY).pop()?.cumulative ?? 0) : 0;
  const totalCost = curve[curve.length - 1]?.cumulative ?? 0;

  const setSettings = (patch: Partial<ScheduleSettings>) => update((p) => ({ ...p, schedule: { ...settings, ...patch } }));
  const setOverride = (task: ScheduleTask, field: "start" | "finish", value: string) =>
    update((p) => ({ ...p, taskOverrides: { ...overrides, [task.id]: { start: task.start, finish: task.finish, [field]: value } } }));

  const counts = status ? countStatus(status) : null;
  const base = geometry.model.fileName.replace(/\.[^.]+$/, "") || "model";

  return (
    <div className="pad fourd">
      {error && <p className="error">{error}</p>}
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}

      <section className="card pad-sm settings-row">
        <label>
          Start
          <input type="date" value={settings.startDate} onChange={(e) => e.target.value && setSettings({ startDate: e.target.value })} />
        </label>
        <IntField label="Columns & walls (days/story)" value={settings.verticalDays} min={1} onChange={(v) => setSettings({ verticalDays: v })} />
        <IntField label="Beams & slab (days/story)" value={settings.horizontalDays} min={1} onChange={(v) => setSettings({ horizontalDays: v })} />
        <IntField label="Lag between floors (days)" value={settings.lagDays} min={0} onChange={(v) => setSettings({ lagDays: v })} />
        <fieldset className="weekdays">
          <legend>Working days</legend>
          {WEEKDAYS.map((w, i) => (
            <label key={w} className="check">
              <input
                type="checkbox"
                checked={settings.workingWeekdays.includes(i)}
                onChange={(e) => {
                  const next = e.target.checked ? [...settings.workingWeekdays, i].sort() : settings.workingWeekdays.filter((d) => d !== i);
                  if (next.length) setSettings({ workingWeekdays: next });
                }}
              />
              {w}
            </label>
          ))}
        </fieldset>
        <label className="grow">
          Holidays (YYYY-MM-DD, comma separated)
          <input
            defaultValue={settings.holidays.join(", ")}
            onBlur={(e) => setSettings({ holidays: e.target.value.split(/[\s,]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) })}
          />
        </label>
      </section>

      {span && (
        <div className="playback card pad-sm">
          <button type="button" className="primary" onClick={() => (day >= totalDays ? (setDay(0), setPlaying(true)) : setPlaying((p) => !p))}>
            {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={totalDays}
            value={Math.min(day, totalDays)}
            onChange={(e) => {
              setPlaying(false);
              setDay(Number(e.target.value));
            }}
            aria-label="Simulation date"
            className="grow"
          />
          <strong className="date">{current !== null ? fmtDate(current) : ""}</strong>
          <label>
            Speed{" "}
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={1}>1 day/step</option>
              <option value={3}>3 days/step</option>
              <option value={7}>1 week/step</option>
            </select>
          </label>
          {counts && (
            <span className="muted">
              {counts.complete} built · {counts.inProgress} under construction · {counts.notStarted} to go
            </span>
          )}
          {costs && (
            <span>
              Planned cost to date: <strong>{currency} {money.compact(costToDate)}</strong> of {money.compact(totalCost)}
              {rateTable?.isSample && <span className="muted"> (sample rates)</span>}
            </span>
          )}
        </div>
      )}

      <div className="viewer-layout fourd-layout">
        <Suspense fallback={<p className="muted pad">Loading 3D engine…</p>}>
          <ModelViewer geometry={geometry} sections={sections} selection={selection} onSelect={setSelection} status={status} />
        </Suspense>
        <aside className="card pad-sm">
          <h2>Schedule</h2>
          {span ? (
            <dl className="facts">
              <dt>Start</dt>
              <dd>{fmtDate(parseIso(span.start))}</dd>
              <dt>Finish</dt>
              <dd>{fmtDate(parseIso(span.finish))}</dd>
              <dt>Duration</dt>
              <dd>{span.calendarDays} calendar days</dd>
              <dt>Tasks</dt>
              <dd>{tasks.length}</dd>
            </dl>
          ) : (
            <p className="muted">No elements to schedule.</p>
          )}
          <div className="stack">
            <button type="button" onClick={() => downloadText(`${base}-schedule.csv`, toCsv(tasksToCsvRows(tasks)), "text/csv")}>
              Export schedule (CSV)
            </button>
            <button
              type="button"
              onClick={async () => {
                const text = await pickTextFile(".csv,text/csv");
                if (text === null) return;
                const { overrides: imported, errors } = overridesFromCsvRows(parseCsv(text), new Set(tasks.map((t) => t.id)));
                update((p) => ({ ...p, taskOverrides: { ...overrides, ...imported } }));
                setMessage(`Imported ${Object.keys(imported).length} task date(s)${errors.length ? `; ${errors.length} row(s) skipped: ${errors.slice(0, 2).join("; ")}` : ""}.`);
              }}
            >
              Import dates (CSV)
            </button>
            <button type="button" disabled={Object.keys(overrides).length === 0} onClick={() => update((p) => ({ ...p, taskOverrides: {} }))}>
              Reset edited dates
            </button>
          </div>
          <p className="muted small">Edited tasks keep their dates; the tasks after them are re-sequenced from their finish.</p>
        </aside>
      </div>

      {tasks.length > 0 && (
        <section className="card pad-sm">
          <h2>Gantt</h2>
          <GanttChart
            tasks={tasks.map((t) => ({
              id: t.id,
              label: t.name.replace(" - ", " · "),
              series: t.phase === "Vertical" ? 0 : 1,
              start: parseIso(t.start),
              finish: parseIso(t.finish),
              detail: `${t.start} → ${t.finish} · ${t.durationDays} working days · ${t.elements.length} objects${costs ? ` · ${money.full(costs.get(t.id) ?? 0)}` : ""}`,
            }))}
            seriesNames={["Columns & walls", "Beams & slab"]}
            marker={current}
            formatDate={fmtDate}
            ariaLabel="Construction schedule"
          />
        </section>
      )}

      {curve.length > 1 && (
        <section className="card pad-sm">
          <h2>Planned cost (S-curve, {currency})</h2>
          <LineChart
            series={[{ name: "Cumulative planned cost", points: curve.map((p) => ({ x: p.t, y: p.cumulative })) }]}
            formatX={fmtDate}
            formatY={(v) => money.compact(v)}
            area
            marker={current}
            ariaLabel="Cumulative planned cost over time"
          />
        </section>
      )}

      <h2>Tasks</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Start</th>
              <th>Finish</th>
              <th className="num">Working days</th>
              <th className="num">Objects</th>
              {costs && <th className="num">Cost ({currency})</th>}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className={t.edited ? "edited" : undefined}>
                <td>
                  {t.name}
                  {t.edited && <span className="badge">edited</span>}
                </td>
                <td>
                  <input type="date" value={t.start} onChange={(e) => e.target.value && setOverride(t, "start", e.target.value)} aria-label={`Start of ${t.name}`} />
                </td>
                <td>
                  <input type="date" value={t.finish} onChange={(e) => e.target.value && setOverride(t, "finish", e.target.value)} aria-label={`Finish of ${t.name}`} />
                </td>
                <td className="num">{t.durationDays}</td>
                <td className="num">{t.elements.length}</td>
                {costs && <td className="num">{money.amount(costs.get(t.id) ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function countStatus(status: ReadonlyMap<string, string>) {
  let complete = 0;
  let inProgress = 0;
  let notStarted = 0;
  for (const s of status.values()) {
    if (s === "complete") complete++;
    else if (s === "in-progress") inProgress++;
    else notStarted++;
  }
  return { complete, inProgress, notStarted };
}

function IntField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (v: number) => void }) {
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={365}
        step={1}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= min && n <= 365) onChange(n);
        }}
        className="short"
      />
    </label>
  );
}
