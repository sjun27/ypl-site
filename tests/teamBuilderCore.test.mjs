import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_SCHEMA_VERSION,
  TEAM_SCHEMA_VERSION,
  makeMember,
  memberFromSaved,
  membersRemovedByRuleChange,
  normalizeDraft,
  normalizeSavedTeam,
  resolveCanonicalPokemonIdentity,
  serializeMembers,
  toTeamSnapshotV1,
  fromTeamSnapshotV1,
  buildBracketSubmissionStatusModel,
  buildSubmissionStatusRows,
  selectSubmissionRegistration,
  validateSubmissionEligibility,
  validateTeam,
} from "../src/services/teamBuilderCore.js";

const regulation = {
  id: "test-reg",
  shortName: "TEST",
  maxTeamSize: 6,
  pokemon: [
    { id: "test-1", name: "Pikachu" },
    { id: "test-2", name: "Raichu" },
    { id: "test-3", name: "Raichu [Alolan Form]" },
    { id: "test-4", name: "Bulbasaur" },
    { id: "test-5", name: "Charmander" },
    { id: "test-6", name: "Squirtle" },
  ],
};

const detailData = {
  pokedex: {
    pikachu: { id: "pikachu", num: 25, name: "Pikachu", baseSpecies: "Pikachu", abilities: ["Static"], types: ["Electric"] },
    raichu: { id: "raichu", num: 26, name: "Raichu", baseSpecies: "Raichu", abilities: ["Static"], types: ["Electric"] },
    raichualola: { id: "raichualola", num: 26, name: "Raichu-Alola", baseSpecies: "Raichu", abilities: ["Surge Surfer"], types: ["Electric", "Psychic"] },
    bulbasaur: { id: "bulbasaur", num: 1, name: "Bulbasaur", baseSpecies: "Bulbasaur", abilities: ["Overgrow"], types: ["Grass", "Poison"] },
    charmander: { id: "charmander", num: 4, name: "Charmander", baseSpecies: "Charmander", abilities: ["Blaze"], types: ["Fire"] },
    squirtle: { id: "squirtle", num: 7, name: "Squirtle", baseSpecies: "Squirtle", abilities: ["Torrent"], types: ["Water"] },
    florgesyellow: { id: "florgesyellow", num: 671, name: "Florges-Yellow", baseSpecies: "Florges", abilities: ["Flower Veil"], types: ["Fairy"] },
  },
  learnsets: {
    pikachu: ["tackle"], raichu: ["tackle"], raichualola: ["tackle"], bulbasaur: ["tackle"], charmander: ["tackle"], squirtle: ["tackle"],
  },
  moves: { tackle: { id: "tackle", name: "Tackle", category: "Physical", type: "Normal", basePower: 40, accuracy: 100, pp: 35 } },
  items: { leftovers: { id: "leftovers", name: "Leftovers", isNonstandard: null } },
};

function teamOf(...names) {
  return names.map(name => {
    const pokemon = regulation.pokemon.find(entry => entry.name === name);
    const member = makeMember(pokemon);
    member.ability = detailData.pokedex[member.pokemon.name === "Raichu [Alolan Form]" ? "raichualola" : member.pokemon.name.toLowerCase()]?.abilities?.[0] || "";
    member.moves = ["tackle", "", "", ""];
    member.item = "leftovers";
    member.statPoints.hp = 10;
    return member;
  });
}

test("v2 saved team migrates to the latest schema without losing members", () => {
  const raw = {
    schemaVersion: 2,
    id: "saved-v2",
    name: "기존 팀",
    regulationId: "test-reg",
    cupRuleId: "none",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    members: [{ pokemonName: "Pikachu", ability: "Static", moves: ["tackle"] }, { pokemonName: "Raichu", moves: [] }],
  };
  const migrated = normalizeSavedTeam(raw);
  assert.equal(migrated.schemaVersion, TEAM_SCHEMA_VERSION);
  assert.equal(migrated.members.length, 2);
  assert.equal(migrated.createdAt, raw.createdAt);
  assert.equal(migrated.updatedAt, raw.updatedAt);
});

test("draft migration is version-aware and malformed data fails safely", () => {
  const migrated = normalizeDraft({ schemaVersion: 2, regulationId: "test-reg", members: [{ pokemonName: "Pikachu" }] }, { "test-reg": regulation });
  assert.equal(migrated.schemaVersion, DRAFT_SCHEMA_VERSION);
  assert.equal(migrated.members.length, 1);
  assert.equal(normalizeDraft({ schemaVersion: 2, regulationId: "missing", members: [] }, { "test-reg": regulation }), null);
  assert.doesNotThrow(() => normalizeSavedTeam(null));
  assert.equal(normalizeSavedTeam({ schemaVersion: 2, members: [] }), null);
});

