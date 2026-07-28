import { describe, it, expect } from "vitest";
import {
  DEFAULT_FLIGHT_SIMULATION_CONTENT,
  readFlightSimulationContent,
} from "../src/templates/flight-simulation/content";

describe("readFlightSimulationContent", () => {
  it("returns null when the template has no authored content", () => {
    expect(readFlightSimulationContent(null)).toBeNull();
    expect(readFlightSimulationContent(undefined)).toBeNull();
    expect(readFlightSimulationContent({})).toBeNull();
  });

  it("returns null when the slice is not an object", () => {
    for (const bad of ["", "nope", 42, true]) {
      expect(readFlightSimulationContent({ "flight-simulation": bad })).toBeNull();
    }
  });

  it("fills a partial slice from the defaults", () => {
    const parsed = readFlightSimulationContent({
      "flight-simulation": { airportCode: "DEL" },
    });
    expect(parsed).toEqual({ ...DEFAULT_FLIGHT_SIMULATION_CONTENT, airportCode: "DEL" });
  });

  it("does not read another template's slice", () => {
    expect(readFlightSimulationContent({ welcome: { title: "hi" } })).toBeNull();
  });

  it("normalizes the airport code", () => {
    expect(readFlightSimulationContent({ "flight-simulation": { airportCode: " blr " } })!.airportCode)
      .toBe("BLR");
  });

  it("falls back to the default airport when the code is blank or wrong-typed", () => {
    for (const bad of ["", "   ", null, 7]) {
      const parsed = readFlightSimulationContent({ "flight-simulation": { airportCode: bad } });
      expect(parsed!.airportCode).toBe(DEFAULT_FLIGHT_SIMULATION_CONTENT.airportCode);
    }
  });

  it("clamps simulation speed into the supported range", () => {
    const speed = (v: unknown) =>
      readFlightSimulationContent({ "flight-simulation": { simulationSpeed: v } })!.simulationSpeed;

    expect(speed(0.1)).toBe(0.5);
    expect(speed(99)).toBe(2);
    expect(speed(1.25)).toBe(1.25);
    // Garbage must not reach the render loop. Non-finite values fall back to
    // the default rather than clamping — a corrupt slice should play at normal
    // speed, not pin the simulation to its maximum.
    expect(speed("fast")).toBe(1);
    expect(speed(NaN)).toBe(1);
    expect(speed(Infinity)).toBe(1);
  });

  it("clamps the refresh interval and allows 0 to disable polling", () => {
    const refresh = (v: unknown) =>
      readFlightSimulationContent({ "flight-simulation": { refreshIntervalSeconds: v } })!
        .refreshIntervalSeconds;

    expect(refresh(0)).toBe(0);
    expect(refresh(-5)).toBe(0);
    expect(refresh(99_999)).toBe(3600);
    expect(refresh("soon")).toBe(60);
  });

  it("treats the booleans as opt-out, not opt-in", () => {
    const parsed = readFlightSimulationContent({
      "flight-simulation": { showHud: false, allowAirportSwitching: false },
    })!;
    expect(parsed.showHud).toBe(false);
    expect(parsed.allowAirportSwitching).toBe(false);

    // Anything not explicitly false stays on, so a legacy slice missing these
    // keys keeps the HUD rather than silently losing it.
    const legacy = readFlightSimulationContent({ "flight-simulation": { airportCode: "BLR" } })!;
    expect(legacy.showHud).toBe(true);
    expect(legacy.allowAirportSwitching).toBe(true);
  });

  it("ignores unknown keys rather than throwing", () => {
    expect(() =>
      readFlightSimulationContent({ "flight-simulation": { somethingNew: 1 } })
    ).not.toThrow();
  });
});
