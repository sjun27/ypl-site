import assert from "node:assert/strict";
import test from "node:test";

import {
  bracketResultIdentityState,
  buildBracketResultSyncPlan,
  buildEventBracketResultSnapshot,
} from "../src/services/bracketResultSnapshot.js";

const participants = ["a", "b", "c", "d"].map(id => ({
  id,
  name: id.toUpperCase(),
  entryId: `entry-${id}`,
}));

const bracket = {
  id: "bracket-1",
  eventId: "event-1",
  mode: "single",
  participants,
};

const teamParticipants = ["a", "b", "c", "d"].map(id => ({
  id: `team-${id}`,
  name: `Team ${id.toUpperCase()}`,
  members: [`${id}-1`, `${id}-2`],
  entryId: `team-entry-${id}`,
  memberIdentities: [
    { name: `${id}-1`, memberOrder: 1, playerId: `${id}-player-1` },
    { name: `${id}-2`, memberOrder: 2, playerId: `${id}-player-2` },
  ],
}));

const teamBracket = {
  id: "team-bracket-1",
  eventId: "team-event-1",
  mode: "team",
  participants: teamParticipants,
};

test("maps champion, runner-up, and actual semifinalists by Entry ID", () => {
  const snapshot = buildEventBracketResultSnapshot(bracket, {
    champ: "a",
    ru: "d",
    sf: ["b", "c"],
    done: true,
  });

  assert.equal(snapshot.skipped, false);
  assert.deepEqual(snapshot.rows, [
    { entry_id: "entry-a", placement_code: "champion", rank_min: 1, rank_max: 1, placement_label: "우승" },
    { entry_id: "entry-d", placement_code: "runner_up", rank_min: 2, rank_max: 2, placement_label: "준우승" },
    { entry_id: "entry-b", placement_code: "semifinalist", rank_min: 3, rank_max: 4, placement_label: "4강" },
    { entry_id: "entry-c", placement_code: "semifinalist", rank_min: 3, rank_max: 4, placement_label: "4강" },
  ]);
});

test("maps team placements to one Team Entry Result per team, never per player", () => {
  const snapshot = buildEventBracketResultSnapshot(teamBracket, {
    champ: "team-a",
    ru: "team-d",
    sf: ["team-b", "team-c"],
    done: true,
  });

  assert.equal(bracketResultIdentityState(teamBracket).eligible, true);
  assert.deepEqual(snapshot.rows, [
    { entry_id: "team-entry-a", placement_code: "champion", rank_min: 1, rank_max: 1, placement_label: "우승" },
    { entry_id: "team-entry-d", placement_code: "runner_up", rank_min: 2, rank_max: 2, placement_label: "준우승" },
    { entry_id: "team-entry-b", placement_code: "semifinalist", rank_min: 3, rank_max: 4, placement_label: "4강" },
    { entry_id: "team-entry-c", placement_code: "semifinalist", rank_min: 3, rank_max: 4, placement_label: "4강" },
  ]);
  assert.equal(snapshot.rows.length, 4);
  assert.ok(snapshot.rows.every(row => !("player_id" in row)));
});

test("team runtime Result rows are idempotent and update in place when placement changes", () => {
  const initialRows = buildEventBracketResultSnapshot(teamBracket, {
    champ: "team-a",
    ru: "team-d",
    sf: ["team-b", "team-c"],
    done: true,
  }).rows;
  const existing = initialRows.map(row => ({
    ...row,
    id: `result-${row.entry_id}`,
    source: "legacy_bracket_runtime",
  }));

  assert.deepEqual(
    buildBracketResultSyncPlan(existing, initialRows),
    { inserts: [], updates: [], deleteIds: [] }
  );

  const changedRows = buildEventBracketResultSnapshot(teamBracket, {
    champ: "team-d",
    ru: "team-a",
    sf: ["team-b", "team-c"],
    done: true,
  }).rows;
  const changedPlan = buildBracketResultSyncPlan(existing, changedRows);
  assert.deepEqual(changedPlan.updates.map(update => update.id), [
    "result-team-entry-d",
    "result-team-entry-a",
  ]);
  assert.deepEqual(changedPlan.inserts, []);
  assert.deepEqual(changedPlan.deleteIds, []);
});

