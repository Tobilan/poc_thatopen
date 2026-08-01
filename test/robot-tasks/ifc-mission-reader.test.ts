import assert from "node:assert/strict";
import test from "node:test";
import {
  IFCRELASSIGNSTOCONTROL,
  IFCRELASSIGNSTOPROCESS,
  IFCRELASSIGNSTOPRODUCT,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELNESTS,
  IFCRELSEQUENCE,
  IFCTASK,
} from "web-ifc";
import type { LocateFileHandlerFn } from "web-ifc";
import {
  WebIfcMissionReader,
  type IfcMissionReaderApiPort,
  type IfcMissionReaderIdVectorPort,
} from "../../src/ifc/model-import";

const value = <Value>(entry: Value): { value: Value } => ({ value: entry });
const handle = (expressId: number): { value: number } => value(expressId);
const vector = (entries: readonly number[]): IfcMissionReaderIdVectorPort => ({
  size: () => entries.length,
  get: (index) => entries[index],
});

interface FakeLine extends Record<string, unknown> {
  expressID: number;
}

class FakeReaderApi implements IfcMissionReaderApiPort {
  readonly lines = new Map<number, FakeLine>();
  readonly idsByType = new Map<number, number[]>();
  readonly names = new Map<number, string>();
  private readonly types = new Map<number, number>();

  add(type: number, typeName: string, line: FakeLine): FakeLine {
    this.lines.set(line.expressID, line);
    this.types.set(line.expressID, type);
    this.names.set(type, typeName);
    this.idsByType.set(type, [
      ...(this.idsByType.get(type) ?? []),
      line.expressID,
    ]);
    return line;
  }

  remove(expressId: number): void {
    this.lines.delete(expressId);
    for (const [type, entries] of this.idsByType) {
      this.idsByType.set(
        type,
        entries.filter((entry) => entry !== expressId),
      );
    }
  }

  GetLineIDsWithType(
    _modelID: number,
    type: number,
  ): IfcMissionReaderIdVectorPort {
    return vector(this.idsByType.get(type) ?? []);
  }

  GetLine(_modelID: number, expressID: number): unknown {
    return this.lines.get(expressID);
  }

  GetLineType(_modelID: number, expressID: number): number {
    return this.types.get(expressID) ?? 0;
  }

  GetNameFromTypeCode(type: number): string {
    return this.names.get(type) ?? "IFCUNKNOWN";
  }

  SetWasmPath(): void {}
  async Init(_handler?: LocateFileHandlerFn): Promise<void> {}
  OpenModel(): number {
    return 1;
  }
  IsModelOpen(): boolean {
    return true;
  }
  GetModelSchema(): string {
    return "IFC4";
  }
  CloseModel(): void {}
  Dispose(): void {}
}

const OTHER = 9000;

const addPropertySet = (
  api: FakeReaderApi,
  ownerId: number,
  propertySetId: number,
  relationId: number,
  name: "RobotMission" | "RobotTask" | "RobotAction",
  properties: Record<string, unknown>,
): void => {
  const propertyIds: number[] = [];
  let nextId = propertySetId + 1000;
  for (const [propertyName, propertyValue] of Object.entries(properties)) {
    const propertyId = nextId++;
    propertyIds.push(propertyId);
    api.add(
      OTHER + (Array.isArray(propertyValue) ? 2 : 1),
      Array.isArray(propertyValue)
        ? "IFCPROPERTYLISTVALUE"
        : "IFCPROPERTYSINGLEVALUE",
      {
        expressID: propertyId,
        Name: value(propertyName),
        ...(Array.isArray(propertyValue)
          ? { ListValues: propertyValue.map(value) }
          : { NominalValue: value(propertyValue) }),
      },
    );
  }
  api.add(OTHER + 3, "IFCPROPERTYSET", {
    expressID: propertySetId,
    GlobalId: value(`pset-${propertySetId}`),
    Name: value(name),
    HasProperties: propertyIds.map(handle),
  });
  api.add(IFCRELDEFINESBYPROPERTIES, "IFCRELDEFINESBYPROPERTIES", {
    expressID: relationId,
    GlobalId: value(`property-relation-${relationId}`),
    RelatedObjects: [handle(ownerId)],
    RelatingPropertyDefinition: handle(propertySetId),
  });
};

interface MissionFixture {
  missionExpressId: number;
  taskExpressIds: number[];
  nestExpressId: number;
}

