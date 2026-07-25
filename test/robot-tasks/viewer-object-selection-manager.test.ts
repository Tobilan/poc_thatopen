/* eslint-disable max-classes-per-file -- Two small in-memory ports keep the workflow tests readable. */

import assert from "node:assert/strict";
import test from "node:test";
import type { RobotObjectReference } from "../../src/domain/robot-tasks";
import type {
  CandidateSource,
  HighlightPort,
  SelectionCandidateBatch,
  SelectionPoint,
  ViewerObjectSelectionCandidate,
  ViewerObjectSelectionFilters,
} from "../../src/viewer/robot-tasks/selection-types";
import { ViewerObjectSelectionManager } from "../../src/viewer/robot-tasks/viewer-object-selection-manager";

/** Creates a stable candidate suitable for task-service assignment. */
const stableCandidate = (
  localId: number,
  distance = localId,
): ViewerObjectSelectionCandidate => {
  const reference: RobotObjectReference = {
    globalId: `guid-${localId}`,
    modelId: "model-a",
    expressId: localId,
    ifcClass: "IFCDOOR",
    name: `Door ${localId}`,
  };
  return {
    modelId: "model-a",
    localId,
    distance,
    globalId: reference.globalId,
    expressId: localId,
    ifcClass: reference.ifcClass,
    name: reference.name,
    visible: true,
    reference,
  };
};

/** In-memory candidate source whose responses can be changed between picks. */
class FakeCandidateSource implements CandidateSource {
  batch: SelectionCandidateBatch = { candidates: [] };
  hover?: ViewerObjectSelectionCandidate;
  pickCalls = 0;
  hoverCalls = 0;
  lastFilters?: ViewerObjectSelectionFilters;

  async pickCandidates(
    _point: SelectionPoint,
    filters: ViewerObjectSelectionFilters,
  ): Promise<SelectionCandidateBatch> {
    this.pickCalls += 1;
    this.lastFilters = filters;
    return this.batch;
  }

  async hoverCandidate(): Promise<ViewerObjectSelectionCandidate | undefined> {
    this.hoverCalls += 1;
    return this.hover;
  }
}

/** Records visual-port calls without requiring a WebGL viewer. */
class FakeHighlightPort implements HighlightPort {
  hover?: ViewerObjectSelectionCandidate;
  candidates: readonly ViewerObjectSelectionCandidate[] = [];
  active?: ViewerObjectSelectionCandidate;
  confirmed?: ViewerObjectSelectionCandidate;
  candidateUpdates = 0;

  showHover(candidate?: ViewerObjectSelectionCandidate): void {
    this.hover = candidate;
  }

  showCandidates(
    candidates: readonly ViewerObjectSelectionCandidate[],
    activeCandidate?: ViewerObjectSelectionCandidate,
  ): void {
    this.candidates = candidates;
    this.active = activeCandidate;
    this.candidateUpdates += 1;
  }

  showConfirmed(candidate?: ViewerObjectSelectionCandidate): void {
    this.confirmed = candidate;
  }
}

/** Creates a manager fixture with deterministic hover timing. */
const managerFixture = () => {
  const source = new FakeCandidateSource();
  const highlights = new FakeHighlightPort();
  let now = 0;
  const manager = new ViewerObjectSelectionManager(
    source,
    highlights,
    undefined,
    { now: () => now },
  );
  return {
    source,
    highlights,
    manager,
    advanceTime: (milliseconds: number) => {
      now += milliseconds;
    },
  };
};

test("one stable candidate confirms immediately and returns a domain reference", async () => {
  const fixture = managerFixture();
  fixture.source.batch = { candidates: [stableCandidate(1)] };

  const snapshot = await fixture.manager.pickAt({ x: 10, y: 20 });

  assert.equal(snapshot.status, "confirmed");
  assert.equal(snapshot.candidates.length, 0);
  assert.deepEqual(snapshot.confirmedReference, stableCandidate(1).reference);
  assert.equal(fixture.highlights.confirmed?.localId, 1);
});

test("overlapping candidates can be previewed, cycled, and explicitly confirmed", async () => {
  const fixture = managerFixture();
  fixture.source.batch = {
    candidates: [stableCandidate(1, 1), stableCandidate(2, 2)],
    truncated: true,
  };

  let snapshot = await fixture.manager.pickAt({ x: 10, y: 20 });
  assert.equal(snapshot.status, "choosing");
  assert.equal(snapshot.activeIndex, 0);
  assert.equal(snapshot.truncated, true);

  snapshot = await fixture.manager.pickAt({ x: 12, y: 22 });
  assert.equal(snapshot.activeIndex, 1);
  assert.equal(
    fixture.source.pickCalls,
    1,
    "nearby repeated click reuses hits",
  );

  await fixture.manager.cycleCandidate("next");
  assert.equal(fixture.manager.getSnapshot().activeIndex, 0);
  await fixture.manager.setActiveCandidate(1);
  const reference = await fixture.manager.confirmActiveCandidate();

  assert.deepEqual(reference, stableCandidate(2).reference);
  assert.equal(fixture.manager.getSnapshot().status, "confirmed");
  assert.equal(fixture.highlights.confirmed?.localId, 2);
});

