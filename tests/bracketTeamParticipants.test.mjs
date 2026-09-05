import assert from "node:assert/strict";
import test from "node:test";

import {
  attachConfirmedTeamIdentities,
  buildDefaultTeamMatchLineups,
  buildTeamMatchSeries,
  buildTeamMemberCandidates,
  getApplicationEventDivisionOptions,
  getApplicationEventTypeLabel,
  getConfirmedTeamMemberIdentities,
  normalizeApplicationEventDivision,
  getTeamRegistrationAnswerEntries,
} from "../src/services/bracketTeamParticipants.js";

test("team registration answers keep the current registration_data.answers keys", () => {
  const registration = {
    registration_data: {
      answers: {
        field_second: "B팀",
        field_first: "A팀",
        field_third: ["C팀", "D팀"],
      },
    },
  };
  const fields = [
    { id: "field_first", label: "1지망" },
    { id: "field_second", label: "2지망" },
  ];

  assert.deepEqual(getTeamRegistrationAnswerEntries(registration, fields), [
    { key: "field_first", label: "1지망", value: "A팀" },
    { key: "field_second", label: "2지망", value: "B팀" },
    { key: "field_third", label: "field_third", value: "C팀, D팀" },
  ]);
});

test("team members are flattened without changing the legacy team participant shape", () => {
  const source = [
    { id: "team-a", name: " A팀 ", members: [" 가 ", "나"] },
    { id: "team-b", name: "B팀", members: ["다"] },
  ];

  const result = buildTeamMemberCandidates(source);

  assert.deepEqual(result.teams.map(team => [team.id, team.name, team.members]), [
    ["team-a", "A팀", ["가", "나"]],
    ["team-b", "B팀", ["다"]],
  ]);
  assert.deepEqual(result.members.map(member => [member.id, member.teamParticipantId, member.memberOrder, member.name]), [
    ["team-a:member:1", "team-a", 1, "가"],
    ["team-a:member:2", "team-a", 2, "나"],
    ["team-b:member:1", "team-b", 1, "다"],
  ]);
  assert.deepEqual(result.members.map(member => member.role), ["captain", null, "captain"]);
});

test("team confirmation adds one team Entry and member-level identities", () => {
  const teams = [{ id: "team-a", name: "A팀", members: ["가", "나"] }];
  const resolved = [
    {
      teamParticipantId: "team-a",
      name: "가",
      memberOrder: 1,
      entryId: "entry-a",
      registrationId: "reg-a",
      playerId: "player-a",
      entryParticipantId: "ep-a",
    },
    {
      teamParticipantId: "team-a",
      name: "나",
      memberOrder: 2,
      entryId: "entry-a",
      registrationId: "reg-b",
      playerId: "player-b",
      entryParticipantId: "ep-b",
    },
  ];

  assert.deepEqual(attachConfirmedTeamIdentities(teams, resolved), [{
    id: "team-a",
    name: "A팀",
    members: ["가", "나"],
    entryId: "entry-a",
    memberIdentities: [
      { name: "가", memberOrder: 1, role: "captain", registrationId: "reg-a", playerId: "player-a", entryParticipantId: "ep-a" },
      { name: "나", memberOrder: 2, role: null, registrationId: "reg-b", playerId: "player-b", entryParticipantId: "ep-b" },
    ],
  }]);
});

test("team confirmation rejects a team without members", () => {
  assert.throws(
    () => buildTeamMemberCandidates([{ id: "team-a", name: "A팀", members: [] }]),
    /참가 선수가 없습니다/,
  );
});

test("confirmed member order has exactly one captain at member_order 1", () => {
  const team = {
    name: "A팀",
    memberIdentities: [
      { name: "나", memberOrder: 2, role: null, playerId: "player-b" },
      { name: "가", memberOrder: 1, role: "captain", playerId: "player-a" },
    ],
  };

  assert.deepEqual(
    getConfirmedTeamMemberIdentities(team).map(member => [member.name, member.memberOrder, member.role]),
    [["가", 1, "captain"], ["나", 2, null]]
  );

  assert.throws(
    () => getConfirmedTeamMemberIdentities({
      ...team,
      memberIdentities: team.memberIdentities.map(member => ({ ...member, role: "captain" })),
    }),
    /captain 역할이 중복/
  );
});

function confirmedTeam(name, memberNames) {
  return {
    name,
    members: memberNames,
    memberIdentities: memberNames.map((memberName, index) => ({
      name: memberName,
      memberOrder: index + 1,
      role: index === 0 ? "captain" : null,
      playerId: `${name}-${memberName}`,
    })),
  };
}