test("team stale runtime Results are cleaned while historical Results remain protected", () => {
  const existing = [
    { id: "runtime-team-a", entry_id: "team-entry-a", placement_code: "champion", rank_min: 1, rank_max: 1, placement_label: "우승", source: "legacy_bracket_runtime" },
    { id: "runtime-team-d", entry_id: "team-entry-d", placement_code: "runner_up", rank_min: 2, rank_max: 2, placement_label: "준우승", source: "legacy_bracket_runtime" },
    { id: "historical-team-x", entry_id: "team-entry-x", placement_code: "champion", rank_min: 1, rank_max: 1, placement_label: "우승", source: "legacy_tournament" },
  ];
  const plan = buildBracketResultSyncPlan(existing, [{
    entry_id: "team-entry-a",
    placement_code: "champion",
    rank_min: 1,
    rank_max: 1,
    placement_label: "우승",
  }]);

  assert.deepEqual(plan.deleteIds, ["runtime-team-d"]);
  assert.ok(!plan.deleteIds.includes("historical-team-x"));
  assert.throws(
    () => buildBracketResultSyncPlan(existing, [{
      entry_id: "team-entry-x",
      placement_code: "champion",
      rank_min: 1,
      rank_max: 1,
      placement_label: "우승",
    }]),
    /덮어쓸 수 없습니다/
  );
});

test("creates only placements that actually exist", () => {
  const snapshot = buildEventBracketResultSnapshot(bracket, {
    champ: "a",
    ru: "b",
    sf: [],
    done: true,
  });

  assert.deepEqual(snapshot.rows.map(row => row.placement_code), ["champion", "runner_up"]);
});

test("rejects duplicate Entry identities in participants and placements", () => {
  const duplicateParticipants = {
    ...bracket,
    participants: [participants[0], { ...participants[1], entryId: "entry-a" }],
  };
  assert.throws(
    () => bracketResultIdentityState(duplicateParticipants),
    /동일한 Entry identity/
  );

  assert.throws(
    () => buildEventBracketResultSnapshot(bracket, { champ: "a", ru: "a", sf: [], done: true }),
    /입상 결과에 Entry 'entry-a'가 중복/
  );
});

test("rejects a partially Entry-linked bracket", () => {
  const partial = {
    ...bracket,
    participants: [participants[0], { id: "b", name: "B" }],
  };
  assert.throws(
    () => bracketResultIdentityState(partial),
    /일부 참가자에게만 Entry identity/
  );
});

test("rejects a placement participant without a matching Entry identity", () => {
  assert.throws(
    () => buildEventBracketResultSnapshot(bracket, { champ: "missing", ru: "b", sf: [], done: true }),
    /Entry identity를 찾을 수 없습니다/
  );
});

test("skips legacy-only brackets and accepts complete team Entry identity", () => {
  assert.deepEqual(
    bracketResultIdentityState({ ...bracket, eventId: null }),
    { eligible: false, reason: "event_unlinked" }
  );
  assert.deepEqual(
    bracketResultIdentityState({ ...bracket, participants: participants.map(({ entryId: _entryId, ...row }) => row) }),
    { eligible: false, reason: "legacy_bracket" }
  );
  assert.deepEqual(
    bracketResultIdentityState({
      ...teamBracket,
      participants: teamParticipants.map(({ entryId: _entryId, ...row }) => row),
    }),
    { eligible: false, reason: "legacy_bracket" }
  );
  assert.equal(bracketResultIdentityState(teamBracket).eligible, true);
});