test("cancel and source errors preserve the previously confirmed object", async () => {
  const fixture = managerFixture();
  fixture.source.batch = { candidates: [stableCandidate(1)] };
  await fixture.manager.pickAt({ x: 0, y: 0 });

  fixture.source.batch = {
    candidates: [stableCandidate(2), stableCandidate(3)],
  };
  await fixture.manager.pickAt({ x: 20, y: 20 });
  await fixture.manager.cancelCandidateChoice();
  assert.equal(fixture.manager.getSnapshot().confirmedCandidate?.localId, 1);

  fixture.source.pickCandidates = async () => {
    throw new Error("worker unavailable");
  };
  const snapshot = await fixture.manager.pickAt({ x: 40, y: 40 });
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.confirmedCandidate?.localId, 1);
  assert.match(snapshot.error ?? "", /worker unavailable/);
});

test("an empty canvas pick clears the committed selection", async () => {
  const fixture = managerFixture();
  fixture.source.batch = { candidates: [stableCandidate(1)] };
  await fixture.manager.pickAt({ x: 0, y: 0 });

  fixture.source.batch = { candidates: [] };
  const snapshot = await fixture.manager.pickAt({ x: 30, y: 30 });

  assert.equal(snapshot.status, "idle");
  assert.equal(snapshot.confirmedReference, undefined);
  assert.equal(fixture.highlights.confirmed, undefined);
});

test("filters normalize IFC classes and refresh an open chooser", async () => {
  const fixture = managerFixture();
  fixture.source.batch = {
    candidates: [stableCandidate(1), stableCandidate(2)],
  };
  await fixture.manager.pickAt({ x: 5, y: 5 });

  await fixture.manager.setFilters({
    includeIfcClasses: [" ifcdoor ", "IFCDOOR"],
    excludeIfcClasses: [" ifcspace "],
    maxCandidates: 200,
  });

  assert.equal(fixture.source.pickCalls, 2);
  assert.deepEqual(fixture.source.lastFilters, {
    visibleOnly: true,
    includeIfcClasses: ["IFCDOOR"],
    excludeIfcClasses: ["IFCSPACE"],
    maxCandidates: 20,
  });
});

test("late asynchronous pick results cannot replace a newer selection", async () => {
  const fixture = managerFixture();
  let resolveFirst: (batch: SelectionCandidateBatch) => void = () => undefined;
  let resolveSecond: (batch: SelectionCandidateBatch) => void = () => undefined;
  let call = 0;
  fixture.source.pickCandidates = async () => {
    call += 1;
    return new Promise<SelectionCandidateBatch>((resolve) => {
      if (call === 1) resolveFirst = resolve;
      else resolveSecond = resolve;
    });
  };

  const firstPick = fixture.manager.pickAt({ x: 1, y: 1 });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  const secondPick = fixture.manager.pickAt({ x: 20, y: 20 });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  resolveSecond({ candidates: [stableCandidate(2)] });
  await secondPick;
  resolveFirst({ candidates: [stableCandidate(1)] });
  await firstPick;

  assert.equal(fixture.manager.getSnapshot().confirmedCandidate?.localId, 2);
  assert.equal(fixture.highlights.confirmed?.localId, 2);
});

test("hover is throttled and duplicate hits do not repaint", async () => {
  const fixture = managerFixture();
  fixture.source.hover = stableCandidate(1);

  await fixture.manager.hoverAt({ x: 1, y: 1 });
  fixture.advanceTime(50);
  await fixture.manager.hoverAt({ x: 2, y: 2 });
  fixture.advanceTime(50);
  await fixture.manager.hoverAt({ x: 3, y: 3 });

  assert.equal(fixture.source.hoverCalls, 2);
  assert.equal(fixture.highlights.hover?.localId, 1);
});

test("unresolvable candidates remain visible but cannot be confirmed", async () => {
  const fixture = managerFixture();
  fixture.source.batch = {
    candidates: [
      {
        modelId: "third-party-fragments",
        localId: 99,
        distance: 1,
        confirmationError: "No stable IFC identifier.",
      },
    ],
  };

  const snapshot = await fixture.manager.pickAt({ x: 0, y: 0 });
  assert.equal(snapshot.status, "choosing");
  await assert.rejects(
    fixture.manager.confirmActiveCandidate(),
    /No stable IFC identifier/,
  );
});
