import { CUP_RULES } from "../data/index.js";
import { toTeamSnapshotV1 } from "./teamBuilderCore.js";

export const SUBMISSION_REGISTRATION_SOURCES = ["application", "advancement", "manual"];

export function getSubmissionWriteGate(event, { now = new Date() } = {}) {
  if (!event) {
    return { allowed: false, code: "event_missing", error: "연결된 Event를 찾을 수 없습니다.", late: false, warning: "" };
  }
  if (!["open", "running"].includes(event.status)) {
    return { allowed: false, code: "event_closed", error: "현재 파티를 제출할 수 없는 Event입니다.", late: false, warning: "" };
  }
  if (event.record_applied_at) {
    return { allowed: false, code: "record_applied", error: "기록 반영이 완료된 Event에는 파티를 제출할 수 없습니다.", late: false, warning: "" };
  }
  const cupRuleId = String(event.cup_rule_id || "none");
  if (!CUP_RULES[cupRuleId]) {
    return { allowed: false, code: "unsupported_cup_rule", error: "Event의 Cup Rule을 현재 Team Builder에서 확인할 수 없어 제출할 수 없습니다.", late: false, warning: "" };
  }

  const targetAt = event.submission_target_at ? new Date(event.submission_target_at) : null;
  const nowDate = now instanceof Date ? now : new Date(now);
  const late = Boolean(targetAt && !Number.isNaN(targetAt.getTime()) && !Number.isNaN(nowDate.getTime()) && nowDate > targetAt);
  return {
    allowed: true,
    code: late ? "late_allowed" : "open",
    error: "",
    late,
    warning: late ? "권장 제출 시각이 지났지만 현재 Event가 진행 중이므로 제출할 수 있습니다." : "",
  };
}

export function buildTeamSnapshotSubmission({
  event,
  registration,
  registrationName,
  eligibility,
  team = [],
  regulationId = null,
  cupRuleId = null,
  cupRuleSettings = {},
  detailData = null,
  now = new Date(),
} = {}) {
  const gate = getSubmissionWriteGate(event, { now });
  if (!gate.allowed) {
    const error = new Error(gate.error);
    error.code = `YPL_${gate.code.toUpperCase()}`;
    throw error;
  }

  const name = String(registrationName || "").trim();
  if (!name) throw new Error("신청자 이름을 입력해 주세요.");
  if (!registration || registration.event_id !== event.id || registration.registration_name !== name) {
    throw new Error("Event의 신청자 exact match 확인이 필요합니다.");
  }
  if (!SUBMISSION_REGISTRATION_SOURCES.includes(registration.registration_source)) {
    throw new Error("제출할 수 있는 신청 출처가 아닙니다.");
  }
  if (!eligibility?.eligible) {
    throw new Error("제출 eligibility 검증을 통과한 파티만 제출할 수 있습니다.");
  }

  const built = toTeamSnapshotV1({
    team,
    regulationId,
    cupRuleId,
    cupRuleSettings,
    detailData,
    sourceType: "manual",
  });
  if (!built.ok) {
    const error = new Error(built.errors.join(" "));
    error.code = "YPL_SNAPSHOT_INVALID";
    throw error;
  }

  const submittedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    eventId: event.id,
    registrationId: registration.id,
    registrationName: name,
    snapshot: built.snapshot,
    members: built.members,
    submittedAt,
    late: gate.late,
    warning: gate.warning,
  };
}