test("canonical Pokémon ids distinguish supported forms", () => {
  const normal = resolveCanonicalPokemonIdentity({ pokemon: regulation.pokemon[1] }, { detailData });
  const alolan = resolveCanonicalPokemonIdentity({ pokemon: regulation.pokemon[2] }, { detailData });
  assert.equal(normal.pokemonId, "raichu");
  assert.equal(alolan.pokemonId, "raichualola");
  assert.notEqual(normal.pokemonId, alolan.pokemonId);
  assert.equal(normal.speciesIdentity, alolan.speciesIdentity);
  const flower = resolveCanonicalPokemonIdentity({ pokemon: { name: "Florges [Yellow Flower]" } }, { detailData });
  assert.equal(flower.pokemonId, "florgesyellow");
});

test("saved member restore is lossless when regulation resolution fails", () => {
  const saved = { pokemonName: "Mew", pokemonId: "mew", ability: "Synchronize", item: "leftovers", moves: ["tackle", "", "", ""], statPoints: { hp: 12 } };
  const restored = memberFromSaved(saved, regulation);
  assert.equal(restored.resolutionState, "unresolved");
  assert.equal(restored.pokemon.name, "Mew");
  assert.equal(restored.pokemonId, "mew");
  assert.equal(restored.item, "leftovers");
  assert.equal(restored.moves[0], "tackle");
  assert.equal(restored.statPoints.hp, 12);
});

test("local round trip retains canonical id and member data", () => {
  const team = teamOf("Pikachu", "Raichu [Alolan Form]");
  const savedMembers = serializeMembers(team, { detailData });
  assert.equal(savedMembers[1].pokemonId, "raichualola");
  const saved = normalizeSavedTeam({ schemaVersion: TEAM_SCHEMA_VERSION, id: "saved", name: "팀", regulationId: "test-reg", members: savedMembers });
  const restored = saved.members.map(member => memberFromSaved(member, regulation));
  assert.equal(restored[1].pokemonId, "raichualola");
  assert.equal(restored[1].pokemon.name, "Raichu [Alolan Form]");
});

test("unresolved member blocks TeamSnapshot creation", () => {
  const unresolved = memberFromSaved({ pokemonName: "Mew", pokemonId: "mew", moves: [] }, regulation);
  const result = toTeamSnapshotV1({ team: [unresolved], regulationId: "test-reg", cupRuleId: "none", detailData });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Mew/);
});

test("resolved six-member TeamSnapshot preserves fields and does not mutate runtime", () => {
  const team = teamOf("Pikachu", "Raichu", "Raichu [Alolan Form]", "Bulbasaur", "Charmander", "Squirtle");
  const before = JSON.parse(JSON.stringify(team));
  const result = toTeamSnapshotV1({ team, regulationId: "test-reg", cupRuleId: "none", cupRuleSettings: { assignedType: "fire" }, detailData });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.schema_version, 1);
  assert.deepEqual(result.snapshot.cup_rule_settings, {});
  assert.equal(result.members.length, 6);
  assert.deepEqual(result.members.map(member => member.slot), [1, 2, 3, 4, 5, 6]);
  assert.equal(result.members[2].pokemon_id, "raichualola");
  assert.equal(result.members[0].ability_id, "static");
  assert.equal(result.members[0].item_id, "leftovers");
  assert.equal(result.members[0].move_1_id, "tackle");
  assert.deepEqual(team, before);

  result.members[0].stat_hp = 99;
  assert.equal(team[0].statPoints.hp, 10);
});

test("TeamSnapshot loader restores resolved members and preserves unresolved rows", () => {
  const result = toTeamSnapshotV1({ team: teamOf("Pikachu"), regulationId: "test-reg", cupRuleId: "none", detailData });
  const loaded = fromTeamSnapshotV1({ snapshot: result.snapshot, members: result.members, regulation, detailData });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.team[0].pokemon.name, "Pikachu");
  assert.equal(loaded.team[0].ability, "Static");

  const unresolved = fromTeamSnapshotV1({ snapshot: result.snapshot, members: [{ ...result.members[0], pokemon_id: "missing", pokemon_name_snapshot: "Mew" }], regulation, detailData });
  assert.equal(unresolved.team[0].resolutionState, "unresolved");
  assert.equal(unresolved.team[0].pokemon.name, "Mew");
});

test("rule-change removal helper preserves existing filter semantics", () => {
  const team = teamOf("Pikachu", "Raichu");
  const smaller = { ...regulation, pokemon: regulation.pokemon.filter(entry => entry.name !== "Raichu") };
  const removed = membersRemovedByRuleChange({ team, regulation: smaller, cupRuleId: "none" });
  assert.deepEqual(removed.map(member => member.pokemon.name), ["Raichu"]);
  assert.deepEqual(membersRemovedByRuleChange({ team, regulation, cupRuleId: "monotype-challenge", assignedTypeId: "", detailData }), []);
});

