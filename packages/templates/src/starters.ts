import type { ChecklistItem, DependencyType, Template, TemplateTask, TaskType } from '@cx/core';

/*
 * The eight starter templates shipped with the app (template editor, mockup 02).
 * Steps and checklist wording are written for this app from typical acceptance-testing
 * practice; they are starting points that users edit, not a copy of any standard.
 */

interface TaskSpec {
  key: string;
  name: string;
  durationDays: number;
  type?: TaskType;
  trade: string;
  /** Keys of finish-to-start predecessors with no lag, or full links. */
  after?: (string | { key: string; type: DependencyType; lagDays: number })[];
  checklist?: string[];
  testForm?: string;
  requiredCerts?: string[];
  noticeLeadDays?: number;
}

function task(spec: TaskSpec): TemplateTask {
  const checklist: ChecklistItem[] = (spec.checklist ?? []).map((text, i) => ({ id: `${spec.key}-${i + 1}`, text }));
  const t: TemplateTask = {
    key: spec.key,
    name: spec.name,
    durationDays: spec.durationDays,
    type: spec.type ?? 'task',
    trade: spec.trade,
    predecessors: (spec.after ?? []).map((p) => (typeof p === 'string' ? { key: p, type: 'FS', lagDays: 0 } : p)),
    checklist,
    requiredCerts: spec.requiredCerts ?? [],
  };
  if (spec.testForm !== undefined) t.testForm = spec.testForm;
  if (spec.noticeLeadDays !== undefined) t.noticeLeadDays = spec.noticeLeadDays;
  return t;
}

const QUALIFIED = 'NFPA 70E qualified';
const RELAY_TECH = 'Relay technician';

const STANDARD_STAGES = ['Delivered', 'Set', 'Terminated', 'Tested', 'Energized', 'Turned over'];

const lvSwitchgear: Template = {
  id: 'starter-lv-switchgear',
  name: 'Low-voltage switchgear',
  version: 1,
  kind: 'starter',
  assetDescription: 'Low-voltage switchgear lineup',
  stages: STANDARD_STAGES,
  requiredDocs: ['Factory test report', 'Test reports', 'Relay settings printout', 'O&M manual', 'As-built drawings'],
  tasks: [
    task({
      key: 'vmi', name: 'Visual & mechanical inspection', durationDays: 2, trade: 'Electrical',
      testForm: 'Visual & mechanical inspection',
      checklist: [
        'Nameplate data matches drawings and submittals',
        'No shipping damage; anchoring and alignment complete',
        'Bus, barriers and covers clean and in place',
        'Breaker racking and mechanical interlocks operate freely',
        'Grounding connections installed and tight',
      ],
    }),
    task({
      key: 'torque', name: 'Torque verification', durationDays: 2, trade: 'Electrical', after: ['vmi'],
      testForm: 'Torque record',
      checklist: [
        'Bus joints torqued to manufacturer values',
        'Cable lugs torqued to manufacturer values',
        'Torque marks applied to every checked connection',
        'Torque wrench serial and calibration date recorded',
      ],
    }),
    task({
      key: 'ir', name: 'Insulation resistance test', durationDays: 2, trade: 'Test tech', after: ['torque'],
      testForm: 'Insulation resistance', requiredCerts: [QUALIFIED],
      checklist: [
        'Bus tested phase-to-phase and phase-to-ground',
        'Readings corrected for temperature and recorded',
        'Results meet the project acceptance values',
      ],
    }),
    task({
      key: 'relay', name: 'Relay settings & calibration', durationDays: 4, trade: 'Relay tech', after: ['ir'],
      testForm: 'Protective relay test', requiredCerts: [QUALIFIED, RELAY_TECH],
      checklist: [
        'Settings file revision matches coordination study',
        'Pickup and time-delay values verified',
        'Instantaneous settings verified',
        'Trip test performed and recorded',
        'Settings printout attached',
        'Initials and date entered',
      ],
    }),
    task({
      key: 'func', name: 'Functional test', durationDays: 2, type: 'hold', trade: 'Cx agent', after: ['relay'],
      testForm: 'Functional test', noticeLeadDays: 3,
      checklist: [
        'Breakers open and close locally and remotely',
        'Protective trips operate the correct breaker',
        'Interlocks and key interlocks prevent unsafe operation',
        'Indicating lights and meters read correctly',
        'Cx agent sign-off recorded',
      ],
    }),
    task({ key: 'energize', name: 'Energization', durationDays: 0, type: 'milestone', trade: 'Foreman', after: ['func'] }),
  ],
};

