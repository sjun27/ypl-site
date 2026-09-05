import assert from "node:assert/strict";
import test from "node:test";

import {
  executeBracketDeletionLifecycle,
  getExpectedBracketParticipantCount,
  isInterruptedBracketCleanupState,
  preserveBracketLifecycleMetadata,
  validateBracketParticipantConfirmation,
} from "../src/services/bracketLifecycle.js";

const individual = {
  id: "bracket-1",
  eventId: "event-1",
  mode: "single",
  participants: [{
    id: "participant-1",
    name: "Alice",
    registrationId: "registration-1",
    playerId: "player-1",
    entryId: "entry-1",
    entryParticipantId: "entry-participant-1",
  }],
  participantConfirmation: {
    eventId: "event-1",
    previousEventStatus: "open",
    confirmedAt: "2026-09-05T00:00:00.000Z",
    identityChanges: [{
      participantId: "participant-1",
      registrationId: "registration-1",
      playerId: "player-1",
      entryId: "entry-1",
      entryParticipantId: "entry-participant-1",
    }],
  },
};

test("bracket graph/party updates retain individual cleanup metadata", () => {
  const next = preserveBracketLifecycleMetadata(individual, {
    id: individual.id,
    participants: [{ id: "participant-1", name: "Alice", party: "Pikachu" }],
    participantConfirmation: undefined,
  });

  assert.equal(next.eventId, "event-1");
  assert.equal(next.participantConfirmation, individual.participantConfirmation);
  assert.equal(next.participants[0].entryId, "entry-1");
  assert.equal(next.participants[0].entryParticipantId, "entry-participant-1");
  assert.equal(next.participants[0].party, "Pikachu");
  assert.equal(validateBracketParticipantConfirmation(next).ok, true);
});

test("team updates retain team and member identity metadata", () => {
  const team = {
    id: "team-bracket-1",
    eventId: "event-team-1",
    mode: "team",
    participants: [{
      id: "team-1",
      name: "Team A",
      members: ["Alice", "Bob"],
      entryId: "team-entry-1",
      memberIdentities: [
        { name: "Alice", memberOrder: 1, registrationId: "r-1", playerId: "p-1", entryParticipantId: "ep-1" },
        { name: "Bob", memberOrder: 2, registrationId: "r-2", playerId: "p-2", entryParticipantId: "ep-2" },
      ],
    }],
    participantConfirmation: {
      eventId: "event-team-1",
      previousEventStatus: "running",
      identityChanges: [
        { participantId: "member-1", teamParticipantId: "team-1", memberOrder: 1, registrationId: "r-1", playerId: "p-1", entryId: "team-entry-1", entryParticipantId: "ep-1" },
        { participantId: "member-2", teamParticipantId: "team-1", memberOrder: 2, registrationId: "r-2", playerId: "p-2", entryId: "team-entry-1", entryParticipantId: "ep-2" },
      ],
    },
  };
  const next = preserveBracketLifecycleMetadata(team, {
    ...team,
    participants: [{ id: "team-1", name: "Team A", members: ["Alice", "Bob"], memberParties: { Alice: "Pikachu" } }],
    participantConfirmation: null,
  });

  assert.equal(next.participantConfirmation, team.participantConfirmation);
  assert.equal(next.participants[0].entryId, "team-entry-1");
  assert.deepEqual(next.participants[0].memberIdentities, team.participants[0].memberIdentities);
  assert.equal(validateBracketParticipantConfirmation(next).ok, true);
});

test("missing or incomplete confirmation is not a safe deletion basis", () => {
  assert.equal(validateBracketParticipantConfirmation({ ...individual, participantConfirmation: undefined }).ok, false);
  assert.equal(validateBracketParticipantConfirmation({
    ...individual,
    participantConfirmation: {
      ...individual.participantConfirmation,
      identityChanges: [{ participantId: "participant-1", entryId: "entry-1" }],
    },
  }).ok, false);
});

test("only an entirely empty normalized identity state qualifies for interrupted cleanup", () => {
  assert.equal(isInterruptedBracketCleanupState(), true);
  assert.equal(isInterruptedBracketCleanupState({ matchRows: [], entries: [], entryParticipants: [] }), true);
  assert.equal(isInterruptedBracketCleanupState({ matchRows: [], entries: [{ id: "entry-1" }], entryParticipants: [] }), false);
  assert.equal(isInterruptedBracketCleanupState({ matchRows: [{ id: "match-1" }], entries: [], entryParticipants: [] }), false);
});

function deletionSnapshot(overrides = {}) {
  return {
    event: { id: "event-1", status: "running" },
    previousEventStatus: "open",
    matchRows: [{ id: "match-1" }],
    entries: [{ id: "entry-1" }],
    entryParticipants: [{ id: "entry-participant-1" }],
    identityChanges: individual.participantConfirmation.identityChanges,
    ...overrides,
  };
}

test("successful deletion keeps all writes after the read-only preflight", async () => {
  const calls = [];
  const result = await executeBracketDeletionLifecycle({
    preflight: async () => { calls.push("preflight-read"); return deletionSnapshot(); },
    deleteMatches: async rows => { calls.push(`delete-match:${rows.length}`); return { previousRows: rows }; },
    rollbackParticipants: async () => calls.push("rollback-participants"),
    saveLegacy: async () => { calls.push("delete-legacy"); return true; },
    restoreEventStatus: async status => calls.push(`restore-status:${status}`),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    "preflight-read",
    "delete-match:1",
    "rollback-participants",
    "delete-legacy",
    "restore-status:open",
  ]);
});

