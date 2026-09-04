import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBracketRankingAwardSyncPlan,
  buildEventRankingAwardSnapshot,
  getTeamPlacementPointPolicy,
} from "../src/services/bracketRankingAwardSnapshot.js";
import {
  buildBracketResultSyncPlan,
  buildEventBracketResultSnapshot,
} from "../src/services/bracketResultSnapshot.js";
import { buildDeltasFromRound, revertBracketRecord } from "../src/services/recordSync.js";

const runtimeSource = "legacy_bracket_runtime";

const teamParticipants = ["a", "b", "c", "d"].map(id => ({
  id: `team-${id}`,
  name: `Team ${id.toUpperCase()}`,
  members: [`${id}-1`, `${id}-2`],
  entryId: `entry-${id}`,
  memberIdentities: [
    {
      name: `${id}-1`,
      memberOrder: 1,
      registrationId: `registration-${id}-1`,
      playerId: `player-${id}-1`,
      entryParticipantId: `entry-participant-${id}-1`,
    },
    {
      name: `${id}-2`,
      memberOrder: 2,
      registrationId: `registration-${id}-2`,
      playerId: `player-${id}-2`,
      entryParticipantId: `entry-participant-${id}-2`,
    },
  ],
}));

const teamBracket = {
  id: "team-bracket-1",
  eventId: "team-event-1",
  mode: "team",
  participants: teamParticipants,
};

const teamEvent = {
  event_type: "pokecup",
  division: "master",
  is_team_event: true,
  competition_settings: { rankingEnabled: true },
};

function resultRows(result) {
  return buildEventBracketResultSnapshot(teamBracket, result).rows.map(row => ({
    id: `result-${row.entry_id}`,
    source: runtimeSource,
    ...row,
  }));
}

function entryParticipantsFor(results) {
  return results.flatMap(result => {
    const team = teamParticipants.find(participant => participant.entryId === result.entry_id);
    return team.memberIdentities.map(member => ({
      id: member.entryParticipantId,
      entry_id: result.entry_id,
      player_id: member.playerId,
    }));
  });
}

function awardRows(resultRowsForEvent) {
  return buildEventRankingAwardSnapshot(
    teamEvent,
    resultRowsForEvent,
    entryParticipantsFor(resultRowsForEvent)
  ).rows;
}

const initialResultRows = resultRows({
  champ: "team-a",
  ru: "team-b",
  sf: ["team-c", "team-d"],
  done: true,
});
const initialAwardRows = awardRows(initialResultRows);

test("legacy team deltas use fixed points per member and no semifinalist points", () => {
  const deltas = buildDeltasFromRound({
    team: true,
    winMembers: ["champ-1", "champ-2", "champ-3", "champ-4"],
    ruMembers: ["runner-1", "runner-2", "runner-3", "runner-4"],
    sfMembers: [["semi-1", "semi-2", "semi-3", "semi-4"]],
  });

  assert.deepEqual(
    Object.fromEntries(Object.entries(deltas).map(([name, delta]) => [name, delta.points])),
    {
      "champ-1": 30,
      "champ-2": 30,
      "champ-3": 30,
      "champ-4": 30,
      "runner-1": 20,
      "runner-2": 20,
      "runner-3": 20,
      "runner-4": 20,
    }
  );
  assert.ok(Object.values(deltas).every(delta =>
    delta.win === 0 && delta.ru === 0 && delta.top4 === 0
  ));

  const lightPolicy = getTeamPlacementPointPolicy({
    event_type: "pokecup",
    division: "light",
    is_team_event: true,
    competition_settings: { rankingEnabled: true },
  });
  const lightDeltas = buildDeltasFromRound({
    team: true,
    winMembers: ["light-champ-1", "light-champ-2"],
    ruMembers: ["light-runner-1", "light-runner-2"],
  }, { pointConfig: lightPolicy.points });

  assert.deepEqual(
    Object.fromEntries(Object.entries(lightDeltas).map(([name, delta]) => [name, delta.points])),
    {
      "light-champ-1": 15,
      "light-champ-2": 15,
      "light-runner-1": 10,
      "light-runner-2": 10,
    }
  );
});

test("team apply creates one Result per Team Entry and member Awards", () => {
  const resultPlan = buildBracketResultSyncPlan([], initialResultRows);
  const awardPlan = buildBracketRankingAwardSyncPlan([], initialAwardRows);

  assert.equal(resultPlan.inserts.length, 4);
  assert.equal(awardPlan.inserts.length, 4);
  assert.deepEqual(
    [...new Set(awardPlan.inserts.map(row => row.result_id))],
    initialResultRows.slice(0, 2).map(row => row.id)
  );
  assert.ok(awardPlan.inserts.every(row =>
    row.win_delta === 0 &&
    row.runner_up_delta === 0 &&
    row.top4_delta === 0
  ));
});

test("revert removes runtime RankingAwards before runtime Results", () => {
  const awardPlan = buildBracketRankingAwardSyncPlan(
    initialAwardRows.map((row, index) => ({ ...row, id: `award-${index + 1}`, source: runtimeSource })),
    []
  );
  const resultPlan = buildBracketResultSyncPlan(initialResultRows, []);

  assert.equal(awardPlan.deleteIds.length, 4);
  assert.equal(resultPlan.deleteIds.length, 4);
  assert.deepEqual(
    ["ranking_award", "result"].filter(kind => kind),
    ["ranking_award", "result"]
  );
});