const addMission = (
  api: FakeReaderApi,
  offset = 0,
  missionId = `mission-${offset}`,
  taskIds = [`task-a-${offset}`, `task-b-${offset}`],
): MissionFixture => {
  const missionExpressId = 10 + offset;
  const taskExpressIds = [20 + offset, 21 + offset];
  const objectExpressId = 30 + offset;
  const nestExpressId = 40 + offset;
  api.add(IFCTASK, "IFCTASK", {
    expressID: missionExpressId,
    GlobalId: value(`mission-guid-${offset}`),
    Name: value(`Mission ${offset}`),
    Description: value("Mission description"),
    ObjectType: value("RobotMission"),
    Identification: value(missionId),
    Status: value("open"),
    Priority: value(4),
    PredefinedType: value("USERDEFINED"),
  });
  api.add(IFCTASK, "IFCTASK", {
    expressID: taskExpressIds[0],
    GlobalId: value(`task-guid-a-${offset}`),
    Name: value("Navigate"),
    Description: value("Task description"),
    ObjectType: value("RobotTask"),
    Identification: value(taskIds[0]),
    Status: value("in_progress"),
    Priority: value(3),
    PredefinedType: value("USERDEFINED"),
    TaskTime: handle(50 + offset),
  });
  api.add(IFCTASK, "IFCTASK", {
    expressID: taskExpressIds[1],
    GlobalId: value(`task-guid-b-${offset}`),
    Name: value("Pass"),
    ObjectType: value("RobotTask"),
    Identification: value(taskIds[1]),
    PredefinedType: value("USERDEFINED"),
  });
  api.add(OTHER + 10, "IFCDOOR", {
    expressID: objectExpressId,
    GlobalId: value(`door-guid-${offset}`),
    Name: value("Door"),
  });
  api.add(OTHER + 11, "IFCTASKTIME", {
    expressID: 50 + offset,
    ScheduleStart: value("2026-01-01T08:00:00"),
    ScheduleFinish: value("2026-01-01T08:05:00"),
    ScheduleDuration: value("PT5M"),
    ActualStart: value("2026-01-01T08:01:00"),
    ActualFinish: value("2026-01-01T08:04:00"),
    RemainingTime: value("PT1M"),
    Completion: value(0.75),
  });
  api.add(IFCRELNESTS, "IFCRELNESTS", {
    expressID: nestExpressId,
    GlobalId: value(`nest-guid-${offset}`),
    RelatingObject: handle(missionExpressId),
    RelatedObjects: taskExpressIds.map(handle),
  });
  addPropertySet(
    api,
    missionExpressId,
    60 + offset,
    70 + offset,
    "RobotMission",
    {
      CreatedAt: "2026-01-01T00:00:00Z",
      UpdatedAt: "2026-01-02T00:00:00Z",
      FutureMissionProperty: "ignored",
    },
  );
  addPropertySet(
    api,
    taskExpressIds[0],
    80 + offset,
    90 + offset,
    "RobotAction",
    {
      ActionType: "NAVIGATE_TO",
      TargetState: "ARRIVED",
      TargetObjectRole: "DESTINATION",
      AffectedObjectRole: "CONTEXT",
      RequiredCapability: "navigation",
      Preconditions: ["localized", "path clear"],
      Postconditions: ["at destination"],
      SuccessCondition: "Target reached",
      FutureActionProperty: "ignored",
    },
  );
  addPropertySet(
    api,
    taskExpressIds[0],
    100 + offset,
    110 + offset,
    "RobotTask",
    {
      CreatedAt: "2026-01-01T01:00:00Z",
      UpdatedAt: "2026-01-02T01:00:00Z",
      CameraPosition: [1, 2, 3],
      CameraTarget: [4, 5, 6],
      MarkerPosition: [7, 8, 9],
    },
  );
  addPropertySet(
    api,
    taskExpressIds[1],
    120 + offset,
    130 + offset,
    "RobotAction",
    {
      ActionType: "PASS_THROUGH",
    },
  );
  addPropertySet(
    api,
    taskExpressIds[1],
    140 + offset,
    150 + offset,
    "RobotTask",
    {
      CreatedAt: "2026-01-01T02:00:00Z",
      UpdatedAt: "2026-01-02T02:00:00Z",
    },
  );
  api.add(IFCRELASSIGNSTOPROCESS, "IFCRELASSIGNSTOPROCESS", {
    expressID: 160 + offset,
    GlobalId: value(`target-guid-${offset}`),
    Name: value("NAVIGATES_TO"),
    RelatingProcess: handle(taskExpressIds[0]),
    RelatedObjects: [handle(objectExpressId)],
  });
  api.add(IFCRELASSIGNSTOPROCESS, "IFCRELASSIGNSTOPROCESS", {
    expressID: 161 + offset,
    GlobalId: value(`affected-guid-${offset}`),
    Name: value("AFFECTS"),
    RelatingProcess: handle(taskExpressIds[0]),
    RelatedObjects: [handle(objectExpressId)],
  });
  api.add(IFCRELASSIGNSTOPROCESS, "IFCRELASSIGNSTOPROCESS", {
    expressID: 162 + offset,
    GlobalId: value(`pass-guid-${offset}`),
    Name: value("PASSES_THROUGH"),
    RelatingProcess: handle(taskExpressIds[1]),
    RelatedObjects: [handle(objectExpressId)],
  });
  api.add(IFCRELSEQUENCE, "IFCRELSEQUENCE", {
    expressID: 170 + offset,
    GlobalId: value(`sequence-guid-${offset}`),
    RelatingProcess: handle(taskExpressIds[0]),
    RelatedProcess: handle(taskExpressIds[1]),
    SequenceType: value("FINISH_START"),
  });
  api.add(OTHER + 12, "IFCWORKSCHEDULE", {
    expressID: 180 + offset,
    GlobalId: value(`schedule-guid-${offset}`),
    Name: value("Schedule"),
    Identification: value(`schedule-${offset}`),
    StartTime: value("2026-01-01T08:00:00"),
    FinishTime: value("2026-01-01T08:05:00"),
    Duration: value("PT5M"),
  });
  api.add(IFCRELASSIGNSTOCONTROL, "IFCRELASSIGNSTOCONTROL", {
    expressID: 190 + offset,
    GlobalId: value(`control-guid-${offset}`),
    RelatedObjects: [handle(missionExpressId)],
    RelatingControl: handle(180 + offset),
  });
  return { missionExpressId, taskExpressIds, nestExpressId };
};