test("existing validation semantics remain strict and detect duplicate item", () => {
  const team = teamOf("Pikachu");
  const result = validateTeam({ team, regulation, regulationId: "test-reg", cupRuleId: "none", assignedTypeId: "", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }], displayPokemon: pokemon => pokemon.name });
  assert.equal(result.status, "incomplete");
  assert.equal(result.errors.length, 0);
  team.push(...teamOf("Raichu"));
  const duplicate = validateTeam({ team, regulation, regulationId: "test-reg", cupRuleId: "none", assignedTypeId: "", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }], displayPokemon: pokemon => pokemon.name });
  assert.ok(duplicate.errors.some(error => error.includes("Item Clause")));
});

test("official eligibility allows legal incomplete parties but rejects an empty party", () => {
  const one = validateSubmissionEligibility({ team: teamOf("Pikachu"), regulation, regulationId: "test-reg", cupRuleId: "none", assignedTypeId: "", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }], displayPokemon: pokemon => pokemon.name });
  assert.equal(one.eligible, true);
  assert.ok(one.warnings.some(message => message.includes("1/6")));

  const empty = validateSubmissionEligibility({ team: [], regulation, regulationId: "test-reg", cupRuleId: "none", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }] });
  assert.equal(empty.eligible, false);
  assert.ok(empty.errors.some(message => message.includes("1마리 이상")));
});

test("official eligibility keeps missing moves, ability, and item distinct from illegality", () => {
  const member = teamOf("Pikachu")[0];
  member.moves = ["", "", "", ""];
  member.ability = "";
  member.item = "";
  const result = validateSubmissionEligibility({ team: [member], regulation, regulationId: "test-reg", cupRuleId: "none", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }] });
  assert.equal(result.eligible, true);
  assert.equal(result.errors.length, 0);
});

test("official eligibility rejects illegal move, ability, item, species, regulation, and cup rule", () => {
  const illegalMove = teamOf("Pikachu");
  illegalMove[0].moves = ["thunderbolt", "", "", ""];
  assert.equal(validateSubmissionEligibility({ team: illegalMove, regulation, regulationId: "test-reg", cupRuleId: "none", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }] }).eligible, false);

  const illegalAbility = teamOf("Pikachu");
  illegalAbility[0].ability = "Static Dummy";
  assert.equal(validateSubmissionEligibility({ team: illegalAbility, regulation, regulationId: "test-reg", cupRuleId: "none", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }] }).eligible, false);

  const illegalItem = teamOf("Pikachu");
  illegalItem[0].item = "choiceband";
  assert.equal(validateSubmissionEligibility({ team: illegalItem, regulation, regulationId: "test-reg", cupRuleId: "none", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }] }).eligible, false);

  const species = teamOf("Raichu", "Raichu [Alolan Form]");
  assert.equal(validateSubmissionEligibility({ team: species, regulation, regulationId: "test-reg", cupRuleId: "none", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }] }).eligible, false);

  const outOfRegulation = makeMember({ name: "Florges [Yellow Flower]" });
  outOfRegulation.ability = "Flower Veil";
  outOfRegulation.moves = ["tackle", "", "", ""];
  assert.equal(validateSubmissionEligibility({ team: [outOfRegulation], regulation, regulationId: "test-reg", cupRuleId: "none", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }] }).eligible, false);

  const cupIllegal = teamOf("Pikachu");
  assert.equal(validateSubmissionEligibility({ team: cupIllegal, regulation, regulationId: "test-reg", cupRuleId: "monotype-challenge", assignedTypeId: "fire", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }] }).eligible, false);
});

test("official eligibility fails closed when detail legality data is unavailable or identity is unresolved", () => {
  const unavailable = validateSubmissionEligibility({ team: teamOf("Pikachu"), regulation, regulationId: "test-reg", cupRuleId: "none", detailData: null, detailStatus: "error" });
  assert.equal(unavailable.eligible, false);
  assert.ok(unavailable.errors.some(message => message.includes("확인할 수 없습니다")));

  const unresolved = memberFromSaved({ pokemonName: "Mew", pokemonId: "mew", moves: [] }, regulation);
  const result = validateSubmissionEligibility({ team: [unresolved], regulation, regulationId: "test-reg", cupRuleId: "none", detailData, detailStatus: "ready", legalItems: [{ id: "leftovers" }] });
  assert.equal(result.eligible, false);
  assert.ok(result.errors.some(message => message.includes("canonical")));
});

