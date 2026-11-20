import type { ComponentProps, FC } from "react";
import { lazy, Suspense } from "react";
import type { PracticePanel } from "./PracticePanel";

const PracticePanelLazy = lazy(async () => ({
  default: (await import("./PracticePanel")).PracticePanel,
}));

export type LazyPracticePanelProps = ComponentProps<typeof PracticePanel>;

const PracticePanelFallback: FC = () => (
  <div className="mt-4 rounded-xl border border-border bg-surface-subtle p-4 text-center text-xs text-ink-muted">
    Loading pronunciation coach…
  </div>
);

export const LazyPracticePanel: FC<LazyPracticePanelProps> = (props) => (
  <Suspense fallback={<PracticePanelFallback />}>
    <PracticePanelLazy {...props} />
  </Suspense>
);
