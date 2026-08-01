import assert from "node:assert/strict";
import test from "node:test";
import { importRobotMissions } from "../../src/application/robot-tasks";
import { createRobotMission } from "../../src/domain/robot-tasks";
import { InMemoryRobotMissionRepository } from "../../src/persistence/robot-tasks";

test("bulk import preserves unrelated missions, replaces matching IDs and imported timestamps", () => {
  const repository = new InMemoryRobotMissionRepository();
  repository.save(
    createRobotMission(
      { id: "unrelated", name: "Keep" },
      "2020-01-01T00:00:00Z",
    ),
  );
  repository.save(
    createRobotMission({ id: "replace", name: "Old" }, "2021-01-01T00:00:00Z"),
  );
  const imported = createRobotMission(
    {
      id: "replace",
      name: "Imported",
      createdAt: "2018-01-01T00:00:00Z",
    },
    "2030-01-01T00:00:00Z",
  );
  const added = createRobotMission(
    { id: "new", name: "New" },
    "2019-01-01T00:00:00Z",
  );

  assert.deepEqual(importRobotMissions(repository, [imported, added]), {
    importedCount: 1,
    replacedCount: 1,
  });
  assert.equal(repository.get("replace")?.createdAt, "2018-01-01T00:00:00Z");
  assert.equal(repository.get("unrelated")?.name, "Keep");
  assert.equal(repository.list().length, 3);
});

test("bulk import rejects duplicate IDs before changing the repository", () => {
  const repository = new InMemoryRobotMissionRepository();
  const duplicate = createRobotMission(
    { id: "same", name: "Same" },
    "2026-01-01T00:00:00Z",
  );
  assert.throws(
    () => importRobotMissions(repository, [duplicate, duplicate]),
    /duplicate mission id/i,
  );
  assert.equal(repository.list().length, 0);
});