const read = (api: FakeReaderApi) =>
  new WebIfcMissionReader().read(api, 1, "runtime-model", "IFC4");

test("IFC without project-owned robot missions succeeds with an empty result", () => {
  const api = new FakeReaderApi();
  api.add(IFCTASK, "IFCTASK", {
    expressID: 1,
    Name: value("Unrelated construction task"),
    ObjectType: value("Construction"),
    Identification: value("unrelated"),
    PredefinedType: value("USERDEFINED"),
  });
  assert.deepEqual(read(api), {
    missions: [],
    issues: [],
    provenance: { sourceModelId: "runtime-model", entities: [] },
    schema: "IFC4",
  });
});

test("reader reconstructs complete fields, hierarchy order, properties, time, schedule and references", () => {
  const api = new FakeReaderApi();
  addMission(api);
  const result = read(api);
  assert.equal(result.missions.length, 1);
  const mission = result.missions[0];
  assert.deepEqual(
    mission.tasks.map((task) => task.id),
    ["task-a-0", "task-b-0"],
  );
  assert.equal(mission.status, "open");
  assert.equal(mission.priority, "critical");
  assert.deepEqual(mission.schedule, {
    id: "schedule-0",
    name: "Schedule",
    scheduleStart: "2026-01-01T08:00:00",
    scheduleFinish: "2026-01-01T08:05:00",
    scheduleDuration: "PT5M",
  });
  const task = mission.tasks[0];
  assert.equal(task.status, "in_progress");
  assert.equal(task.priority, "high");
  assert.equal(task.actionType, "NAVIGATE_TO");
  assert.deepEqual(task.properties, {
    targetState: "ARRIVED",
    targetObjectRole: "DESTINATION",
    affectedObjectRole: "CONTEXT",
    requiredCapability: "navigation",
    preconditions: ["localized", "path clear"],
    postconditions: ["at destination"],
    successCondition: "Target reached",
  });
  assert.deepEqual(task.time, {
    scheduleStart: "2026-01-01T08:00:00",
    scheduleFinish: "2026-01-01T08:05:00",
    scheduleDuration: "PT5M",
    actualStart: "2026-01-01T08:01:00",
    actualFinish: "2026-01-01T08:04:00",
    remainingTime: "PT1M",
    completion: 0.75,
  });
  assert.deepEqual(task.viewpoint, {
    cameraPosition: [1, 2, 3],
    cameraTarget: [4, 5, 6],
  });
  assert.deepEqual(task.markerPosition, [7, 8, 9]);
  assert.deepEqual(task.targetObjects[0], {
    globalId: "door-guid-0",
    modelId: "runtime-model",
    expressId: 30,
    ifcClass: "IFCDOOR",
    name: "Door",
  });
  assert.equal(task.affectedObjects[0].globalId, "door-guid-0");
  assert.deepEqual(mission.sequences, [
    {
      id: "sequence/task-a-0/task-b-0/FINISH_START",
      predecessorTaskId: "task-a-0",
      successorTaskId: "task-b-0",
      sequenceType: "FINISH_START",
    },
  ]);
  assert.ok(
    result.issues.some(
      (entry) => entry.code === "IFC_SEQUENCE_ID_COMPATIBILITY_FALLBACK",
    ),
  );
  assert.ok(
    result.issues.some(
      (entry) => entry.code === "IFC_SCHEDULE_AUTHORED_STATE_UNKNOWN",
    ),
  );
  assert.ok(
    result.provenance.entities.some(
      (entry) => entry.recordIdentity === "mission-task/mission-0",
    ),
  );
  assert.ok(
    result.provenance.entities.some(
      (entry) => entry.entityType === "IFCPROPERTYLISTVALUE",
    ),
  );
});

