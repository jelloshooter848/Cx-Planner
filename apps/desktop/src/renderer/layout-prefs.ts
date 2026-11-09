/**
 * How the viewer has arranged the Schedule view: the width of the task table (the splitter
 * between it and the timeline) and which side panels are collapsed. A per-viewer convenience,
 * not project data: kept in the renderer store and remembered in this window's localStorage.
 * Every read and write is wrapped, so a blocked or broken storage only loses the memory.
 */

export interface ScheduleLayout {
  /** Width of the Gantt's task table in px, or null for its natural width (the columns' sum). */
  gridWidth: number | null;
  /** The "Assets in view" sidebar is folded to a thin strip. */
  assetsCollapsed: boolean;
  /** The task / asset details panel is folded to a thin strip. */
  detailsCollapsed: boolean;
}

/** The side panels of the Schedule view that can be collapsed. */
export type SchedulePanel = 'assets' | 'details';

export const DEFAULT_SCHEDULE_LAYOUT: ScheduleLayout = { gridWidth: null, assetsCollapsed: false, detailsCollapsed: false };

/** localStorage key; bump the suffix if the stored shape changes incompatibly. */
export const SCHEDULE_LAYOUT_KEY = 'cx.scheduleLayout.v1';

/** Reads a stored layout, keeping only well-formed fields (anything else falls back to the default). */
export function parseScheduleLayout(raw: string | null | undefined): ScheduleLayout {
  if (!raw) return DEFAULT_SCHEDULE_LAYOUT;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_SCHEDULE_LAYOUT;
  }
  if (!v || typeof v !== 'object') return DEFAULT_SCHEDULE_LAYOUT;
  const o = v as Record<string, unknown>;
  const w = o.gridWidth;
  return {
    gridWidth: typeof w === 'number' && Number.isFinite(w) && w > 0 && w < 10_000 ? Math.round(w) : null,
    assetsCollapsed: o.assetsCollapsed === true,
    detailsCollapsed: o.detailsCollapsed === true,
  };
}

/** Where the store keeps the layout between sessions. */
export interface LayoutStore {
  load(): ScheduleLayout;
  save(layout: ScheduleLayout): void;
}

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * A LayoutStore over a Storage (localStorage by default). Never throws: storage can be
 * missing, blocked or full, and then the layout is simply not remembered.
 */
export function storageLayoutStore(storage?: () => KeyValue | null | undefined): LayoutStore {
  const get = (): KeyValue | null => {
    try {
      return (storage ? storage() : globalThis.localStorage) ?? null;
    } catch {
      return null;
    }
  };
  return {
    load() {
      try {
        return parseScheduleLayout(get()?.getItem(SCHEDULE_LAYOUT_KEY));
      } catch {
        return DEFAULT_SCHEDULE_LAYOUT;
      }
    },
    save(layout) {
      try {
        get()?.setItem(SCHEDULE_LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        // Not remembered; the layout still applies for this session.
      }
    },
  };
}