test("metadata or ownership preflight failure is a complete no-op", async () => {
  const writes = [];
  const result = await executeBracketDeletionLifecycle({
    preflight: async () => {
      throw new Error("metadata count mismatch");
    },
    deleteMatches: async () => writes.push("match"),
    rollbackParticipants: async () => writes.push("identity"),
    saveLegacy: async () => writes.push("legacy"),
    restoreEventStatus: async () => writes.push("status"),
  });

  assert.equal(result.phase, "preflight");
  assert.equal(result.mutationStarted, false);
  assert.deepEqual(writes, []);
});

test("result or award preflight failure is also a complete no-op", async () => {
  for (const reason of ["Result exists", "RankingAward exists", "foreign Match ownership"]) {
    const writes = [];
    const result = await executeBracketDeletionLifecycle({
      preflight: async () => { throw new Error(reason); },
      saveLegacy: async () => writes.push("legacy"),
    });
    assert.equal(result.phase, "preflight");
    assert.deepEqual(writes, []);
  }
});

test("participant rollback failure restores the identity snapshot and Match", async () => {
  const calls = [];
  const result = await executeBracketDeletionLifecycle({
    preflight: async () => deletionSnapshot(),
    deleteMatches: async rows => { calls.push("delete-match"); return { previousRows: rows }; },
    rollbackParticipants: async () => { calls.push("rollback-participants"); throw new Error("rollback failed"); },
    restoreParticipants: async () => calls.push("restore-participants"),
    restoreMatches: async () => calls.push("restore-match"),
    saveLegacy: async () => { calls.push("delete-legacy"); return true; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.phase, "participant_rollback");
  assert.deepEqual(calls, ["delete-match", "rollback-participants", "restore-participants", "restore-match"]);
});

test("legacy save failure restores normalized state and never reports success", async () => {
  const calls = [];
  const result = await executeBracketDeletionLifecycle({
    preflight: async () => deletionSnapshot(),
    deleteMatches: async rows => { calls.push("delete-match"); return { previousRows: rows }; },
    rollbackParticipants: async () => calls.push("rollback-participants"),
    saveLegacy: async () => { calls.push("delete-legacy"); return false; },
    restoreLegacy: async () => calls.push("restore-legacy"),
    restoreParticipants: async () => calls.push("restore-participants"),
    restoreMatches: async () => calls.push("restore-match"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.phase, "legacy_save");
  assert.deepEqual(calls, [
    "delete-match",
    "rollback-participants",
    "delete-legacy",
    "restore-legacy",
    "restore-participants",
    "restore-match",
  ]);
});

test("Event status restore failure restores legacy and normalized snapshots", async () => {
  const calls = [];
  let statusAttempts = 0;
  const result = await executeBracketDeletionLifecycle({
    preflight: async () => deletionSnapshot(),
    deleteMatches: async rows => rows && { previousRows: rows },
    rollbackParticipants: async () => {},
    saveLegacy: async () => calls.push("delete-legacy") || true,
    restoreEventStatus: async () => {
      statusAttempts += 1;
      calls.push(`status-${statusAttempts}`);
      if (statusAttempts === 1) throw new Error("status write failed");
    },
    restoreLegacy: async () => calls.push("restore-legacy"),
    restoreParticipants: async () => calls.push("restore-participants"),
    restoreMatches: async () => calls.push("restore-match"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.phase, "event_status_restore");
  assert.deepEqual(calls, [
    "delete-legacy",
    "status-1",
    "restore-legacy",
    "restore-participants",
    "restore-match",
    "status-2",
  ]);
});

test("interrupted deletion finalizes only legacy cleanup and Event status", async () => {
  const calls = [];
  const result = await executeBracketDeletionLifecycle({
    preflight: async () => deletionSnapshot({ interrupted: true, matchRows: [], entries: [], entryParticipants: [] }),
    deleteMatches: async () => calls.push("delete-match"),
    rollbackParticipants: async () => calls.push("rollback-participants"),
    saveLegacy: async () => calls.push("delete-legacy") || true,
    restoreEventStatus: async () => calls.push("restore-status"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.phase, "interrupted_recovery");
  assert.deepEqual(calls, ["delete-legacy", "restore-status"]);
});

test("individual count and identity mismatch are rejected before deletion", () => {
  const two = {
    ...individual,
    participants: [individual.participants[0], { ...individual.participants[0], id: "participant-2" }],
  };
  assert.equal(getExpectedBracketParticipantCount(two), 2);
  assert.equal(validateBracketParticipantConfirmation(two).ok, false);
  assert.equal(validateBracketParticipantConfirmation({
    ...two,
    participantConfirmation: {
      ...individual.participantConfirmation,
      identityChanges: [
        ...individual.participantConfirmation.identityChanges,
        { ...individual.participantConfirmation.identityChanges[0], participantId: "participant-2" },
      ],
    },
  }).ok, false);
});
