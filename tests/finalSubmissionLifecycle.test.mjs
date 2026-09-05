import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildFinalSubmissionFreezePlan,
  compensateFinalSubmissionReleaseFailure,
  isFinalSubmissionRestoreAllowed,
  isRecordApplyCompletionConfirmed,
  releaseFinalSubmissionPointers,
  restoreFinalSubmissionPointers,
} from "../src/services/finalSubmissionLifecycle.js";

const EVENT_ID = "event-p2-6";
const registrations = [
  { id: "reg-a", event_id: EVENT_ID, final_submission_id: "old-a" },
  { id: "reg-b", event_id: EVENT_ID, final_submission_id: "old-b" },
  { id: "reg-outside", event_id: EVENT_ID, final_submission_id: "outside" },
];
const participants = [
  { event_id: EVENT_ID, registration_id: "reg-a" },
  { event_id: EVENT_ID, registration_id: "reg-b" },
];

test("freeze selects only actual participants and their latest revision", () => {
  const plan = buildFinalSubmissionFreezePlan({
    eventId: EVENT_ID,
    entryParticipants: participants,
    registrations,
    submissions: [
      { id: "submission-a-1", registration_id: "reg-a", revision: 1 },
      { id: "submission-a-3", registration_id: "reg-a", revision: 3 },
      { id: "submission-a-2", registration_id: "reg-a", revision: 2 },
      { id: "submission-outside", registration_id: "reg-outside", revision: 99 },
    ],
  });
  assert.deepEqual(plan, [
    { registrationId: "reg-a", previousFinalSubmissionId: "old-a", finalSubmissionId: "submission-a-3" },
    { registrationId: "reg-b", previousFinalSubmissionId: "old-b", finalSubmissionId: null },
  ]);
});

test("freeze compensation restores exact previous pointers without altering submissions", () => {
  const snapshot = [
    { registrationId: "reg-a", previousFinalSubmissionId: "old-a", finalSubmissionId: "submission-a-3" },
    { registrationId: "reg-b", previousFinalSubmissionId: "old-b", finalSubmissionId: null },
  ];
  const frozen = [
    { ...registrations[0], final_submission_id: "submission-a-3" },
    { ...registrations[1], final_submission_id: null },
    registrations[2],
  ];
  const restored = restoreFinalSubmissionPointers(frozen, snapshot);
  assert.deepEqual(restored.map((row) => row.final_submission_id), ["old-a", "old-b"]);
  assert.throws(
    () => restoreFinalSubmissionPointers([{ ...frozen[0], final_submission_id: "changed" }, frozen[1]], snapshot),
    /보상 대상이 변경/
  );
});

test("release clears only actual participant pointers and preserves revision history rows", () => {
  const released = releaseFinalSubmissionPointers(registrations, participants.map((row) => row.registration_id));
  assert.deepEqual(released.map((row) => row.final_submission_id), [null, null, "outside"]);
});

test("release failure compensation restores legacy, Result, and RankingAward in order without appending duplicates", async () => {
  const calls = [];
  const appliedState = {
    legacy: [],
    results: [],
    awards: [],
  };
  const restore = (label, rows) => () => {
    calls.push(label);
    appliedState[label] = [...rows];
  };

  await compensateFinalSubmissionReleaseFailure({
    restoreLegacy: restore("legacy", ["round-applied"]),
    restoreResults: restore("results", ["result-1"]),
    restoreAwards: restore("awards", ["award-1"]),
  });
  await compensateFinalSubmissionReleaseFailure({
    restoreLegacy: restore("legacy", ["round-applied"]),
    restoreResults: restore("results", ["result-1"]),
    restoreAwards: restore("awards", ["award-1"]),
  });

  assert.deepEqual(calls, ["legacy", "results", "awards", "legacy", "results", "awards"]);
  assert.deepEqual(appliedState, {
    legacy: ["round-applied"],
    results: ["result-1"],
    awards: ["award-1"],
  });
});

test("exact final submission restore is allowed only before completion or reveal", () => {
  assert.equal(isFinalSubmissionRestoreAllowed({
    status: "running",
    record_applied_at: null,
    team_revealed_at: null,
  }), true);
  assert.equal(isFinalSubmissionRestoreAllowed({
    status: "completed",
    record_applied_at: null,
    team_revealed_at: null,
  }), false);
  assert.equal(isFinalSubmissionRestoreAllowed({
    status: "running",
    record_applied_at: "2026-09-05T01:00:00Z",
    team_revealed_at: null,
  }), false);
  assert.equal(isFinalSubmissionRestoreAllowed({
    status: "running",
    record_applied_at: null,
    team_revealed_at: "2026-09-05T01:00:00Z",
  }), false);
});

test("on_record_apply completion requery requires completed, applied, and revealed", () => {
  const completed = {
    status: "completed",
    record_applied_at: "2026-09-05T01:00:00Z",
    team_revealed_at: "2026-09-05T01:00:01Z",
  };
  assert.equal(isRecordApplyCompletionConfirmed(completed, { requireTeamReveal: true }), true);
  assert.equal(isRecordApplyCompletionConfirmed({ ...completed, team_revealed_at: null }, { requireTeamReveal: true }), false);
  assert.equal(isRecordApplyCompletionConfirmed({ ...completed, status: "running" }, { requireTeamReveal: true }), false);
});

test("restore RPC contains the completed/applied/revealed state guard", () => {
  const sql = readFileSync(new URL("../docs/db/team_submission_rpc.sql", import.meta.url), "utf8");
  const start = sql.indexOf("create or replace function ypl_schema_validation.restore_event_final_submissions");
  const end = sql.indexOf("create or replace function ypl_schema_validation.release_event_final_submissions");
  assert.ok(start >= 0 && end > start);
  const restoreSql = sql.slice(start, end);
  assert.match(restoreSql, /v_event\.status\s*=\s*'completed'/);
  assert.match(restoreSql, /v_event\.record_applied_at\s+is not null/);
  assert.match(restoreSql, /v_event\.team_revealed_at\s+is not null/);
});

test("release RPC qualifies Event ids despite its output id column", () => {
  const sql = readFileSync(new URL("../docs/db/team_submission_rpc.sql", import.meta.url), "utf8");
  const start = sql.indexOf("create or replace function ypl_schema_validation.release_event_final_submissions");
  assert.ok(start >= 0);
  const releaseSql = sql.slice(start);
  assert.match(releaseSql, /from ypl_schema_validation\.events\s+as event\s+where event\.id\s*=\s*p_event_id/);
  assert.match(releaseSql, /update ypl_schema_validation\.events\s+as event[\s\S]*where event\.id\s*=\s*p_event_id/);
  assert.doesNotMatch(releaseSql, /\bwhere id\s*=\s*p_event_id/);
});