const mvSwitchgear: Template = {
  id: 'starter-mv-switchgear',
  name: 'Medium-voltage switchgear',
  version: 1,
  kind: 'starter',
  assetDescription: 'Medium-voltage metal-clad switchgear lineup',
  stages: STANDARD_STAGES,
  requiredDocs: ['Factory test report', 'Test reports', 'Relay settings printout', 'O&M manual', 'As-built drawings'],
  tasks: [
    task({
      key: 'vmi', name: 'Visual & mechanical inspection', durationDays: 2, trade: 'Electrical',
      testForm: 'Visual & mechanical inspection',
      checklist: [
        'Nameplate data matches drawings and submittals',
        'Anchoring, alignment and section splices complete',
        'Bus connections torqued and marked',
        'Breaker racking, shutters and interlocks operate correctly',
        'Ground bus continuous and connected to the grounding system',
      ],
    }),
    task({
      key: 'ir', name: 'Insulation resistance test', durationDays: 1, trade: 'Test tech', after: ['vmi'],
      testForm: 'Insulation resistance', requiredCerts: [QUALIFIED],
      checklist: [
        'Bus and breakers tested phase-to-phase and phase-to-ground',
        'Test voltage suited to the equipment rating',
        'Readings corrected for temperature and recorded',
      ],
    }),
    task({
      key: 'breaker', name: 'Contact resistance & breaker timing', durationDays: 2, trade: 'Test tech', after: ['ir'],
      testForm: 'Circuit breaker test', requiredCerts: [QUALIFIED],
      checklist: [
        'Contact resistance measured on each pole',
        'Close and trip times recorded',
        'Pole readings compared with each other and with factory data',
        'Trip and close coils operate at minimum control voltage',
      ],
    }),
    task({
      key: 'withstand', name: 'Dielectric withstand test', durationDays: 1, type: 'witness', trade: 'Test tech', after: ['breaker'],
      testForm: 'Dielectric withstand', requiredCerts: [QUALIFIED], noticeLeadDays: 5,
      checklist: [
        'Test area barricaded and attended',
        'Voltage and duration per the approved test procedure',
        'No breakdown or flashover during the test',
        'Witness name recorded',
      ],
    }),
    task({
      key: 'relay', name: 'Protective relay testing', durationDays: 3, trade: 'Relay tech', after: ['withstand'],
      testForm: 'Protective relay test', requiredCerts: [QUALIFIED, RELAY_TECH],
      checklist: [
        'Settings file revision matches coordination study',
        'Current and voltage transformer ratios and polarity verified',
        'Pickup and timing verified for each enabled element',
        'Trip outputs operate the correct breaker',
        'Final settings printout attached',
      ],
    }),
    task({
      key: 'func', name: 'Functional & interlock test', durationDays: 2, type: 'hold', trade: 'Cx agent', after: ['relay'],
      testForm: 'Functional test', noticeLeadDays: 3,
      checklist: [
        'Local and remote open and close operations',
        'Interlocks and transfer schemes operate as designed',
        'Alarms and status reach the monitoring system',
        'Cx agent sign-off recorded',
      ],
    }),
    task({ key: 'energize', name: 'Energization', durationDays: 0, type: 'milestone', trade: 'Foreman', after: ['func'] }),
  ],
};

