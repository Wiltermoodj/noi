import { type ChangeEvent, Component, createRef, type ErrorInfo, type ReactNode } from "react";
import { clearSavedAppState, importSavedAppStateJson } from "../services/storageService";
import { downloadAppBackupJson } from "../utils/backupDownload";

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string | number | undefined;
  variant?: "app" | "inline" | undefined;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  backupSaved: boolean;
  restoreError: string | null;
}

function isChunkLoadErrorMessage(message: string): boolean {
  return /chunk|dynamically imported module|loading css chunk|failed to fetch/i.test(message);
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private readonly fileInputRef = createRef<HTMLInputElement>();

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: "",
      backupSaved: false,
      restoreError: null,
    };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "An unexpected rendering error occurred.";
    return {
      hasError: true,
      errorMessage: message,
      backupSaved: false,
      restoreError: null,
    };
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({
        hasError: false,
        errorMessage: "",
        backupSaved: false,
        restoreError: null,
      });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error caught by ErrorBoundary:", error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({
      hasError: false,
      errorMessage: "",
      backupSaved: false,
      restoreError: null,
    });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleDownloadBackup = (): void => {
    if (downloadAppBackupJson()) {
      this.setState({ backupSaved: true });
    }
  };

  private handleTriggerRestore = (): void => {
    this.fileInputRef.current?.click();
  };

  private handleRestoreFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void this.restoreFromFile(file);
  };

  private async restoreFromFile(file: File): Promise<void> {
    try {
      const rawJson = await file.text();
      const result = importSavedAppStateJson(rawJson);
      if (!result.ok) {
        this.setState({ restoreError: result.error });
        return;
      }
      window.location.reload();
    } catch {
      this.setState({ restoreError: "Could not read backup file." });
    }
  }

  private handleResetAndReload = (): void => {
    clearSavedAppState();
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isChunkIssue = isChunkLoadErrorMessage(this.state.errorMessage);
    const wrapperClass =
      this.props.variant === "inline"
        ? "flex items-center justify-center py-8 text-[#111827]"
        : "flex min-h-screen items-center justify-center bg-[#FAFAFA] px-4 py-12 text-[#111827]";

    return (
      <div className={wrapperClass}>
        <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
          <h1 className="font-display text-xl font-bold text-stone-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-stone-600">
            Nói encountered an unexpected error while displaying this screen. Your offline phrase
            data is preserved unless you choose to reset it.
          </p>
          {isChunkIssue ? (
            <p className="mt-2 text-xs text-stone-500">
              If this happened after an update or offline switch, reloading the page usually fixes
              it.
            </p>
          ) : null}
          {this.state.errorMessage ? (
            <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
              {this.state.errorMessage}
            </p>
          ) : null}
          {this.state.restoreError ? (
            <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {this.state.restoreError}
            </p>
          ) : null}

          <input
            ref={this.fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={this.handleRestoreFile}
            className="hidden"
            aria-label="Restore backup file"
          />

          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={this.handleRetry}
              className="min-h-[44px] flex-1 rounded-xl bg-[#0F766E] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0D655E]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="min-h-[44px] rounded-xl border border-stone-200 bg-white px-4 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={this.handleDownloadBackup}
              className="min-h-[44px] rounded-xl border border-stone-200 bg-white px-4 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              {this.state.backupSaved ? "Backup saved" : "Download backup"}
            </button>
            <button
              type="button"
              onClick={this.handleTriggerRestore}
              className="min-h-[44px] rounded-xl border border-stone-200 bg-white px-4 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              Restore backup
            </button>
            <button
              type="button"
              onClick={this.handleResetAndReload}
              className="min-h-[44px] rounded-xl border border-stone-200 bg-white px-4 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              Reset saved data
            </button>
          </div>
        </div>
      </div>
    );
  }
}