test("submission status read model uses the highest revision and does not require final_submission_id", () => {
  const rows = buildSubmissionStatusRows([
    { id: "reg-a", registration_name: "A" },
    { id: "reg-b", registration_name: "B" },
  ], [
    { registration_id: "reg-a", revision: 1, submitted_at: "2026-09-05T01:00:00Z" },
    { registration_id: "reg-a", revision: 2, submitted_at: "2026-09-05T02:41:00Z" },
  ]);
  assert.deepEqual(rows, [
    { registrationId: "reg-a", registrationName: "A", hasSubmission: true, latestRevision: 2, latestSubmittedAt: "2026-09-05T02:41:00Z" },
    { registrationId: "reg-b", registrationName: "B", hasSubmission: false, latestRevision: null, latestSubmittedAt: null },
  ]);
});

test("team bracket submission status groups EntryParticipant registrations and keeps non-submitters", () => {
  const bracket = {
    mode: "team",
    participants: [
      {
        id: "team-1",
        entryId: "entry-1",
        name: "1팀",
        members: ["team1", "team2"],
        memberIdentities: [
          { memberOrder: 2, name: "team2", registrationId: "reg-2", entryParticipantId: "ep-2" },
          { memberOrder: 1, name: "team1", registrationId: "reg-1", entryParticipantId: "ep-1" },
        ],
      },
      {
        id: "team-2",
        entryId: "entry-2",
        name: "2팀",
        members: ["team3", "team4"],
        memberIdentities: [
          { memberOrder: 1, name: "team3", registrationId: "reg-3", entryParticipantId: "ep-3" },
          { memberOrder: 2, name: "team4", registrationId: "reg-4", entryParticipantId: "ep-4" },
        ],
      },
    ],
  };
  const before = JSON.parse(JSON.stringify(bracket));
  const model = buildBracketSubmissionStatusModel(bracket, [
    { registrationId: "reg-1", registrationName: "team1", hasSubmission: true, latestSubmittedAt: "2026-09-05T03:12:00Z" },
    { registrationId: "reg-2", registrationName: "team2", hasSubmission: false, latestSubmittedAt: null },
    { registrationId: "reg-3", registrationName: "team3", hasSubmission: true, latestSubmittedAt: "2026-09-05T03:18:00Z" },
    { registrationId: "reg-4", registrationName: "team4", hasSubmission: false, latestSubmittedAt: null },
  ]);
  assert.equal(model.submitted, 2);
  assert.equal(model.total, 4);
  assert.deepEqual(model.teams.map(team => [team.teamName, team.submitted, team.total]), [["1팀", 1, 2], ["2팀", 1, 2]]);
  assert.equal(model.teams[0].members[0].latestSubmittedAt, "2026-09-05T03:12:00Z");
  assert.equal(model.teams[0].members[1].hasSubmission, false);
  assert.deepEqual(bracket, before);
});

test("individual bracket submission status uses registration identity and includes missing submissions", () => {
  const model = buildBracketSubmissionStatusModel({
    mode: "single",
    participants: [
      { id: "p-1", name: "A", registrationId: "reg-a" },
      { id: "p-2", name: "B", registrationId: "reg-b" },
      { id: "p-3", name: "C", registrationId: "reg-c" },
    ],
  }, [
    { registrationId: "reg-a", hasSubmission: true, latestSubmittedAt: "2026-09-05T03:12:00Z" },
    { registrationId: "reg-c", hasSubmission: true, latestSubmittedAt: "2026-09-05T03:21:00Z" },
  ]);
  assert.equal(model.submitted, 2);
  assert.equal(model.total, 3);
  assert.deepEqual(model.participants.map(row => [row.name, row.hasSubmission]), [["A", true], ["B", false], ["C", true]]);
  assert.equal(model.participants[2].latestSubmittedAt, "2026-09-05T03:21:00Z");
});

test("team creation state without confirmed Entry identities does not create submission status rows", () => {
  assert.deepEqual(buildBracketSubmissionStatusModel({
    mode: "team",
    participants: [{ id: "draft-team", name: "1팀", members: ["A", "B"] }],
  }, [{ registrationId: "reg-a", hasSubmission: true }]), {
    mode: "team",
    submitted: 0,
    total: 0,
    teams: [],
  });
});

test("submission registration selection trims exact names, preserves NULL Player rows, and rejects ambiguous or migration anchors", () => {
  const registrations = [
    { id: "reg-a", registration_name: "홍길동", registration_source: "application", player_id: null },
    { id: "reg-migration", registration_name: "홍길동", registration_source: "migration", player_id: null },
  ];
  assert.equal(selectSubmissionRegistration(registrations, "홍길동").id, "reg-a");
  assert.equal(selectSubmissionRegistration(registrations, "없는 사람"), null);
  assert.throws(
    () => selectSubmissionRegistration([
      { id: "reg-a", registration_name: "홍길동", registration_source: "application" },
      { id: "reg-b", registration_name: "홍길동", registration_source: "manual" },
    ], "홍길동"),
    error => error.code === "YPL_AMBIGUOUS_REGISTRATION"
  );
});
