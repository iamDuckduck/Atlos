import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const CURRENT_USER_GUIDE_VERSION = '1.0.0';

interface IUserGuideStore {
  version: string;
  setVersion: (version: string) => void;

  // Completion belongs to the guide version, not to a responsive layout.
  completedVersion: string;
  setCompletedVersion: (version: string) => void;

  stepCompleted: Record<string, boolean>;
  setStepCompleted: (stepId: string, completed: boolean) => void;

  setStepCompletedBulk: (updates: Record<string, boolean>) => void;
  replaceStepCompleted: (stepCompleted: Record<string, boolean>) => void;
}

type PersistedUserGuideState = Partial<Pick<IUserGuideStore, 'version' | 'completedVersion' | 'stepCompleted'>>;

const hasCompletedStepGroup = (stepCompleted: Record<string, boolean>, prefix: 'STEP-' | 'MSTEP-'): boolean => {
  const values = Object.entries(stepCompleted)
    .filter(([stepId]) => stepId.startsWith(prefix))
    .map(([, completed]) => completed);

  return values.length > 0 && values.every((completed) => completed === true);
};

const hasCompletedTerminalStep = (stepCompleted: Record<string, boolean>): boolean =>
  Object.entries(stepCompleted).some(
    ([stepId, completed]) =>
      completed === true &&
      ((stepId.startsWith('STEP-') && stepId.endsWith('_point-icon')) ||
        (stepId.startsWith('MSTEP-') && stepId.endsWith('_point-check'))),
  );

/**
 * Before completedVersion existed, finishing either responsive guide replaced
 * that layout's entire step map with true. Infer that state so users who have
 * already finished on desktop or mobile are not prompted by the other layout.
 * A completed terminal step also covers users whose stored map later gained
 * newly introduced, incomplete step keys without a guide-version bump.
 */
const inferLegacyCompletedVersion = (state: PersistedUserGuideState): string => {
  if (typeof state.completedVersion === 'string' && state.completedVersion) {
    return state.completedVersion;
  }

  if (typeof state.version !== 'string' || !state.version) return '';

  const stepCompleted = state.stepCompleted;
  if (!stepCompleted || typeof stepCompleted !== 'object') return '';

  return hasCompletedStepGroup(stepCompleted, 'STEP-') ||
    hasCompletedStepGroup(stepCompleted, 'MSTEP-') ||
    hasCompletedTerminalStep(stepCompleted)
    ? state.version
    : '';
};

export const useUserGuideStore = create<IUserGuideStore>()(
  persist(
    (set) => ({
      version: '',
      setVersion: (version) => set({ version }),

      completedVersion: '',
      setCompletedVersion: (completedVersion) => set({ completedVersion }),

      stepCompleted: {},
      setStepCompleted: (stepId, completed) =>
        set((state) => ({
          stepCompleted: { ...state.stepCompleted, [stepId]: completed },
        })),

      setStepCompletedBulk: (updates) =>
        set((state) => ({
          stepCompleted: { ...state.stepCompleted, ...updates },
        })),

      replaceStepCompleted: (stepCompleted) => set({ stepCompleted }),
    }),
    {
      name: 'UserGuide',
      version: 1,
      migrate: (persistedState: unknown, version: number): PersistedUserGuideState => {
        const persisted =
          typeof persistedState === 'object' && persistedState !== null
            ? (persistedState as PersistedUserGuideState)
            : {};

        if (version >= 1) return persisted;

        return {
          ...persisted,
          completedVersion: inferLegacyCompletedVersion(persisted),
        };
      },
    },
  ),
);

export const completeCurrentUserGuide = (): void => {
  useUserGuideStore.setState({
    version: CURRENT_USER_GUIDE_VERSION,
    completedVersion: CURRENT_USER_GUIDE_VERSION,
  });
};

// Export hooks for easy use
export const useUserGuideVersion = () => useUserGuideStore((s) => s.version);
export const useSetUserGuideVersion = () => useUserGuideStore((s) => s.setVersion);
export const useUserGuideCompletedVersion = () => useUserGuideStore((s) => s.completedVersion);
export const useSetUserGuideCompletedVersion = () => useUserGuideStore((s) => s.setCompletedVersion);
export const useUserGuideStepCompleted = () => useUserGuideStore((s) => s.stepCompleted);
export const useSetUserGuideStepCompleted = () => useUserGuideStore((s) => s.setStepCompleted);
export const useSetUserGuideStepCompletedBulk = () => useUserGuideStore((s) => s.setStepCompletedBulk);
export const useReplaceUserGuideStepCompleted = () => useUserGuideStore((s) => s.replaceStepCompleted);
