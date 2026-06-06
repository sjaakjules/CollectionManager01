import { describe, expect, it } from "vitest";
import { isStartupGateEnabled } from "./startupGate";

describe("startupGate", () => {
  it("stays disabled without a debug gate query parameter", () => {
    expect(isStartupGateEnabled("")).toBe(false);
    expect(isStartupGateEnabled("?view=mobile")).toBe(false);
  });

  it("enables the startup gate from supported query parameters", () => {
    expect(isStartupGateEnabled("?debugSplash=1")).toBe(true);
    expect(isStartupGateEnabled("?debugSplash")).toBe(true);
    expect(isStartupGateEnabled("?holdStartup=true")).toBe(true);
    expect(isStartupGateEnabled("?pauseStartup=yes")).toBe(true);
  });

  it("allows explicit false values to disable the gate", () => {
    expect(isStartupGateEnabled("?debugSplash=0")).toBe(false);
    expect(isStartupGateEnabled("?holdStartup=false")).toBe(false);
    expect(isStartupGateEnabled("?pauseStartup=off")).toBe(false);
  });
});

