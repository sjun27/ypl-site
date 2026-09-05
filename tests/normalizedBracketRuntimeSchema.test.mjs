import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SINGLE_BRACKET_PROJECTION_CONTRACT } from "../src/services/bracketProjection.js";

const sql = readFileSync(
  new URL("../docs/db/normalized_bracket_runtime.sql", import.meta.url),
  "utf8"
);

function tableBody(tableName) {
  const start = sql.indexOf(`create table if not exists ypl_schema_validation.${tableName}`);
  assert.ok(start >= 0, `${tableName} DDL이 없습니다.`);
  const end = sql.indexOf("\n);", start);
  assert.ok(end > start, `${tableName} DDL 종료를 찾을 수 없습니다.`);
  return sql.slice(start, end);
}

test("DDL is an explicit, schema-qualified additive draft", () => {
  assert.match(sql, /Status: DRAFT \/ DO NOT RUN ON PRODUCTION/);
  assert.match(sql, /create table if not exists ypl_schema_validation\.bracket_runtimes/);
  assert.match(sql, /create table if not exists ypl_schema_validation\.bracket_entry_slots/);
  assert.match(sql, /create table if not exists ypl_schema_validation\.bracket_identity_changes/);
  assert.match(sql, /begin;[\s\S]*commit;/);
  assert.doesNotMatch(sql, /^\s*create table if not exists (?!ypl_schema_validation\.)/m);
  assert.doesNotMatch(sql, /^\s*(insert|update|delete)\s+/im);
  assert.doesNotMatch(sql, /^\s*create\s+(or replace\s+)?function\b/im);
});

test("runtime table is the normalized discriminator and version boundary", () => {
  const body = tableBody("bracket_runtimes");
  for (const field of [
    "id uuid primary key",
    "event_id uuid not null",
    "topology_kind text not null",
    "projection_version smallint not null",
    "previous_event_status text not null",
    "created_at timestamptz not null",
    "updated_at timestamptz not null",
  ]) assert.match(body, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(body, /check \(topology_kind = 'single_elimination'\)/i);
  assert.match(body, /unique \(event_id\)/i);
  assert.match(body, /unique \(id, event_id\)/i);
  assert.match(body, /references ypl_schema_validation\.events\(id\)/i);
});

test("slot table persists draw positions without seed or BYE rows", () => {
  const body = tableBody("bracket_entry_slots");
  for (const field of [
    "bracket_runtime_id uuid not null",
    "event_id uuid not null",
    "stage_kind text not null",
    "stage_no smallint not null",
    "pool_no smallint not null",
    "slot_no integer not null",
    "entry_id uuid not null",
    "created_at timestamptz not null",
  ]) assert.match(body, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(body, /primary key \(bracket_runtime_id, stage_kind, stage_no, pool_no, slot_no\)/i);
  assert.match(body, /unique \(bracket_runtime_id, stage_kind, stage_no, entry_id\)/i);
  assert.match(body, /references ypl_schema_validation\.bracket_runtimes\(id, event_id\)/i);
  assert.match(body, /references ypl_schema_validation\.entries\(id, event_id\)/i);
  assert.match(body, /stage_kind = 'elimination' and pool_no = 0/i);
  assert.match(body, /stage_kind = 'group' and pool_no > 0/i);
  assert.doesNotMatch(body, /\bseed\b/i);
  assert.doesNotMatch(body, /\bbye\b/i);
});

test("identity ownership table preserves typed create/link/restore facts", () => {
  const body = tableBody("bracket_identity_changes");
  for (const field of [
    "bracket_runtime_id uuid not null",
    "event_id uuid not null",
    "entry_participant_id uuid not null",
    "entry_id uuid not null",
    "registration_id uuid not null",
    "player_id uuid not null",
    "player_was_created boolean not null",
    "registration_was_created boolean not null",
    "registration_player_was_changed boolean not null",
    "previous_registration_player_id uuid",
    "entry_was_created boolean not null",
    "entry_participant_was_created boolean not null",
    "created_at timestamptz not null",
  ]) assert.match(body, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(body, /primary key \(bracket_runtime_id, entry_participant_id\)/i);
  assert.match(body, /unique \(bracket_runtime_id, registration_id\)/i);
  assert.match(body, /unique \(bracket_runtime_id, player_id\)/i);
  assert.match(body, /references ypl_schema_validation\.entry_participants\(\s*id,\s*event_id,\s*entry_id,\s*registration_id,\s*player_id\s*\)/i);
  assert.match(body, /references ypl_schema_validation\.event_registrations\(id, event_id, player_id\)/i);
  assert.match(body, /references ypl_schema_validation\.players\(id\)/i);
  assert.match(body, /previous_registration_player_id is distinct from player_id/i);
  assert.match(sql, /uq_entry_participants_event_identity/);
  assert.match(sql, /unique \(id, event_id, entry_id, registration_id, player_id\)/i);
});

test("DDL preserves the established Match and projection contracts", () => {
  const matchStart = sql.indexOf("create table if not exists ypl_schema_validation.bracket_runtimes");
  const matchSection = sql.slice(matchStart);
  assert.doesNotMatch(matchSection, /create table if not exists ypl_schema_validation\.matches/);
  assert.doesNotMatch(tableBody("bracket_runtimes"), /competition_settings/i);
  assert.doesNotMatch(tableBody("bracket_entry_slots"), /bracket_runtime_id.*matches/i);
  assert.match(sql, /source='normalized_bracket_runtime'/);
  assert.match(sql, /source_node_key='single:r\{round\}:m\{match\}'/);
  assert.equal(SINGLE_BRACKET_PROJECTION_CONTRACT.seedIsBracketSlot, false);
  assert.equal(SINGLE_BRACKET_PROJECTION_CONTRACT.nodeKeyPattern, "single:r{round}:m{match}");
});

test("transaction comments require idempotent create and fail-closed slot handling", () => {
  assert.match(sql, /same runtime id and same payload re-reads the committed success/i);
  assert.match(sql, /different[\s\S]*payload[\s\S]*fails closed/i);
  assert.match(sql, /Result winner create\/change\/cancel[\s\S]*separate future atomic RPC/i);
  assert.match(sql, /missing or duplicate[\s\S]*never falls back to Entry-id ordering/i);
  assert.match(sql, /Any preflight failure is a full no-op/i);
});
