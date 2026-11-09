/**
 * The sample project the desktop app's Welcome screen opens ("Open sample project"): the
 * Riverside Data Center sample with all nine assets of mockup 01, made from the starter
 * templates so every task has a template key and a test-sheet checklist. Made-up data.
 */
import { instantiateTemplate, type Asset, type Dependency, type Project, type Readiness, type ReadinessState, type Task, type Template } from '@cx/core';
import { starterTemplate } from '@cx/templates';

export interface SampleProject {
  project: Project;
  /** The template snapshots the assets were made from (store them with the project, decision D4). */
  templates: Template[];
}

const READINESS: Record<string, ReadinessState> = { r: 'ready', p: 'progress', n: 'needed', '-': 'na', b: 'blocked' };

/** "rr-pn" -> T ready, I ready, M n/a, E in progress, S needed. */
function readiness(code: string): Readiness {
  const s = [...code].map((c) => READINESS[c] ?? 'needed');
  return { T: s[0]!, I: s[1]!, M: s[2]!, E: s[3]!, S: s[4]! };
}

/** What changes on one template task once it is in the sample: progress, readiness, notes. */
type TaskPatch = Partial<Pick<Task, 'percentComplete' | 'actualStart' | 'actualFinish' | 'notes' | 'responsible'>> & { ready?: string };

interface AssetSpec {
  asset: Omit<Asset, 'templateId' | 'templateVersion'>;
  templateId: string;
  startNoEarlierThan?: string;
  /** By template task key. Tasks not listed get `defaultReady`. */
  tasks?: Record<string, TaskPatch>;
  defaultReady?: string;
}

const DISTRIBUTION = 'Medium & low-voltage distribution';
const CRITICAL = 'Critical power';

const ASSETS: AssetSpec[] = [
  {
    asset: { id: 'swgr-1a', tag: 'SWGR-1A', description: 'Low-voltage switchgear', location: 'Elec Rm 101', system: DISTRIBUTION },
    templateId: 'starter-lv-switchgear',
    startNoEarlierThan: '2026-11-02',
    tasks: {
      vmi: { percentComplete: 100, actualStart: '2026-11-02', actualFinish: '2026-11-03', responsible: 'Electrical – Crew A', ready: 'rr-rr' },
      torque: { percentComplete: 100, actualStart: '2026-11-04', actualFinish: '2026-11-05', responsible: 'Electrical – Crew A', ready: 'rr-rr' },
      ir: { percentComplete: 50, actualStart: '2026-11-06', ready: 'rr-rr' },
      relay: { ready: 'ppprn', notes: 'Settings file from coordination study Rev 2. Confirm before relay tech mobilizes.' },
      func: { ready: 'nr-pn' },
      energize: { ready: 'nr-pn' },
    },
  },
  {
    asset: { id: 'swgr-1b', tag: 'SWGR-1B', description: 'Low-voltage switchgear', location: 'Elec Rm 103', system: DISTRIBUTION },
    templateId: 'starter-lv-switchgear',
    defaultReady: 'nn-nn',
  },
  {
    asset: { id: 'xfmr-1a', tag: 'XFMR-1A', description: 'Power transformer', location: 'Yard pad 1', system: DISTRIBUTION },
    templateId: 'starter-power-transformer',
    startNoEarlierThan: '2026-11-03',
    tasks: {
      vmi: { percentComplete: 100, actualStart: '2026-11-03', actualFinish: '2026-11-03', responsible: 'Electrical – Crew B', ready: 'rr-rr' },
      ir: { percentComplete: 100, actualStart: '2026-11-04', actualFinish: '2026-11-04', ready: 'rr-rr' },
      fluid: { percentComplete: 50, actualStart: '2026-11-04', ready: 'rr-rr' },
      ttr: { percentComplete: 50, actualStart: '2026-11-06', ready: 'rr-rn' },
      energize: { ready: '-r-pn' },
    },
  },
  {
    asset: { id: 'xfmr-1b', tag: 'XFMR-1B', description: 'Power transformer', location: 'Yard pad 2', system: DISTRIBUTION },
    templateId: 'starter-power-transformer',
    startNoEarlierThan: '2026-11-16',
    defaultReady: 'nn-nn',
  },
  {
    asset: { id: 'ups-1a', tag: 'UPS-1A', description: 'UPS & batteries', location: 'Elec Rm 102', system: CRITICAL },
    templateId: 'starter-ups-batteries',
    tasks: { vmi: { ready: 'npnpn' }, battery: { ready: 'nppnn' } },
    defaultReady: 'nn-pn',
  },
  {
    asset: { id: 'ups-1b', tag: 'UPS-1B', description: 'UPS & batteries', location: 'Elec Rm 104', system: CRITICAL },
    templateId: 'starter-ups-batteries',
    defaultReady: 'nn-nn',
  },
  {
    asset: { id: 'gen-1', tag: 'GEN-1', description: 'Emergency generator', location: 'Yard', system: CRITICAL },
    templateId: 'starter-emergency-generator',
    tasks: { vmi: { ready: 'nrppn' }, prestart: { ready: 'nnnpn' } },
    defaultReady: 'nn-pn',
  },
  {
    asset: { id: 'gen-2', tag: 'GEN-2', description: 'Emergency generator', location: 'Yard', system: CRITICAL },
    templateId: 'starter-emergency-generator',
    defaultReady: 'nn-nn',
  },
  {
    asset: { id: 'ats-1', tag: 'ATS-1', description: 'Automatic transfer switch', location: 'Elec Rm 105', system: CRITICAL },
    templateId: 'starter-automatic-transfer-switch',
    defaultReady: 'nn-nn',
  },
];

