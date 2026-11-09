import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { latestItemValues, mergeRecords, PacketFormatError, readPacket, readResults, samplePacket, writePacket, writeResults, type ResultRecord } from '../src/index.js';

const rec = (id: string, at: string, value: 'pass' | 'fail' | 'na' = 'pass'): ResultRecord => ({ kind: 'item', id, at, sheetId: 's', itemId: '1', value });

describe('packet files', () => {
  it('round-trips a packet', () => {
    const p = samplePacket();
    expect(readPacket(writePacket(p))).toEqual(p);
  });

  it('round-trips results', () => {
    const r = { format: 'cx-results' as const, version: 1 as const, packetId: 'P-1', device: 'phone', exportedAt: '2026-11-07T10:00:00Z', records: [rec('a', '2026-11-07T09:00:00Z')] };
    expect(readResults(writeResults(r))).toEqual(r);
  });

  it('gives clear errors for bad files', () => {
    expect(() => readPacket(new Uint8Array([1, 2, 3]))).toThrow(PacketFormatError);
    expect(() => readPacket(zipSync({ 'other.json': strToU8('{}') }))).toThrow(/missing packet.json/);
    const newer = zipSync({ 'packet.json': strToU8(JSON.stringify({ ...samplePacket(), version: 9 })) });
    expect(() => readPacket(newer)).toThrow(/newer version/);
  });

  it('merges append-only records idempotently', () => {
    const first = mergeRecords([], [rec('a', '1'), rec('b', '2')]);
    const again = mergeRecords(first.records, [rec('a', '1'), rec('b', '2'), rec('c', '3', 'fail')]);
    expect(again.added).toBe(1);
    expect(again.records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(latestItemValues(again.records).get('s/1')!.value).toBe('fail');
  });
});
