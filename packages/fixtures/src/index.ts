/**
 * Sample data for tests, demos and screenshots. All names, tags and dates are made up
 * (they follow the design mockups' "Riverside Data Center" sample).
 */
import type { Asset, Dependency, Project, Readiness, ReadinessState, Task, TaskType } from '@cx/core';

const R = (t: string): Readiness => {
  const map: Record<string, ReadinessState> = { r: 'ready', p: 'progress', n: 'needed', '-': 'na', b: 'blocked' };
  const s = [...t].map((c) => map[c] ?? 'needed');
  return { T: s[0]!, I: s[1]!, M: s[2]!, E: s[3]!, S: s[4]! };
};

type Row = [code: string, name: string, dur: number, type: TaskType, resp: string, pct: number, times: string, extra?: Partial<Task>];

function build(assetId: string, rows: Row[]): Task[] {
  return rows.map(([code, name, dur, type, resp, pct, times, extra]) => ({
    id: `t${code}`,
    assetId,
    code,
    name,
    type,
    durationDays: dur,
    percentComplete: pct,
    responsible: resp,
    readiness: R(times),
    ...extra,
  }));
}

function chain(tasks: Task[]): Dependency[] {
  return tasks.slice(1).map((t, i) => ({ predecessorId: tasks[i]!.id, successorId: t.id, type: 'FS', lagDays: 0 }));
}

export function riversideProject(): Project {
  const assets: Asset[] = [
    { id: 'swgr-1a', tag: 'SWGR-1A', description: 'Low-voltage switchgear', location: 'Elec Rm 101', system: 'Normal power' },
    { id: 'xfmr-1a', tag: 'XFMR-1A', description: 'Power transformer', location: 'Yard pad 1', system: 'Normal power' },
    { id: 'ups-1a', tag: 'UPS-1A', description: 'UPS & batteries', location: 'Elec Rm 102', system: 'Critical power' },
    { id: 'gen-1', tag: 'GEN-1', description: 'Emergency generator', location: 'Yard', system: 'Critical power' },
  ];
  const swgr = build('swgr-1a', [
    ['1.1', 'Visual & mechanical inspection', 2, 'task', 'Electrical – Crew A', 100, 'rr-rr', { actualStart: '2026-11-02', actualFinish: '2026-11-03' }],
    ['1.2', 'Torque verification', 2, 'task', 'Electrical – Crew A', 100, 'rr-rr', { actualStart: '2026-11-04', actualFinish: '2026-11-05' }],
    ['1.3', 'Insulation resistance test', 2, 'task', 'Test technician', 50, 'rr-rr', { actualStart: '2026-11-06' }],
    ['1.4', 'Relay settings & calibration', 4, 'task', 'Relay technician', 0, 'ppprn'],
    ['1.5', 'Functional test', 2, 'hold', 'Cx agent + Owner', 0, 'nr-pn'],
    ['1.6', 'Energization', 0, 'milestone', 'Electrical foreman', 0, 'nr-pn'],
  ]);
  const xfmr = build('xfmr-1a', [
    ['2.1', 'Visual & mechanical inspection', 2, 'task', 'Electrical – Crew B', 100, 'rr-rr', { actualStart: '2026-11-03', actualFinish: '2026-11-04' }],
    ['2.2', 'Turns ratio & winding resistance', 3, 'task', 'Test technician', 50, 'rr-rr', { actualStart: '2026-11-05' }],
    ['2.3', 'Insulation resistance & power factor', 3, 'task', 'Test technician', 0, 'pr-rn'],
    ['2.4', 'Pre-energization review', 1, 'hold', 'Cx agent', 0, '-r-pn'],
    ['2.5', 'Energization', 0, 'milestone', 'Electrical foreman', 0, 'nr-pn'],
  ]);
  const ups = build('ups-1a', [
    ['3.1', 'Pre-energization checks', 4, 'task', 'Electrical – Crew A', 0, 'npnpn'],
    ['3.2', 'Battery string verification', 3, 'task', 'Test technician', 0, 'nn-pn'],
    ['3.3', 'Startup & witness', 2, 'witness', 'Vendor + Cx agent', 0, 'nn-pn'],
    ['3.4', 'Load bank test', 3, 'task', 'Test technician', 0, 'nn-pn'],
  ]);
  const gen = build('gen-1', [
    ['4.1', 'Fuel & cooling verification', 3, 'task', 'Mechanical + Electrical', 0, 'nrppn'],
    ['4.2', 'No-load run & protection checks', 3, 'task', 'Vendor', 0, 'nnnpn'],
    ['4.3', 'Load bank test', 2, 'witness', 'Test technician', 0, 'nn-pn'],
    ['4.4', 'ATS transfer tests', 3, 'task', 'Cx agent', 0, 'nn-pn'],
  ]);
  const dependencies: Dependency[] = [
    ...chain(swgr),
    ...chain(xfmr),
    ...chain(ups),
    ...chain(gen),
    // Transformer energizes with the switchgear; UPS and generator follow energization.
    { predecessorId: 't1.5', successorId: 't2.5', type: 'FS', lagDays: 0 },
    { predecessorId: 't1.6', successorId: 't3.1', type: 'FS', lagDays: 1 },
    { predecessorId: 't1.6', successorId: 't4.1', type: 'FS', lagDays: 1 },
  ];
  return {
    id: 'riverside-bldg-a',
    name: 'Riverside Data Center – Bldg A',
    subtitle: 'Electrical commissioning',
    startDate: '2026-11-02',
    dataDate: '2026-11-06',
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-26', '2026-12-25'] },
    assets,
    tasks: [...swgr, ...xfmr, ...ups, ...gen],
    dependencies,
  };
}

