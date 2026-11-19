import { exportSavedAppStateJson } from "../services/storageService";

export function downloadAppBackupJson(filename = "noi-vietnamese-backup.json"): boolean {
  try {
    const json = exportSavedAppStateJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  } catch {
    return false;
  }
}