const transformer: Template = {
  id: 'starter-power-transformer',
  name: 'Power transformer',
  version: 1,
  kind: 'starter',
  assetDescription: 'Liquid-filled power transformer',
  stages: STANDARD_STAGES,
  requiredDocs: ['Factory test report', 'Test reports', 'Insulating fluid analysis', 'O&M manual', 'As-built drawings'],
  tasks: [
    task({
      key: 'vmi', name: 'Visual & mechanical inspection', durationDays: 1, trade: 'Electrical',
      testForm: 'Visual & mechanical inspection',
      checklist: [
        'Nameplate data matches drawings and submittals',
        'Shipping impact recorder reviewed; no damage found',
        'Anchoring, clearances and grounding complete',
        'Fluid level, gauges and pressure relief device checked',
        'Tap changer set to the specified position',
      ],
    }),
    task({
      key: 'ir', name: 'Insulation resistance & polarization index', durationDays: 1, trade: 'Test tech', after: ['vmi'],
      testForm: 'Insulation resistance', requiredCerts: [QUALIFIED],
      checklist: [
        'Windings tested high-to-low, high-to-ground and low-to-ground',
        'Polarization index calculated and recorded',
        'Readings corrected for temperature',
      ],
    }),
    task({
      key: 'ttr', name: 'Turns ratio & winding resistance', durationDays: 1, type: 'witness', trade: 'Test tech', after: ['ir'],
      testForm: 'Transformer turns ratio', requiredCerts: [QUALIFIED], noticeLeadDays: 5,
      checklist: [
        'Turns ratio measured on every tap position',
        'Ratios within tolerance of the nameplate',
        'Winding resistance measured on each phase',
        'Witness name recorded',
      ],
    }),
    task({
      key: 'fluid', name: 'Insulating fluid sample & analysis', durationDays: 3, trade: 'Test tech', after: [{ key: 'ir', type: 'SS', lagDays: 0 }],
      testForm: 'Insulating fluid sample',
      checklist: [
        'Sample drawn and labelled per the lab procedure',
        'Lab results received and reviewed',
        'Results within acceptance limits',
      ],
    }),
    task({ key: 'energize', name: 'Energization', durationDays: 0, type: 'milestone', trade: 'Foreman', after: ['ttr', 'fluid'] }),
  ],
};

const panelboard: Template = {
  id: 'starter-panelboard',
  name: 'Panelboard / distribution',
  version: 1,
  kind: 'starter',
  assetDescription: 'Panelboard or distribution board',
  stages: ['Delivered', 'Set', 'Terminated', 'Tested', 'Energized'],
  requiredDocs: ['Test reports', 'Panel schedule', 'As-built drawings'],
  tasks: [
    task({
      key: 'vmi', name: 'Visual inspection & torque', durationDays: 1, trade: 'Electrical',
      testForm: 'Visual & mechanical inspection',
      checklist: [
        'Nameplate rating matches drawings',
        'Breaker sizes match the panel schedule',
        'Terminations torqued and marked',
        'Neutral and ground bars connected as designed',
        'Interior clean; dead front and trims in place',
      ],
    }),
    task({
      key: 'ir', name: 'Insulation resistance test', durationDays: 1, trade: 'Test tech', after: ['vmi'],
      testForm: 'Insulation resistance', requiredCerts: [QUALIFIED],
      checklist: [
        'Bus tested phase-to-phase and phase-to-ground',
        'Feeder tested before connection',
        'Readings recorded',
      ],
    }),
    task({
      key: 'directory', name: 'Circuit directory & labelling', durationDays: 1, trade: 'Electrical', after: ['ir'],
      testForm: 'Labelling check',
      checklist: [
        'Typed circuit directory installed',
        'Panel label shows its source',
        'Arc-flash label installed',
      ],
    }),
    task({ key: 'energize', name: 'Energization', durationDays: 0, type: 'milestone', trade: 'Foreman', after: ['directory'] }),
  ],
};