/** Links between assets: [predecessor asset, key] -> [successor asset, key]. */
const CROSS_LINKS: Array<[string, string, string, string, number]> = [
  // Crew A moves to the second lineup once the first is energized.
  ['swgr-1a', 'energize', 'swgr-1b', 'vmi', 0],
  // Each transformer energizes after its switchgear's functional test.
  ['swgr-1a', 'func', 'xfmr-1a', 'energize', 0],
  ['swgr-1b', 'func', 'xfmr-1b', 'energize', 0],
  // UPS and generator work follows energization of the normal-power side.
  ['swgr-1a', 'energize', 'ups-1a', 'vmi', 1],
  ['swgr-1a', 'energize', 'gen-1', 'vmi', 1],
  ['swgr-1b', 'energize', 'ups-1b', 'vmi', 1],
  ['gen-1', 'ready', 'gen-2', 'vmi', 0],
  // The ATS is set up once GEN-1 runs, and transfer-tested once both generators are ready.
  ['gen-1', 'ready', 'ats-1', 'vmi', 0],
  ['gen-2', 'ready', 'ats-1', 'transfer', 0],
];

const taskId = (assetId: string, key: string) => `${assetId}-${key}`;

/**
 * The full Riverside sample: nine assets made from the starter templates, with progress up
 * to the data date (Nov 6, 2026) on SWGR-1A and XFMR-1A. Deterministic: every call returns
 * the same project and templates.
 */
export function riversideSample(): SampleProject {
  const templates = new Map<string, Template>();
  const assets: Asset[] = [];
  const tasks: Task[] = [];
  const dependencies: Dependency[] = [];
  ASSETS.forEach((spec, i) => {
    let template = templates.get(spec.templateId);
    if (!template) {
      template = starterTemplate(spec.templateId);
      if (!template) throw new Error(`No starter template "${spec.templateId}"`);
      templates.set(spec.templateId, template);
    }
    const made = instantiateTemplate(
      template,
      { asset: spec.asset, groupNumber: i + 1, ...(spec.startNoEarlierThan ? { startNoEarlierThan: spec.startNoEarlierThan } : {}) },
      (key) => taskId(spec.asset.id, key),
    );
    assets.push(made.asset);
    for (const t of made.tasks) {
      const { ready, ...patch } = spec.tasks?.[t.templateKey ?? ''] ?? {};
      tasks.push({ ...t, ...patch, readiness: readiness(ready ?? spec.defaultReady ?? 'nn-pn') });
    }
    dependencies.push(...made.dependencies);
  });
  for (const [pa, pk, sa, sk, lagDays] of CROSS_LINKS) {
    dependencies.push({ predecessorId: taskId(pa, pk), successorId: taskId(sa, sk), type: 'FS', lagDays });
  }
  return {
    project: {
      id: 'riverside-bldg-a-sample',
      name: 'Riverside Data Center – Bldg A',
      subtitle: 'Electrical commissioning (sample)',
      startDate: '2026-11-02',
      dataDate: '2026-11-06',
      calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-26', '2026-12-25'] },
      assets,
      tasks,
      dependencies,
    },
    templates: [...templates.values()],
  };
}
