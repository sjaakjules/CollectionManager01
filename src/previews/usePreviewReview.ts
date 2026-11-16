import { useCallback, useEffect, useRef, useState } from 'react';
import { captureNames, fieldKeys, reviewSet, type FieldKey, type ReviewFields } from './previewReviewData';

type CardChanges = Partial<ReviewFields>;
type ReviewDrafts = Map<string, CardChanges>;
type SaveState = 'saved' | 'saving' | 'unavailable';

const prefix = 'sorcerystacks:baldassare-preview-review:v1:';
const saveDelay = 250;
const draftKeys = new Map(captureNames.flatMap((name) => fieldKeys.map((field) =>
  [storageKey(name, field), { name, field }] as const,
)));

function storageKey(name: string, field: FieldKey): string {
  return `${prefix}${encodeURIComponent(name)}:${field}`;
}

function changeField(drafts: ReviewDrafts, name: string, field: FieldKey, value: string | null): ReviewDrafts {
  const current = drafts.get(name);
  if ((current?.[field] ?? null) === value) return drafts;
  const next = new Map(drafts);
  const fields = value === null
    ? Object.fromEntries(Object.entries(current ?? {}).filter(([key]) => key !== field))
    : { ...current, [field]: value };
  if (Object.keys(fields).length === 0) next.delete(name);
  else next.set(name, fields);
  return next;
}

function readDrafts(editable: boolean): { drafts: ReviewDrafts; saveState: SaveState } {
  let drafts: ReviewDrafts = new Map();
  try {
    if (editable) {
      for (const [key, { name, field }] of draftKeys) {
        const value = window.localStorage.getItem(key);
        if (value !== null) drafts = changeField(drafts, name, field, value);
      }
    }
    return { drafts, saveState: 'saved' };
  } catch {
    return { drafts, saveState: 'unavailable' };
  }
}

export function usePreviewReview(editable: boolean) {
  const [initial] = useState(() => readDrafts(editable));
  const [drafts, setDrafts] = useState(initial.drafts);
  const [saveState, setSaveState] = useState(initial.saveState);
  const pending = useRef(new Map<string, string | null>());
  const timer = useRef<number | undefined>();

  const flush = useCallback((showStatus = true) => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (!editable || pending.current.size === 0) return;
    let state: SaveState = 'saved';
    try {
      const storage = window.localStorage;
      for (const [key, value] of pending.current) {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
        pending.current.delete(key);
      }
    } catch {
      state = 'unavailable';
    }
    if (showStatus) setSaveState(state);
  }, [editable]);

  const edit = useCallback((name: string, field: FieldKey, value: string, defaultValue: string) => {
    if (!editable) return;
    const change = value === defaultValue ? null : value;
    setDrafts((existing) => changeField(existing, name, field, change));
    pending.current.set(storageKey(name, field), change);
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, saveDelay);
  }, [editable, flush]);

  useEffect(() => {
    if (!editable) return;
    // Separate storage keys allow tabs to update different fields independently.
    const onStorage = (event: StorageEvent) => {
      if (!event.key || pending.current.has(event.key)) return;
      const target = draftKeys.get(event.key);
      if (target) setDrafts((existing) => changeField(existing, target.name, target.field, event.newValue));
    };
    const onPageHide = () => flush(false);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush(false);
    };
  }, [editable, flush]);

  const download = () => {
    flush();
    const review = {
      format: 'sorcerystacks-preview-review',
      version: 1,
      set: reviewSet,
      edits: captureNames.flatMap((cardName) => {
        const changes = drafts.get(cardName);
        return changes ? [{ cardName, changes }] : [];
      }),
    };
    const blob = new Blob([JSON.stringify(review, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'baldassares-travels-edits.json';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return { drafts, saveState, edit, flush, download };
}
