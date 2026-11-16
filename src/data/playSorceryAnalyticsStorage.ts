import { get, set } from 'idb-keyval';
import { parseAnalyticsSnapshot, type AnalyticsSnapshot } from './playSorceryAnalytics';

const KEY = 'sorcery_play_analytics_constructed_v1';

// Aggregate reference data is local to this browser, separate from guest/account JSON.
export async function loadAnalyticsSnapshot(): Promise<AnalyticsSnapshot | null> {
  const saved: unknown = await get(KEY);
  return saved == null ? null : parseAnalyticsSnapshot(saved);
}

export async function saveAnalyticsSnapshot(snapshot: AnalyticsSnapshot): Promise<void> {
  // One IndexedDB transaction replaces the snapshot only after validation succeeds.
  await set(KEY, parseAnalyticsSnapshot(snapshot));
}
