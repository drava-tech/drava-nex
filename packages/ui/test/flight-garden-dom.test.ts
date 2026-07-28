import { describe, it, expect, beforeEach } from "vitest";
import { buildDom } from "../src/templates/flight-simulation/engine/dom";

// buildDom replaces the markup the standalone index.html used to provide. The
// ported engine reads those nodes through the returned `ui` object, so a
// missing or renamed node would surface as a null-deref at 60fps rather than at
// startup — hence checking every handle here.

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("buildDom", () => {
  it("mounts a single scoped root inside the host", () => {
    buildDom(host);
    expect(host.children).toHaveLength(1);
    expect((host.firstElementChild as HTMLElement).className).toBe("fg-root");
  });

  it("provides every node the engine writes to", () => {
    const { ui } = buildDom(host);
    for (const [key, node] of Object.entries(ui)) {
      expect(node, `ui.${key} is missing`).toBeTruthy();
      expect(node, `ui.${key} is not an element`).toBeInstanceOf(HTMLElement);
    }
  });

  it("exposes a canvas and a label layer", () => {
    const { canvas, labelLayer } = buildDom(host);
    expect(canvas.tagName).toBe("CANVAS");
    expect(labelLayer.className).toBe("label-layer");
    // The engine appends projected zone labels here.
    expect(labelLayer.isConnected).toBe(true);
  });

  it("keeps the stat counters distinct", () => {
    const { ui } = buildDom(host);
    const stats = [ui.arrivals, ui.departures, ui.parked, ui.active];
    expect(new Set(stats).size).toBe(4);
    for (const s of stats) expect(s.textContent).toBe("0");
  });

  it("starts the flight detail panel in its empty state", () => {
    const { ui } = buildDom(host);
    expect(ui.detailBody.hidden).toBe(true);
    expect(ui.unpinBtn.hidden).toBe(true);
    expect(ui.detailEmpty.hidden).toBe(false);
  });

  it("gives the airport picker an empty select for the engine to populate", () => {
    const { ui } = buildDom(host);
    expect(ui.select.tagName).toBe("SELECT");
    expect(ui.select.options).toHaveLength(0);
  });

  it("removes everything it added on destroy", () => {
    const dom = buildDom(host);
    expect(host.children).toHaveLength(1);
    dom.destroy();
    expect(host.children).toHaveLength(0);
  });

  it("supports repeated build/destroy cycles without accumulating nodes", () => {
    // React Strict Mode double-invokes effects, so mount → destroy → mount is
    // the normal development path, not an edge case.
    for (let i = 0; i < 5; i++) {
      const dom = buildDom(host);
      expect(host.querySelectorAll(".fg-root")).toHaveLength(1);
      expect(host.querySelectorAll("canvas")).toHaveLength(1);
      dom.destroy();
    }
    expect(host.children).toHaveLength(0);
  });

  it("isolates instances so two mounts never share nodes", () => {
    const hostB = document.createElement("div");
    document.body.appendChild(hostB);

    const a = buildDom(host);
    const b = buildDom(hostB);

    expect(a.canvas).not.toBe(b.canvas);
    expect(a.ui.towerTitle).not.toBe(b.ui.towerTitle);

    a.destroy();
    // Disposing one instance must not touch the other.
    expect(hostB.querySelectorAll("canvas")).toHaveLength(1);
    b.destroy();
  });
});
