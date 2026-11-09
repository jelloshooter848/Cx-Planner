/**
 * Field packet files. A packet (.cxpk) goes out to the field; a results file (.cxpr)
 * comes back. Both are zip files with a versioned JSON document inside, so they survive
 * email, USB sticks and shared drives. Results are append-only records with stable IDs,
 * so importing the same results file twice changes nothing.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';

export const PACKET_EXT = '.cxpk';
export const RESULTS_EXT = '.cxpr';
export const FORMAT_VERSION = 1;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ChecklistItem = z.object({ id: z.string().min(1), text: z.string().min(1) });

export const Sheet = z.object({
  id: z.string().min(1),
  assetTag: z.string(),
  title: z.string(),
  items: z.array(ChecklistItem).min(1),
});

export const PacketManifest = z.object({
  format: z.literal('cx-packet'),
  version: z.literal(FORMAT_VERSION),
  packetId: z.string().min(1),
  projectName: z.string(),
  issuedTo: z.string(),
  issuedBy: z.string(),
  issuedAt: z.string(),
  dueDate: isoDate.optional(),
  sheets: z.array(Sheet).min(1),
});
export type PacketManifest = z.infer<typeof PacketManifest>;

export const ResultRecord = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('item'),
    id: z.string().min(1),
    at: z.string(),
    sheetId: z.string(),
    itemId: z.string(),
    value: z.enum(['pass', 'fail', 'na']),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal('signoff'),
    id: z.string().min(1),
    at: z.string(),
    sheetId: z.string(),
    initials: z.string().min(1),
    /** Drawn signature as an SVG path or PNG data URI. */
    signature: z.string().optional(),
  }),
]);
export type ResultRecord = z.infer<typeof ResultRecord>;

export const ResultsFile = z.object({
  format: z.literal('cx-results'),
  version: z.literal(FORMAT_VERSION),
  packetId: z.string().min(1),
  device: z.string(),
  exportedAt: z.string(),
  records: z.array(ResultRecord),
});
export type ResultsFile = z.infer<typeof ResultsFile>;

export class PacketFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PacketFormatError';
  }
}

function pack(name: string, doc: unknown): Uint8Array {
  return zipSync({ [name]: strToU8(JSON.stringify(doc, null, 2)) }, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
}

function unpack(bytes: Uint8Array, name: string): unknown {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new PacketFormatError('Not a packet file (could not unzip)');
  }
  const entry = files[name];
  if (!entry) throw new PacketFormatError(`Packet file is missing ${name}`);
  try {
    return JSON.parse(strFromU8(entry));
  } catch {
    throw new PacketFormatError(`${name} is not valid JSON`);
  }
}

function parse<T>(schema: z.ZodType<T>, doc: unknown, what: string): T {
  const version = (doc as { version?: unknown } | null)?.version;
  if (typeof version === 'number' && version > FORMAT_VERSION) {
    throw new PacketFormatError(`${what} was made by a newer version (format ${version}); update the app`);
  }
  const r = schema.safeParse(doc);
  if (!r.success) throw new PacketFormatError(`${what} is invalid: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  return r.data;
}

export const writePacket = (m: PacketManifest): Uint8Array => pack('packet.json', PacketManifest.parse(m));
export const readPacket = (bytes: Uint8Array): PacketManifest => parse(PacketManifest, unpack(bytes, 'packet.json'), 'Packet');
export const writeResults = (r: ResultsFile): Uint8Array => pack('results.json', ResultsFile.parse(r));
export const readResults = (bytes: Uint8Array): ResultsFile => parse(ResultsFile, unpack(bytes, 'results.json'), 'Results file');

/** Append incoming records, ignoring any already held (by id). Never edits or drops a record. */
export function mergeRecords(existing: ResultRecord[], incoming: ResultRecord[]): { records: ResultRecord[]; added: number } {
  const seen = new Set(existing.map((r) => r.id));
  const fresh = incoming.filter((r) => !seen.has(r.id) && seen.add(r.id));
  return { records: [...existing, ...fresh], added: fresh.length };
}

/** Latest answer per checklist item: later records supersede earlier ones without erasing them. */
export function latestItemValues(records: ResultRecord[]): Map<string, Extract<ResultRecord, { kind: 'item' }>> {
  const out = new Map<string, Extract<ResultRecord, { kind: 'item' }>>();
  for (const r of [...records].sort((a, b) => a.at.localeCompare(b.at))) {
    if (r.kind === 'item') out.set(`${r.sheetId}/${r.itemId}`, r);
  }
  return out;
}

export function samplePacket(): PacketManifest {
  return {
    format: 'cx-packet',
    version: FORMAT_VERSION,
    packetId: 'P-0216',
    projectName: 'Riverside Data Center – Bldg A',
    issuedTo: 'T. Ortiz',
    issuedBy: 'J. Foreman',
    issuedAt: '2026-11-06T09:00:00Z',
    dueDate: '2026-11-12',
    sheets: [
      {
        id: 'XFMR-1A-IR',
        assetTag: 'XFMR-1A',
        title: 'Insulation resistance & PF',
        items: [
          { id: '1', text: 'Nameplate data recorded' },
          { id: '2', text: 'Test instrument and calibration date recorded' },
          { id: '3', text: 'Primary to ground reading at or above acceptance' },
          { id: '4', text: 'Secondary to ground reading at or above acceptance' },
          { id: '5', text: 'Primary to secondary reading at or above acceptance' },
          { id: '6', text: 'Temperature correction applied' },
        ],
      },
    ],
  };
}