const generator: Template = {
  id: 'starter-emergency-generator',
  name: 'Emergency generator',
  version: 1,
  kind: 'starter',
  assetDescription: 'Diesel emergency or standby generator set',
  stages: ['Delivered', 'Set', 'Terminated', 'Started', 'Load tested', 'Turned over'],
  requiredDocs: ['Factory test report', 'Start-up report', 'Load bank test report', 'O&M manual', 'As-built drawings'],
  tasks: [
    task({
      key: 'vmi', name: 'Visual & mechanical inspection', durationDays: 1, trade: 'Electrical',
      testForm: 'Visual & mechanical inspection',
      checklist: [
        'Nameplate data matches drawings and submittals',
        'Set anchored on isolators; clearances kept',
        'Exhaust, fuel and cooling connections complete',
        'Output conductors terminated and torqued',
        'Grounding and bonding complete',
      ],
    }),
    task({
      key: 'prestart', name: 'Pre-start checks', durationDays: 1, trade: 'Generator tech', after: ['vmi'],
      testForm: 'Pre-start checklist',
      checklist: [
        'Fuel, oil and coolant at the correct levels',
        'Starting batteries charged and charger working',
        'Block heater energized and warm',
        'Emergency stop and shutdowns wired',
      ],
    }),
    task({
      key: 'ir', name: 'Insulation resistance test', durationDays: 1, trade: 'Test tech', after: ['vmi'],
      testForm: 'Insulation resistance', requiredCerts: [QUALIFIED],
      checklist: [
        'Stator and output conductors tested to ground',
        'Readings recorded',
      ],
    }),
    task({
      key: 'startup', name: 'Manufacturer start-up', durationDays: 1, type: 'witness', trade: 'Generator tech', after: ['prestart', 'ir'],
      testForm: 'Start-up report', noticeLeadDays: 5,
      checklist: [
        'Voltage, frequency and phase rotation correct',
        'Safety shutdowns tested',
        'Governor and voltage regulator adjusted',
        'Start-up report received',
      ],
    }),
    task({
      key: 'loadbank', name: 'Load bank test', durationDays: 1, type: 'hold', trade: 'Cx agent', after: ['startup'],
      testForm: 'Load bank test', noticeLeadDays: 5,
      checklist: [
        'Load steps applied per the approved procedure',
        'Voltage, frequency and temperatures logged at each step',
        'Recovery from block load within specification',
        'Fuel consumed and refilled after the test',
        'Cx agent sign-off recorded',
      ],
    }),
    task({ key: 'ready', name: 'Ready for service', durationDays: 0, type: 'milestone', trade: 'Foreman', after: ['loadbank'] }),
  ],
};

const ats: Template = {
  id: 'starter-automatic-transfer-switch',
  name: 'Automatic transfer switch',
  version: 1,
  kind: 'starter',
  assetDescription: 'Automatic transfer switch',
  stages: STANDARD_STAGES,
  requiredDocs: ['Factory test report', 'Start-up report', 'Test reports', 'O&M manual', 'As-built drawings'],
  tasks: [
    task({
      key: 'vmi', name: 'Visual inspection & torque', durationDays: 1, trade: 'Electrical',
      testForm: 'Visual & mechanical inspection',
      checklist: [
        'Nameplate rating matches drawings',
        'Normal, emergency and load cables terminated and torqued',
        'Manual transfer operates smoothly',
        'Control wiring to the generator complete',
      ],
    }),
    task({
      key: 'ir', name: 'Insulation resistance test', durationDays: 1, trade: 'Test tech', after: ['vmi'],
      testForm: 'Insulation resistance', requiredCerts: [QUALIFIED],
      checklist: [
        'Each pole tested to ground and between poles',
        'Readings recorded',
      ],
    }),
    task({
      key: 'controller', name: 'Controller settings', durationDays: 1, trade: 'ATS tech', after: ['ir'],
      testForm: 'Controller settings',
      checklist: [
        'Voltage and frequency sensing set',
        'Transfer, retransfer and cool-down timers set',
        'Exerciser schedule set',
        'Settings record attached',
      ],
    }),
    task({
      key: 'transfer', name: 'Transfer & retransfer test', durationDays: 1, type: 'hold', trade: 'Cx agent', after: ['controller'],
      testForm: 'Functional test', noticeLeadDays: 3,
      checklist: [
        'Loss of normal source starts the generator',
        'Transfer occurs within the set time',
        'Retransfer and cool-down operate on return of normal',
        'Remote status and alarms reported',
        'Cx agent sign-off recorded',
      ],
    }),
    task({ key: 'service', name: 'In service', durationDays: 0, type: 'milestone', trade: 'Foreman', after: ['transfer'] }),
  ],
};

