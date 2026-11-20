import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

interface UseProgressiveRenderCountOptions {
  totalCount: number;
  initialCount?: number;
  batchSize?: number;
  resetKey: string;
  rootRef?: RefObject<HTMLElement | null>;
}

export function useProgressiveRenderCount({
  totalCount,
  initialCount = 48,
  batchSize = 48,
  resetKey,
  rootRef,
}: UseProgressiveRenderCountOptions): {
  visibleCount: number;
  hasMore: boolean;
  loadMore: () => void;
  sentinelRef: RefObject<HTMLDivElement | null>;
} {
  const [state, setState] = useState<{ key: string; count: number }>({
    key: resetKey,
    count: initialCount,
  });
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const effectiveCount = state.key === resetKey ? state.count : initialCount;
  const visibleCount = Math.min(totalCount, effectiveCount);
  const hasMore = visibleCount < totalCount;

  const loadMore = useCallback(() => {
    setState((prev) => {
      const base = prev.key === resetKey ? prev.count : initialCount;
      const next = Math.min(totalCount, base + batchSize);
      if (prev.key === resetKey && next === prev.count) return prev;
      return { key: resetKey, count: next };
    });
  }, [batchSize, initialCount, resetKey, totalCount]);

  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      {
        root: rootRef?.current ?? null,
        rootMargin: "320px 0px",
      },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadMore, rootRef]);

  return {
    visibleCount,
    hasMore,
    loadMore,
    sentinelRef,
  };
}