test("reader reconstructs multiple independent missions", () => {
  const api = new FakeReaderApi();
  addMission(api, 0);
  addMission(api, 300);
  assert.deepEqual(
    read(api).missions.map((mission) => mission.id),
    ["mission-0", "mission-300"],
  );
});

test("reader reconstructs MOVE start and destination", () => {
  const api = new FakeReaderApi();
  const fixture = addMission(api);
  const actionSet = api.lines.get(80)!;
  const actionPropertyId = (
    actionSet.HasProperties as Array<{ value: number }>
  )[0].value;
  (api.lines.get(actionPropertyId)!.NominalValue as { value: string }).value =
    "MOVE";
  const target = api.lines.get(160)!;
  target.Name = value("OPERATES_ON");
  api.add(IFCRELASSIGNSTOPROCESS, "IFCRELASSIGNSTOPROCESS", {
    expressID: 200,
    Name: value("MOVE_FROM"),
    RelatingProcess: handle(fixture.taskExpressIds[0]),
    RelatedObjects: [handle(30)],
  });
  api.add(IFCRELASSIGNSTOPRODUCT, "IFCRELASSIGNSTOPRODUCT", {
    expressID: 201,
    Name: value("MOVE_TO"),
    RelatedObjects: [handle(fixture.taskExpressIds[0])],
    RelatingProduct: handle(30),
  });
  const task = read(api).missions[0].tasks[0];
  assert.equal(task.startReference?.globalId, "door-guid-0");
  assert.equal(task.targetReference?.globalId, "door-guid-0");
});

test("duplicate mission IDs block both ambiguous roots", () => {
  const api = new FakeReaderApi();
  addMission(api, 0, "duplicate");
  addMission(api, 300, "duplicate");
  const result = read(api);
  assert.equal(result.missions.length, 0);
  assert.equal(
    result.issues.filter((entry) => entry.code === "IFC_MISSION_ID_DUPLICATE")
      .length,
    2,
  );
});

test("duplicate task IDs block their mission", () => {
  const api = new FakeReaderApi();
  addMission(api, 0, "mission", ["duplicate-task", "duplicate-task"]);
  const result = read(api);
  assert.equal(result.missions.length, 0);
  assert.ok(
    result.issues.some((entry) => entry.code === "IFC_TASK_ID_DUPLICATE"),
  );
});

test("one task nested below multiple owned missions blocks both graphs", () => {
  const api = new FakeReaderApi();
  const first = addMission(api, 0);
  const second = addMission(api, 300);
  (
    api.lines.get(second.nestExpressId)!.RelatedObjects as Array<{
      value: number;
    }>
  ).push(handle(first.taskExpressIds[0]));
  const result = read(api);
  assert.equal(result.missions.length, 0);
  assert.ok(
    result.issues.some(
      (entry) => entry.code === "IFC_TASK_MULTIPLE_MISSION_PARENTS",
    ),
  );
});