const ups: Template = {
  id: 'starter-ups-batteries',
  name: 'UPS & batteries',
  version: 1,
  kind: 'starter',
  assetDescription: 'Uninterruptible power supply with battery string',
  stages: ['Delivered', 'Set', 'Terminated', 'Started', 'Tested', 'Turned over'],
  requiredDocs: ['Factory test report', 'Start-up report', 'Battery test report', 'O&M manual', 'As-built drawings'],
  tasks: [
    task({
      key: 'vmi', name: 'Visual & mechanical inspection', durationDays: 1, trade: 'Electrical',
      testForm: 'Visual & mechanical inspection',
      checklist: [
        'Nameplate data matches drawings and submittals',
        'Cabinets set, anchored and ventilated as designed',
        'Input, output and bypass cables terminated and torqued',
        'Grounding complete',
      ],
    }),
    task({
      key: 'battery', name: 'Battery installation & connections', durationDays: 2, trade: 'Electrical', after: ['vmi'],
      testForm: 'Battery installation',
      checklist: [
        'Cells or jars installed in the correct order and polarity',
        'Inter-cell connections torqued and marked',
        'Spill containment and eyewash in place where needed',
        'Battery disconnect labelled',
      ],
    }),
    task({
      key: 'impedance', name: 'Battery voltage & impedance readings', durationDays: 1, trade: 'Test tech', after: ['battery'],
      testForm: 'Battery readings', requiredCerts: [QUALIFIED],
      checklist: [
        'Float voltage recorded for each cell',
        'Internal resistance or impedance recorded for each cell',
        'Readings compared with the string average',
      ],
    }),
    task({
      key: 'startup', name: 'Manufacturer start-up', durationDays: 2, type: 'witness', trade: 'UPS tech', after: ['impedance'],
      testForm: 'Start-up report', noticeLeadDays: 5,
      checklist: [
        'Input, output and bypass voltages correct',
        'Transfer to and from bypass verified',
        'Alarms and remote monitoring verified',
        'Start-up report received',
      ],
    }),
    task({
      key: 'discharge', name: 'Battery discharge test', durationDays: 1, type: 'hold', trade: 'Cx agent', after: ['startup'],
      testForm: 'Battery discharge test', noticeLeadDays: 5,
      checklist: [
        'Load bank connected and rated for the test',
        'Runtime at test load meets the specified minimum',
        'Cell voltages logged during discharge',
        'Battery recharged after the test',
        'Cx agent sign-off recorded',
      ],
    }),
    task({ key: 'service', name: 'In service', durationDays: 0, type: 'milestone', trade: 'Foreman', after: ['discharge'] }),
  ],
};

const genericItp: Template = {
  id: 'starter-generic-itp',
  name: 'Generic ITP (blank)',
  version: 1,
  kind: 'starter',
  assetDescription: 'Any equipment; a blank inspection and test plan to fill in',
  stages: ['Delivered', 'Installed', 'Tested', 'Turned over'],
  requiredDocs: ['Test reports'],
  tasks: [
    task({
      key: 'inspect', name: 'Inspection', durationDays: 1, trade: 'Electrical',
      testForm: 'Inspection',
      checklist: ['Equipment matches drawings and submittals', 'Installation complete and undamaged'],
    }),
    task({
      key: 'test', name: 'Test', durationDays: 1, trade: 'Test tech', after: ['inspect'],
      testForm: 'Test record',
      checklist: ['Test performed and results recorded', 'Results meet acceptance values'],
    }),
    task({ key: 'accept', name: 'Accepted', durationDays: 0, type: 'milestone', trade: 'Cx agent', after: ['test'] }),
  ],
};

/** Read-only at every level, so writes to a frozen starter fail at compile time. */
export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** A starter as exported in STARTER_TEMPLATES; copy it to get an editable Template. */
export type StarterTemplate = DeepReadonly<Template>;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value as DeepReadonly<T>;
}

/**
 * The eight starters in library order. Frozen: copy one with `starterTemplates()` or
 * `structuredClone` before editing it.
 */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = deepFreeze<Template[]>([
  lvSwitchgear,
  mvSwitchgear,
  transformer,
  panelboard,
  generator,
  ats,
  ups,
  genericItp,
]);

/** Fresh, editable copies of the starters, e.g. to seed a new workspace library. */
export function starterTemplates(): Template[] {
  return STARTER_TEMPLATES.map((t) => structuredClone(t) as Template);
}

/** An editable copy of one starter, or undefined when the id is not a starter. */
export function starterTemplate(id: string): Template | undefined {
  const t = STARTER_TEMPLATES.find((s) => s.id === id);
  return t === undefined ? undefined : (structuredClone(t) as Template);
}
