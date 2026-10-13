/**
 * Per-model project data kept in the browser (localStorage) and exchanged as JSON files:
 * quantity settings, rate table (5D) and schedule settings/overrides (4D).
 *
 * Browser storage is a convenience: it can be cleared or blocked, so every read/write is
 * guarded, and Export/Import JSON is the durable way to keep or share a project.
 */
import { z } from "zod";
import { DEFAULT_QUANTITY_SETTINGS, ELEMENT_CATEGORIES, type QuantitySettings, type RateTable } from "@etabs-bridge/client";

const nonNeg = z.number().finite().min(0);

const QuantitySettingsSchema = z.object({
  rebarRatios: z.object(Object.fromEntries(ELEMENT_CATEGORIES.map((c) => [c, nonNeg])) as Record<(typeof ELEMENT_CATEGORIES)[number], typeof nonNeg>),
  defaultSteelDensity: nonNeg,
  wastagePercent: z.object({ concrete: nonNeg, formwork: nonNeg, rebar: nonNeg, steel: nonNeg }),
});

const RateTableSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  rates: z.record(z.string(), nonNeg),
  isSample: z.boolean(),
});

const ScheduleSettingsSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verticalDays: z.number().int().min(1).max(365),
  horizontalDays: z.number().int().min(1).max(365),
  /** Working days between the end of one floor's slab and the start of the next floor's columns. */
  lagDays: z.number().int().min(0).max(365),
  /** 0 = Sunday ... 6 = Saturday. */
  workingWeekdays: z.array(z.number().int().min(0).max(6)).min(1),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

export type { ScheduleSettings } from "@etabs-bridge/client";

const TaskOverrideSchema = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), finish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const ProjectSchema = z.object({
  format: z.literal("etabs-bridge-project"),
  version: z.literal(1),
  model: z.string(),
  quantitySettings: QuantitySettingsSchema,
  rateTable: RateTableSchema.nullable(),
  boqGroupBy: z.enum(["item", "story"]),
  schedule: ScheduleSettingsSchema.optional(),
  /** Use ETABS concrete design required steel in the BOQ for designed frames (0.6.0). */
  useDesignRebar: z.boolean().optional(),
  /** Manually edited task dates, keyed by task id. */
  taskOverrides: z.record(z.string(), TaskOverrideSchema).optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

export function defaultProject(model: string): Project {
  return {
    format: "etabs-bridge-project",
    version: 1,
    model,
    quantitySettings: structuredClone(DEFAULT_QUANTITY_SETTINGS) as QuantitySettings,
    rateTable: null,
    boqGroupBy: "item",
  };
}

const key = (model: string) => `etabs-bridge.project.${model}`;

export function loadProject(model: string): Project {
  try {
    const raw = localStorage.getItem(key(model));
    if (raw) {
      const parsed = ProjectSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Storage blocked or corrupt: fall back to defaults.
  }
  return defaultProject(model);
}

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(key(project.model), JSON.stringify(project));
  } catch {
    // Quota exceeded or storage blocked; Export JSON still works.
  }
}

/** Validates an imported project file. Returns a readable error instead of throwing. */
export function parseProjectFile(text: string): { project?: Project; error?: string } {
  try {
    const parsed = ProjectSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { error: `Not a valid ETABS Bridge project file: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` };
    return { project: parsed.data };
  } catch (e) {
    return { error: `File is not JSON: ${(e as Error).message}` };
  }
}

export type { RateTable };

/** Saves text as a file via a temporary object URL. */
export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a file picker and resolves with the chosen file's text (null when cancelled). */
export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > 5 * 1024 * 1024) return resolve(null); // 5 MB is far beyond any real project file
      file.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}