test("contradictory task assignments are rejected", () => {
  const api = new FakeReaderApi();
  addMission(api);
  api.lines.get(160)!.Name = value("OPERATES_ON");
  const result = read(api);
  assert.equal(result.missions.length, 0);
  assert.ok(
    result.issues.some(
      (entry) => entry.code === "IFC_ASSIGNMENT_ROLE_CONTRADICTORY",
    ),
  );
});

test("multiple different MOVE destinations are rejected", () => {
  const api = new FakeReaderApi();
  const fixture = addMission(api);
  const actionPropertyId = (
    api.lines.get(80)!.HasProperties as Array<{ value: number }>
  )[0].value;
  (api.lines.get(actionPropertyId)!.NominalValue as { value: string }).value =
    "MOVE";
  api.lines.get(160)!.Name = value("OPERATES_ON");
  api.add(OTHER + 10, "IFCDOOR", {
    expressID: 31,
    GlobalId: value("other-door"),
  });
  for (const [expressID, product] of [
    [201, 30],
    [202, 31],
  ] as const) {
    api.add(IFCRELASSIGNSTOPRODUCT, "IFCRELASSIGNSTOPRODUCT", {
      expressID,
      Name: value("MOVE_TO"),
      RelatedObjects: [handle(fixture.taskExpressIds[0])],
      RelatingProduct: handle(product),
    });
  }
  const result = read(api);
  assert.equal(result.missions.length, 0);
  assert.ok(
    result.issues.some(
      (entry) => entry.code === "IFC_MOVE_DESTINATION_AMBIGUOUS",
    ),
  );
});

test("missing RobotAction and unsupported action values are blocking graph issues", () => {
  for (const mode of ["missing", "unsupported"] as const) {
    const api = new FakeReaderApi();
    addMission(api);
    if (mode === "missing") api.remove(90);
    else {
      const propertyId = (
        api.lines.get(80)!.HasProperties as Array<{ value: number }>
      )[0].value;
      (api.lines.get(propertyId)!.NominalValue as { value: string }).value =
        "FLY";
    }
    const result = read(api);
    assert.equal(result.missions.length, 0);
    assert.ok(
      result.issues.some(
        (entry) =>
          entry.code ===
          (mode === "missing"
            ? "IFC_PROPERTY_SET_MISSING"
            : "IFC_ROBOT_ACTION_UNSUPPORTED"),
      ),
    );
  }
});

test("multiple RobotAction property sets on one task are rejected", () => {
  const api = new FakeReaderApi();
  const fixture = addMission(api);
  addPropertySet(api, fixture.taskExpressIds[0], 205, 206, "RobotAction", {
    ActionType: "NAVIGATE_TO",
  });
  const result = read(api);
  assert.equal(result.missions.length, 0);
  assert.ok(
    result.issues.some((entry) => entry.code === "IFC_PROPERTY_SET_AMBIGUOUS"),
  );
});

test("sequence direction and supported non-default type are preserved", () => {
  const api = new FakeReaderApi();
  addMission(api);
  api.lines.get(170)!.SequenceType = value("START_START");
  const [sequence] = read(api).missions[0].sequences;
  assert.deepEqual(sequence, {
    id: "sequence/task-a-0/task-b-0/START_START",
    predecessorTaskId: "task-a-0",
    successorTaskId: "task-b-0",
    sequenceType: "START_START",
  });
});

test("malformed viewpoint coordinates block reconstruction", () => {
  const api = new FakeReaderApi();
  addMission(api);
  const cameraPropertyId = (
    api.lines.get(100)!.HasProperties as Array<{ value: number }>
  )[2].value;
  api.lines.get(cameraPropertyId)!.ListValues = [value(1), value(2)];
  const result = read(api);
  assert.equal(result.missions.length, 0);
  assert.ok(
    result.issues.some((entry) => entry.code === "IFC_COORDINATES_MALFORMED"),
  );
});

test("a malformed mission does not corrupt an independent valid mission", () => {
  const api = new FakeReaderApi();
  addMission(api, 0);
  addMission(api, 300);
  api.remove(90);
  const result = read(api);
  assert.deepEqual(
    result.missions.map((mission) => mission.id),
    ["mission-300"],
  );
  assert.ok(
    result.issues.some(
      (entry) => entry.missionId === "mission-0" && entry.severity === "error",
    ),
  );
});
