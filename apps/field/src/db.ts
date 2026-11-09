import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PacketManifest, ResultRecord } from '@cx/packet';

interface FieldDB extends DBSchema {
  packets: { key: string; value: { packetId: string; manifest: PacketManifest; importedAt: string } };
  /** Append-only: records are only ever added. */
  records: { key: string; value: ResultRecord & { packetId: string; exported: boolean }; indexes: { byPacket: string } };
}

let dbp: Promise<IDBPDatabase<FieldDB>> | undefined;
export function db(): Promise<IDBPDatabase<FieldDB>> {
  dbp ??= openDB<FieldDB>('cx-field', 1, {
    upgrade(d) {
      d.createObjectStore('packets', { keyPath: 'packetId' });
      d.createObjectStore('records', { keyPath: 'id' }).createIndex('byPacket', 'packetId');
    },
  });
  return dbp;
}

export async function savePacket(manifest: PacketManifest): Promise<void> {
  await (await db()).put('packets', { packetId: manifest.packetId, manifest, importedAt: new Date().toISOString() });
}

export async function listPackets(): Promise<PacketManifest[]> {
  return (await (await db()).getAll('packets')).map((p) => p.manifest);
}

let lastAt = 0;
/** Strictly increasing ISO timestamps, so "latest answer wins" never depends on a tie-break. */
export function nextTimestamp(): string {
  lastAt = Math.max(Date.now(), lastAt + 1);
  return new Date(lastAt).toISOString();
}

export async function appendRecord(packetId: string, r: ResultRecord): Promise<void> {
  await (await db()).add('records', { ...r, packetId, exported: false });
}

export async function recordsFor(packetId: string): Promise<Array<ResultRecord & { exported: boolean; packetId: string }>> {
  const all = await (await db()).getAllFromIndex('records', 'byPacket', packetId);
  return all.sort((a, b) => a.at.localeCompare(b.at));
}

export async function markExported(ids: string[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  for (const id of ids) {
    const r = await tx.store.get(id);
    if (r) await tx.store.put({ ...r, exported: true });
  }
  await tx.done;
}