test("default team Match lineup uses max roster size and leaves smaller-team extras unresolved", () => {
  const fourA = confirmedTeam("A", ["A1", "A2", "A3", "A4"]);
  const fourB = confirmedTeam("B", ["B1", "B2", "B3", "B4"]);
  assert.deepEqual(buildDefaultTeamMatchLineups(fourA, fourB), {
    normalBoutCount: 4,
    lineupA: ["A1", "A2", "A3", "A4"],
    lineupB: ["B1", "B2", "B3", "B4"],
    captainA: "A1",
    captainB: "B1",
  });

  const fiveA = confirmedTeam("A", ["A1", "A2", "A3", "A4", "A5"]);
  assert.deepEqual(buildDefaultTeamMatchLineups(fiveA, fourB), {
    normalBoutCount: 5,
    lineupA: ["A1", "A2", "A3", "A4", "A5"],
    lineupB: ["B1", "B2", "B3", "B4", null],
    captainA: "A1",
    captainB: "B1",
  });
});

test("actual lineup supports substitutions and duplicate appearances without changing canonical order", () => {
  const teamA = confirmedTeam("A", ["A1", "A2", "A3", "A4", "A5"]);
  const teamB = confirmedTeam("B", ["B1", "B2", "B3", "B4"]);
  const canonicalBefore = teamA.memberIdentities.map(member => ({ ...member }));
  const result = buildTeamMatchSeries(teamA, teamB, {
    lineupA: ["A2", "A2", "A3", "A4", "A5"],
    lineupB: ["B1", "B2", "B3", "B4", "B2"],
    games: ["a", "b", "a", "b", "a"],
  });

  assert.equal(result.winnerSide, "a");
  assert.deepEqual(result.series.lineupA, ["A2", "A2", "A3", "A4", "A5"]);
  assert.deepEqual(result.series.lineupB, ["B1", "B2", "B3", "B4", "B2"]);
  assert.equal(result.series.ace, null);
  assert.deepEqual(teamA.memberIdentities, canonicalBefore);
});

test("tied normal bouts default Ace candidates to captains but persist editable actual Ace players", () => {
  const teamA = confirmedTeam("1팀", ["A", "B", "E", "F"]);
  const teamB = confirmedTeam("2팀", ["C", "D", "G", "H"]);

  const defaults = buildDefaultTeamMatchLineups(teamA, teamB);
  assert.deepEqual([defaults.captainA, defaults.captainB], ["A", "C"]);

  const tied = buildTeamMatchSeries(teamA, teamB, {
    lineupA: ["A", "B", "E", "F"],
    lineupB: ["C", "D", "G", "H"],
    games: ["a", "b", "a", "b"],
    ace: { a: "B", b: "D", winner: "b" },
  });
  assert.deepEqual(tied, {
    winnerSide: "b",
    series: {
      lineupA: ["A", "B", "E", "F"],
      lineupB: ["C", "D", "G", "H"],
      games: ["a", "b", "a", "b"],
      ace: { a: "B", b: "D", winner: "b" },
    },
  });

  const notTied = buildTeamMatchSeries(teamA, teamB, {
    lineupA: ["A", "B", "E", "F"],
    lineupB: ["C", "D", "G", "H"],
    games: ["a", "a", "a", "b"],
    ace: { a: "B", b: "D", winner: "b" },
  });
  assert.equal(notTied.winnerSide, "a");
  assert.equal(notTied.series.ace, null);
});

test("application Event division choices separate team structure from classification", () => {
  assert.deepEqual(getApplicationEventDivisionOptions(false), ["rookie", "master", "light"]);
  assert.deepEqual(getApplicationEventDivisionOptions(true), ["master", "light"]);
  assert.ok(!getApplicationEventDivisionOptions(false).includes("none"));
  assert.ok(!getApplicationEventDivisionOptions(true).includes(""));

  assert.equal(normalizeApplicationEventDivision(null, true), "master");
  assert.equal(normalizeApplicationEventDivision("rookie", true), "master");
  assert.equal(normalizeApplicationEventDivision("light", true), "light");
  assert.equal(normalizeApplicationEventDivision(null, false), "master");
  assert.equal(
    normalizeApplicationEventDivision(null, true, { preserveLegacy: true }),
    null
  );
});

test("application Event type labels do not repeat division while stored axes remain separate", () => {
  assert.equal(getApplicationEventTypeLabel("pokecup"), "파이컵");
  assert.equal(getApplicationEventTypeLabel("light"), "파이컵");
  assert.equal(getApplicationEventTypeLabel("champions"), "챔피언스");
  const event = { event_type: "light", division: "light", is_team_event: false };
  assert.equal(event.event_type, "light");
  assert.equal(event.division, "light");
});