const STATE_CYCLE: ReadinessState[] = ['ready', 'progress', 'needed', 'blocked', 'na'];

const KINDS: Array<{ prefix: string; description: string; steps: Array<[string, number, TaskType]> }> = [
  { prefix: 'SWGR', description: 'Low-voltage switchgear', steps: [['Visual & mechanical inspection', 2, 'task'], ['Torque verification', 2, 'task'], ['Insulation resistance test', 2, 'task'], ['Relay settings & calibration', 4, 'task'], ['Functional test', 2, 'hold'], ['Energization', 0, 'milestone']] },
  { prefix: 'XFMR', description: 'Power transformer', steps: [['Visual & mechanical inspection', 2, 'task'], ['Turns ratio & winding resistance', 3, 'task'], ['Insulation resistance & power factor', 3, 'task'], ['Pre-energization review', 1, 'hold'], ['Energization', 0, 'milestone']] },
  { prefix: 'PNL', description: 'Panelboard', steps: [['Visual & mechanical inspection', 1, 'task'], ['Torque verification', 1, 'task'], ['Insulation resistance test', 1, 'task'], ['Energization', 0, 'milestone']] },
  { prefix: 'UPS', description: 'UPS & batteries', steps: [['Pre-energization checks', 4, 'task'], ['Battery string verification', 3, 'task'], ['Startup & witness', 2, 'witness'], ['Load bank test', 3, 'task']] },
];

/**
 * A large, deterministic schedule for print and performance tests:
 * `assetCount` assets, roughly 5 tasks each, staggered over several months.
 */
export function largeProject(assetCount = 45): Project {
  const assets: Asset[] = [];
  const tasks: Task[] = [];
  const dependencies: Dependency[] = [];
  for (let a = 0; a < assetCount; a++) {
    const kind = KINDS[a % KINDS.length]!;
    const id = `asset-${a + 1}`;
    const floor = Math.floor(a / KINDS.length) + 1;
    assets.push({ id, tag: `${kind.prefix}-${floor}${String.fromCharCode(65 + (a % 3))}`, description: kind.description, location: `Level ${floor}`, system: a % 2 ? 'Critical power' : 'Normal power' });
    let prev: string | undefined;
    kind.steps.forEach(([name, dur, type], i) => {
      const tid = `${id}-t${i + 1}`;
      const seed = (a * 7 + i * 3) % 25;
      tasks.push({
        id: tid,
        assetId: id,
        code: `${a + 1}.${i + 1}`,
        name,
        type,
        durationDays: dur,
        percentComplete: 0,
        responsible: type === 'milestone' ? 'Electrical foreman' : 'Test technician',
        readiness: {
          T: STATE_CYCLE[seed % 5]!,
          I: 'ready',
          M: seed % 4 === 0 ? 'na' : 'progress',
          E: 'ready',
          S: seed % 6 === 0 ? 'blocked' : 'needed',
        },
        ...(i === 0 ? { startNoEarlierThan: addWeeks('2026-11-02', Math.floor(a / 3)) } : {}),
      });
      if (prev) dependencies.push({ predecessorId: prev, successorId: tid, type: 'FS', lagDays: 0 });
      prev = tid;
    });
  }
  return {
    id: 'large-sample',
    name: 'Harbor Point Campus – Central Plant',
    subtitle: 'Electrical commissioning (large sample)',
    startDate: '2026-11-02',
    dataDate: '2026-11-02',
    calendar: { workWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-26', '2026-12-25', '2027-01-01'] },
    assets,
    tasks,
    dependencies,
  };
}

function addWeeks(iso: string, weeks: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}