test("revert preserves Team Entry and member identity on the bracket", () => {
  const data = {
    tournaments: [{
      key: "master",
      rounds: [{ id: "round-1", recordMeta: {
        source: "bracket",
        willRank: true,
        willSeason: true,
        rankKey: "master",
        season: "YPL 시즌 3",
        deltas: {
          "a-1": { win: 0, ru: 0, top4: 0, points: 15 },
          "a-2": { win: 0, ru: 0, top4: 0, points: 15 },
        },
      } }],
    }],
    rankings: [{ key: "master", rows: [
      { name: "a-1", points: 15 },
      { name: "a-2", points: 15 },
    ] }],
    seasons: [{ name: "YPL 시즌 3", rows: [
      { name: "a-1", points: 15 },
      { name: "a-2", points: 15 },
    ] }],
    brackets: [{
      ...teamBracket,
      status: "done",
      applied: {
        tournamentKey: "master",
        roundId: "round-1",
        recordMeta: {
          source: "bracket",
          willRank: true,
          willSeason: true,
          rankKey: "master",
          season: "YPL 시즌 3",
          deltas: {
            "a-1": { win: 0, ru: 0, top4: 0, points: 15 },
            "a-2": { win: 0, ru: 0, top4: 0, points: 15 },
          },
        },
      },
    }],
  };

  const reverted = revertBracketRecord(data, teamBracket.id);
  const bracket = reverted.data.brackets[0];
  assert.equal(bracket.applied, null);
  assert.equal(bracket.status, "active");
  assert.deepEqual(
    bracket.participants.map(participant => ({
      entryId: participant.entryId,
      memberIdentities: participant.memberIdentities,
    })),
    teamParticipants.map(participant => ({
      entryId: participant.entryId,
      memberIdentities: participant.memberIdentities,
    }))
  );
});

test("apply, revert, changed result, and reapply produce no duplicate runtime rows", () => {
  const changedResultRows = resultRows({
    champ: "team-b",
    ru: "team-a",
    sf: ["team-c", "team-d"],
    done: true,
  });
  const changedAwardRows = awardRows(changedResultRows);
  const changedAwardRuntimeRows = changedAwardRows.map((row, index) => ({
    ...row,
    id: `changed-award-${index + 1}`,
    source: runtimeSource,
  }));

  const afterRevertResults = buildBracketResultSyncPlan(initialResultRows, []);
  const afterRevertAwards = buildBracketRankingAwardSyncPlan(
    initialAwardRows.map((row, index) => ({ ...row, id: `award-${index + 1}`, source: runtimeSource })),
    []
  );
  assert.equal(afterRevertResults.deleteIds.length, 4);
  assert.equal(afterRevertAwards.deleteIds.length, 4);

  const reapplyResults = buildBracketResultSyncPlan([], changedResultRows);
  const reapplyAwards = buildBracketRankingAwardSyncPlan([], changedAwardRows);
  assert.equal(reapplyResults.inserts.length, 4);
  assert.equal(reapplyAwards.inserts.length, 4);
  assert.deepEqual(buildBracketResultSyncPlan(changedResultRows, changedResultRows), {
    inserts: [],
    updates: [],
    deleteIds: [],
  });
  assert.deepEqual(buildBracketRankingAwardSyncPlan(changedAwardRuntimeRows, changedAwardRows), {
    inserts: [],
    updates: [],
    deleteIds: [],
  });
});

test("stale team placement Result and Award rows are cleaned", () => {
  const shorterResultRows = resultRows({
    champ: "team-a",
    ru: "team-b",
    sf: [],
    done: true,
  });
  const existingResults = initialResultRows;
  const existingAwards = initialAwardRows.map((row, index) => ({
    ...row,
    id: `award-${index + 1}`,
    source: runtimeSource,
  }));
  const resultPlan = buildBracketResultSyncPlan(existingResults, shorterResultRows);
  const awardPlan = buildBracketRankingAwardSyncPlan(existingAwards, awardRows(shorterResultRows));

  assert.deepEqual(resultPlan.deleteIds, ["result-entry-c", "result-entry-d"]);
  assert.deepEqual(awardPlan.deleteIds, []);
});

test("failed changed Award sync can restore the previous Result and Award snapshots", () => {
  const changedResultRows = resultRows({
    champ: "team-b",
    ru: "team-a",
    sf: ["team-c", "team-d"],
    done: true,
  });
  const changedAwardRows = awardRows(changedResultRows);
  const changedAwardRuntimeRows = changedAwardRows.map((row, index) => ({
    ...row,
    id: `changed-award-${index + 1}`,
    source: runtimeSource,
  }));
  const restoreResults = buildBracketResultSyncPlan(changedResultRows, initialResultRows);
  const restoreAwards = buildBracketRankingAwardSyncPlan(changedAwardRuntimeRows, initialAwardRows);

  assert.deepEqual(restoreResults.updates.map(update => update.id), [
    "result-entry-a",
    "result-entry-b",
  ]);
  assert.equal(restoreAwards.updates.length, 4);
  assert.equal(restoreResults.inserts.length, 0);
  assert.equal(restoreAwards.inserts.length, 0);
});