test("rejects a partially Entry-linked team bracket", () => {
  const partial = {
    ...teamBracket,
    participants: [teamParticipants[0], { ...teamParticipants[1], entryId: undefined }],
  };
  assert.throws(
    () => bracketResultIdentityState(partial),
    /일부 참가자에게만 Entry identity/
  );
});

test("rejects duplicate Team Entry identity", () => {
  const duplicate = {
    ...teamBracket,
    participants: [teamParticipants[0], { ...teamParticipants[1], entryId: teamParticipants[0].entryId }],
  };
  assert.throws(
    () => bracketResultIdentityState(duplicate),
    /동일한 Entry identity/
  );
});

test("updates changed placements and keeps unchanged Result row IDs", () => {
  const existing = [
    { id: "result-a", entry_id: "entry-a", placement_code: "champion", rank_min: 1, rank_max: 1, placement_label: "우승", source: "legacy_bracket_runtime" },
    { id: "result-d", entry_id: "entry-d", placement_code: "runner_up", rank_min: 2, rank_max: 2, placement_label: "준우승", source: "legacy_bracket_runtime" },
  ];
  const desired = [
    { entry_id: "entry-a", placement_code: "runner_up", rank_min: 2, rank_max: 2, placement_label: "준우승" },
    { entry_id: "entry-d", placement_code: "champion", rank_min: 1, rank_max: 1, placement_label: "우승" },
  ];

  const plan = buildBracketResultSyncPlan(existing, desired);
  assert.equal(plan.inserts.length, 0);
  assert.deepEqual(plan.deleteIds, []);
  assert.deepEqual(plan.updates.map(update => update.id), ["result-a", "result-d"]);
});

test("is idempotent when the runtime Result snapshot is unchanged", () => {
  const existing = [{
    id: "result-a",
    entry_id: "entry-a",
    placement_code: "champion",
    rank_min: 1,
    rank_max: 1,
    placement_label: "우승",
    source: "legacy_bracket_runtime",
  }];
  const desired = [{
    entry_id: "entry-a",
    placement_code: "champion",
    rank_min: 1,
    rank_max: 1,
    placement_label: "우승",
  }];

  assert.deepEqual(
    buildBracketResultSyncPlan(existing, desired),
    { inserts: [], updates: [], deleteIds: [] }
  );
});

test("removes stale runtime rows without touching historical Result", () => {
  const existing = [
    { id: "runtime-a", entry_id: "entry-a", placement_code: "champion", rank_min: 1, rank_max: 1, placement_label: "우승", source: "legacy_bracket_runtime" },
    { id: "runtime-b", entry_id: "entry-b", placement_code: "runner_up", rank_min: 2, rank_max: 2, placement_label: "준우승", source: "legacy_bracket_runtime" },
    { id: "historical-c", entry_id: "entry-c", placement_code: "semifinalist", rank_min: 3, rank_max: 4, placement_label: "4강", source: "legacy_tournament" },
  ];

  const plan = buildBracketResultSyncPlan(existing, [
    { entry_id: "entry-a", placement_code: "champion", rank_min: 1, rank_max: 1, placement_label: "우승" },
  ]);
  assert.deepEqual(plan.deleteIds, ["runtime-b"]);
  assert.ok(!plan.deleteIds.includes("historical-c"));
});

test("blocks a desired Entry that already has a non-runtime Result", () => {
  const existing = [{
    id: "historical-a",
    entry_id: "entry-a",
    placement_code: "champion",
    rank_min: 1,
    rank_max: 1,
    placement_label: "우승",
    source: "legacy_tournament",
  }];

  assert.throws(
    () => buildBracketResultSyncPlan(existing, [{
      entry_id: "entry-a",
      placement_code: "champion",
      rank_min: 1,
      rank_max: 1,
      placement_label: "우승",
    }]),
    /덮어쓸 수 없습니다/
  );
});
