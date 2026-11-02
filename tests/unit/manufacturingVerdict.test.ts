import { expect, it } from "vitest";
import { contactVerdict, combineSurfaceVerdicts, verificationFailure } from "@/lib/manufacturingVerdict";
import { manufacturingSurfaceChecks } from "@/lib/meshManufacturingQa";
import type { StlExportMesh } from "@/lib/stlExport";

const tetra: StlExportMesh = {
  vertices: [[0, 0, 0], [0, 2, 0], [2, 0, 0], [0, 0, 2]],
  faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
};

it("never labels incomplete, disabled, cancelled or failed validation valid", () => {
  expect(contactVerdict(0, false, "deadline").status).toBe("inconclusive");
  expect(contactVerdict(1, false).status).toBe("verified-invalid");
  expect(contactVerdict(0, true).status).toBe("verified-valid");
  expect(combineSurfaceVerdicts(false, [contactVerdict(0, true)]).status).toBe("verified-invalid");
  expect(combineSurfaceVerdicts(true, [contactVerdict(0, true), contactVerdict(0, false)]).status).toBe("inconclusive");
  expect(combineSurfaceVerdicts(true, []).status).toBe("inconclusive");
  expect(verificationFailure(new DOMException("Canceled", "AbortError")).status).toBe("cancelled");
  expect(verificationFailure(new Error("Worker exceeded its time budget")).status).toBe("inconclusive");
  expect(verificationFailure(new Error("Invalid decoded result")).status).toBe("failed");
});

it("keeps time and pair-limit exhaustion distinct, blocked and geometrically unchanged", () => {
  const before = JSON.stringify(tetra);
  const pairs = manufacturingSurfaceChecks(tetra, true, 0, [], { candidatePairBudget: 0 }).selfIntersections;
  expect(pairs.complete).toBe(false);
  expect(pairs.verification.status).toBe("inconclusive");
  expect(pairs.stopReason).toBe("candidate-budget");
  expect(pairs.narrowPhaseTests).toBe(0);
  const time = manufacturingSurfaceChecks(tetra, true, 0, [], { timeBudgetMs: 0 }).selfIntersections;
  expect(time.complete).toBe(false);
  expect(time.stopReason).toBe("deadline");
  expect(time.verification.status).toBe("inconclusive");
  const disabled = manufacturingSurfaceChecks(tetra, false, 0).selfIntersections;
  expect(disabled.stopReason).toBe("disabled");
  expect(disabled.verification.status).toBe("inconclusive");
  expect(JSON.stringify(tetra)).toBe(before);
});

it("records complete contact coverage with opt-in narrow-phase cost and no tolerance changes", () => {
  const standard = manufacturingSurfaceChecks(tetra, true, 0).selfIntersections;
  const profiled = manufacturingSurfaceChecks(tetra, true, 0, [], { profile: true }).selfIntersections;
  for (const value of [standard, profiled]) {
    expect(value.verification.status).toBe("verified-valid");
    expect(value.complete).toBe(true);
    expect(value.found).toBe(0);
    expect(value.narrowPhaseTests).toBe(value.candidatePairs);
    expect(Object.values(value.contactTypes).reduce((a, b) => a + b, 0)).toBe(value.narrowPhaseTests);
    expect(value.broadPhasePairs).toBe(value.narrowPhaseTests + value.boundsRejectedPairs);
  }
  expect(profiled.contactTypes).toEqual(standard.contactTypes);
  expect(standard.timings.narrowPhaseMs).toBeNull();
  expect(profiled.timings.narrowPhaseMs).toBeGreaterThanOrEqual(0);
  expect(() => manufacturingSurfaceChecks(tetra, true, 0, [], { timeBudgetMs: -1 })).toThrow(/budget/);
  expect(() => manufacturingSurfaceChecks(tetra, true, 0, [], { candidatePairBudget: NaN })).toThrow(/budget/);
});
