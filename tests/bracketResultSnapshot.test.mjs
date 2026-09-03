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

test("skips legacy-only, pre-Entry, and team brackets", () => {
  assert.deepEqual(
    bracketResultIdentityState({ ...bracket, eventId: null }),
    { eligible: false, reason: "event_unlinked" }
  );
  assert.deepEqual(
    bracketResultIdentityState({ ...bracket, participants: participants.map(({ entryId: _entryId, ...row }) => row) }),
    { eligible: false, reason: "legacy_bracket" }
  );
  assert.deepEqual(
    bracketResultIdentityState({ ...bracket, mode: "team" }),
    { eligible: false, reason: "team_event" }
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
