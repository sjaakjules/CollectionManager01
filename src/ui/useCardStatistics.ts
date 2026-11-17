import { useEffect, useState } from 'react';
import { loadCardStatisticsAsset } from '@/data/cardStatisticsAsset';
import type { CardStatisticsAsset } from '@/data/cardStatistics';

export function useCardStatistics() {
  const [asset, setAsset] = useState<CardStatisticsAsset | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void loadCardStatisticsAsset().then(data => {
      if (!cancelled) { setAsset(data); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);
  return { asset, loading };
}
