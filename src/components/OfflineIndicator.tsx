import { WifiOff } from "lucide-react";
import type { FC } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

export const OfflineIndicator: FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bottom-safe-toast fixed left-4 right-4 z-40 mx-auto flex max-w-md items-center gap-2.5 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-2.5 text-xs font-medium text-warning-ink shadow-sm md:bottom-5 md:left-auto md:right-5"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span>Offline mode · Phrasebook, translator, tone coach & cached audio active</span>
    </div>
  );
};
