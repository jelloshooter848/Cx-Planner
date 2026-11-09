/**
 * Core domain types. Dates are ISO calendar dates ("YYYY-MM-DD") with no time zone;
 * durations are in working days.
 */

export type IsoDate = string;
export type Id = string;

/** Task kinds. Holds and witness points are tasks that gate what follows. */
export type TaskType = 'task' | 'hold' | 'witness' | 'milestone';

/** Readiness letters: Tools, Information, Materials, Expectations, Safety. */
export const TIMES_KEYS = ['T', 'I', 'M', 'E', 'S'] as const;
export type TimesKey = (typeof TIMES_KEYS)[number];

/** Five readiness states. Each has its own symbol; status never depends on colour alone. */
export type ReadinessState = 'ready' | 'progress' | 'needed' | 'na' | 'blocked';

export type Readiness = Record<TimesKey, ReadinessState>;

/** FS = finish-to-start, SS = start-to-start, FF = finish-to-finish, SF = start-to-finish. */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Dependency {
  predecessorId: Id;
  successorId: Id;
  type: DependencyType;
  /** Lag in working days; may be negative (lead). */
  lagDays: number;
}

export interface Asset {
  id: Id;
  tag: string;
  description: string;
  location?: string;
  system?: string;
  templateId?: string;
  /** Version of the template snapshot the asset's tasks were created from. */
  templateVersion?: number;
}

export interface Task {
  id: Id;
  assetId: Id;
  /** Display number such as "1.4". */
  code: string;
  name: string;
  type: TaskType;
  /** Working days. Milestones are 0. */
  durationDays: number;
  percentComplete: number;
  responsible?: string;
  /** Start no earlier than this date. */
  startNoEarlierThan?: IsoDate;
  actualStart?: IsoDate;
  actualFinish?: IsoDate;
  readiness?: Readiness;
  /** Key of the template task this task was created from (stable within the template). */
  templateKey?: string;
}

export interface CalendarDef {
  /** 0 = Sunday ... 6 = Saturday. Default Monday to Friday. */
  workWeekdays: number[];
  holidays: IsoDate[];
}

export interface Project {
  id: Id;
  name: string;
  subtitle?: string;
  startDate: IsoDate;
  dataDate: IsoDate;
  calendar: CalendarDef;
  assets: Asset[];
  tasks: Task[];
  dependencies: Dependency[];
}
