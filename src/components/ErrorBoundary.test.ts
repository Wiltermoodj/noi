import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("renders child elements normally when no error occurs", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorBoundary, null, createElement("span", null, "Nói ready")),
    );
    expect(html).toContain("Nói ready");
  });

  it("derives error fallback state from thrown rendering errors", () => {
    const state = ErrorBoundary.getDerivedStateFromError(new Error("Corrupted phrase deck"));
    expect(state.hasError).toBe(true);
    expect(state.errorMessage).toBe("Corrupted phrase deck");
    expect(state.backupSaved).toBe(false);

    const unknownState = ErrorBoundary.getDerivedStateFromError("non-error");
    expect(unknownState.hasError).toBe(true);
    expect(unknownState.errorMessage.length).toBeGreaterThan(0);
  });

  it("renders reload, backup download, and chunk recovery guidance on failure", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = ErrorBoundary.getDerivedStateFromError(
      new Error("Failed to fetch dynamically imported module"),
    );
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain("Reload page");
    expect(html).toContain("Download backup");
    expect(html).toContain("reloading the page usually fixes it");
  });

  it("supports inline variant and resets error state when resetKey changes", () => {
    const boundary = new ErrorBoundary({
      children: createElement("div", null, "Tab content"),
      variant: "inline",
      resetKey: "learn",
    });
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error("Render crash"));

    const errorHtml = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(errorHtml).not.toContain("min-h-screen");
    expect(errorHtml).toContain("Render crash");

    let nextState: Partial<typeof boundary.state> = {};
    boundary.setState = ((updater: Partial<typeof boundary.state>) => {
      nextState = typeof updater === "function" ? updater : updater;
    }) as typeof boundary.setState;
    Object.defineProperty(boundary, "props", {
      value: { ...boundary.props, resetKey: "phrases" },
      configurable: true,
    });
    boundary.componentDidUpdate({ children: null, variant: "inline", resetKey: "learn" });

    expect(nextState.hasError).toBe(false);
    expect(nextState.errorMessage).toBe("");
  });
});
