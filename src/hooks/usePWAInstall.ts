import { useSyncExternalStore } from "react";
import {
  getPWAInstallSnapshot,
  promptPWAInstall,
  subscribePWAInstall,
} from "../services/pwaService";

export function usePWAInstall() {
  const snapshot = useSyncExternalStore(
    subscribePWAInstall,
    getPWAInstallSnapshot,
    getPWAInstallSnapshot,
  );

  return {
    isInstallable: snapshot.isInstallable,
    isInstalled: snapshot.isInstalled,
    isIOS: snapshot.isIOS,
    install: promptPWAInstall,
  };
}
