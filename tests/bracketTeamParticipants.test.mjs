import assert from "node:assert/strict";
import test from "node:test";

import {
  attachConfirmedTeamIdentities,
  buildTeamMemberCandidates,
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
      { name: "가", memberOrder: 1, registrationId: "reg-a", playerId: "player-a", entryParticipantId: "ep-a" },
      { name: "나", memberOrder: 2, registrationId: "reg-b", playerId: "player-b", entryParticipantId: "ep-b" },
    ],
  }]);
});

test("team confirmation rejects a team without members", () => {
  assert.throws(
    () => buildTeamMemberCandidates([{ id: "team-a", name: "A팀", members: [] }]),
    /참가 선수가 없습니다/,
  );
});
