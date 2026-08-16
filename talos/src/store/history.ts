import { create } from 'zustand';
import { useUserRecordStore } from '@/store/userRecord';

export type PointProgressDelta = {
    collect?: Iterable<string>;
    uncollect?: Iterable<string>;
};

export type PointProgressHistoryEntry = {
    label: string;
    collectedIds: string[];
    uncollectedIds: string[];
};

interface IHistoryStore {
    past: PointProgressHistoryEntry[];
    future: PointProgressHistoryEntry[];
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    clear: () => void;
}

const UNDO_LIMIT = 25;

const normalizePointIds = (ids?: Iterable<string>): string[] => (
    ids ? [...new Set([...ids].map((id) => String(id)).filter(Boolean))] : []
);

const replaceActivePoints = (ids: Iterable<string>): boolean => {
    const next = normalizePointIds(ids);
    const current = useUserRecordStore.getState().activePoints;
    if (current.length === next.length && current.every((id, index) => id === next[index])) {
        return false;
    }
    useUserRecordStore.setState({ activePoints: next, updatedAt: Date.now() });
    return true;
};

const applyPointProgressDelta = (delta: PointProgressDelta): PointProgressHistoryEntry | null => {
    const current = useUserRecordStore.getState().activePoints;
    const currentSet = new Set(current);
    const uncollectSet = new Set(normalizePointIds(delta.uncollect));
    const collectIds = normalizePointIds(delta.collect);
    const next = current.filter((id) => !uncollectSet.has(id));
    const nextSet = new Set(next);

    for (const id of collectIds) {
        if (nextSet.has(id)) continue;
        nextSet.add(id);
        next.push(id);
    }

    const collectedIds = next.filter((id) => !currentSet.has(id));
    const uncollectedIds = current.filter((id) => !nextSet.has(id));
    if (collectedIds.length === 0 && uncollectedIds.length === 0) return null;

    replaceActivePoints(next);
    return { label: '', collectedIds, uncollectedIds };
};

const applyHistoryEntry = (entry: PointProgressHistoryEntry, reverse: boolean): void => {
    applyPointProgressDelta(reverse
        ? { collect: entry.uncollectedIds, uncollect: entry.collectedIds }
        : { collect: entry.collectedIds, uncollect: entry.uncollectedIds });
};

export const useHistoryStore = create<IHistoryStore>()((set, get) => ({
    past: [],
    future: [],

    undo: () => {
        const { past, future } = get();
        const entry = past[past.length - 1];
        if (!entry) return;
        applyHistoryEntry(entry, true);
        set({ past: past.slice(0, -1), future: [entry, ...future] });
    },

    redo: () => {
        const { past, future } = get();
        const entry = future[0];
        if (!entry) return;
        applyHistoryEntry(entry, false);
        set({
            past: [...past, entry].slice(-UNDO_LIMIT),
            future: future.slice(1),
        });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
    clear: () => set({ past: [], future: [] }),
}));

export const commitPointProgress = (label: string, delta: PointProgressDelta): boolean => {
    const applied = applyPointProgressDelta(delta);
    if (!applied) return false;
    const entry = { ...applied, label };
    useHistoryStore.setState((state) => ({
        past: [...state.past, entry].slice(-UNDO_LIMIT),
        future: [],
    }));
    return true;
};

export const replacePointProgressFromExternal = (ids: Iterable<string>): void => {
    replaceActivePoints(ids);
    useHistoryStore.getState().clear();
};

export const applyPointProgressSilently = (delta: PointProgressDelta): boolean => (
    applyPointProgressDelta(delta) !== null
);

export const useCanUndo = () => useHistoryStore((state) => state.past.length > 0);
export const useCanRedo = () => useHistoryStore((state) => state.future.length > 0);
