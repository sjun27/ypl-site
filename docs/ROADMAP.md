# YPL 개발 로드맵

> 이 문서는 **현재 구현 상태와 앞으로의 개발 순서**만 관리합니다.
>
> - 과거 변경 이력: `docs/PATCH_NOTES_2026-08-26.md`
> - 기술 구조·데이터 모델·운영 원칙: `docs/ARCHITECTURE.md`

마지막 업데이트: 2026-09-06

---

# 1. 현재 시스템 상태

YPL 사이트는 크게 세 영역으로 구성한다.

```text
YPL Tools
└─ Team Builder

YPL 대회 운영
├─ 신청
├─ 참가자 관리
├─ 대진표
└─ 기록 반영

YPL Records
├─ 트레이너
├─ 대회
├─ 포켓몬
└─ 랭킹

현재는 Test의 신규 Event-linked 운영 runtime과 Production/historical compatibility가 함께 동작하는
전환 단계다.

```text
Event
→ EventRegistration
→ Entry
→ EntryParticipant
→ bracket_runtimes
→ bracket_entry_slots (actual draw)
→ Match
→ Result
→ RankingAward
→ final submission
→ Records
```

Test의 신규 Event-linked Single Elimination, Double Elimination, Team runtime에서는
`bracket_runtimes`, `bracket_entry_slots`, `bracket_identity_changes`, `Entry`,
`EntryParticipant`, `Match`가 normalized bracket 사실의 원본이다. Entry의 `seed`는 metadata이며
actual draw slot과 구분한다. Bracket graph 전체는 DB에 저장하지 않고 pure projection으로 계산한다.

Production 운영 원본은 여전히 Supabase `public.site_data / ypl_data_v4`이며 Production normalized
cutover는 아직 적용하지 않았다. historical bracket, legacy-only Event와 legacy round/ranking/season
write는 기존 compatibility path를 유지한다.

2. 현재 구현 상태
2.1 신청 / Event
구현 완료 — Test
신청 공지에서 Event 생성 및 연결
신규 Event를 정확히 하나인 current Season에 자동 연결
기존 Event 수정 시 기존 season_id 보존
Event에 대회 종류 / division / battle format / competition format 저장
Regulation / Cup Rule 설정 저장
신청 완료 시 EventRegistration 생성
참가자 이름 앞뒤 공백 제거 후 exact match
기존 Player가 정확히 1명일 때만 player_id 연결
신규 이름은 신청 단계에서 Player를 생성하지 않고 NULL 유지
동명이인도 자동 선택하지 않고 NULL 유지
동일 Event의 동일 신청 이름 중복 차단
공지 삭제 시 연결 Event 취소
Event lifecycle 1차 구현

Player는 신청자가 아니라 장기적으로 유지되는 트레이너 identity다.

신청 단계에서는 신규 Player를 생성하지 않는다.

2.2 대진표

기존 legacy Single/Double/League/Team 대진표와 결과·기록 반영·취소 흐름은 compatibility path로
유지한다. 신규 Event-linked 대진표는 P2-7에서 다음 normalized runtime으로 전환했다.

- individual Single Elimination
- Double Elimination
- Event-linked Team runtime

공통 흐름은 다음과 같다.

```text
Event 선택
→ EventRegistration / identity preflight
→ Entry / EntryParticipant 확정
→ normalized bracket runtime 생성
→ persisted actual draw slot 저장
→ projection 기반 Bracket UI
→ formed Match 생성·승자 반영
→ Result / RankingAward / Records lifecycle
```

DB에는 실제 Entry, 참가자, persisted draw slot, 실제 formed Match와 winner facts만 저장한다.
BYE, future Match, topology, advancement edge, Double losers movement, GF/Reset activation은
projection에서 계산한다. normalized runtime이 malformed하면 legacy fallback하지 않고 fail closed한다.

기록 반영 전 삭제, winner cancel/change, downstream stale Match 정리와 reload restore를 지원하며,
historical / legacy-only bracket은 기존 compatibility path를 유지한다.

2.3 기록 반영

현재 기록 반영은 normalized identity + legacy Records의 hybrid 구조다.

normalized에서 처리
연결 Event 확인
Bracket 생성 시 확정된 Entry / EntryParticipant / Registration / Player 검증
Event 연결 개인전·팀전의 실제 Match snapshot 동기화
Event 연결 개인전·팀전의 우승 / 준우승 / 실제 4강 Result 동기화
Event 연결 Master / Light 개인전·팀전의 실제 지급 RankingAward 동기화
전환 이전 Bracket은 기존 record-apply identity 확정 fallback 사용
Event completed
record_applied_at 기록
아직 legacy에서 처리
대회 회차
대회 회차의 입상 필드 및 기록 반영 write
누적 랭킹 / 시즌별 성적 write

Records read는 Test의 P0-8부터 완료된 normalized 개인전 Event를 읽었고, P1-5에서 normalized 팀전 Event까지 확장한 hybrid 구조다.

현재 정책:

Master → 랭킹 반영 / 시즌 반영
Light  → 랭킹 반영 / 시즌 반영
Rookie → 랭킹 미반영 / 시즌 미반영
Team   → Event-linked canonical write 및 normalized Records team read는 P1-5 완료

팀전 placement는 팀 이력으로 보존하되 개인 우승 / 준우승 / 4강 count에서는 제외하는 것이 canonical 정책이다.
legacy와 normalized projection 모두 이 정책을 적용한다.

최종 파티 source of truth는 `EventRegistration.final_submission_id →
RegistrationSubmission → TeamSnapshot → TeamSnapshotMember`다. `team_revealed_at IS NOT NULL`인
finalized Event에서는 final pointer가 있는 참가자만 final Snapshot을 사용하고, pointer가 없는
참가자는 파티 없음으로 처리한다. 이 경계에서는 legacy party fallback을 사용하지 않는다.
`team_revealed_at IS NULL`인 historical compatibility Event에 한해 기존 legacy fallback을 유지한다.
기록 반영 취소 — Test 완료

반영 취소 시:

legacy 회차 제거
랭킹 원복
시즌 성적 원복
Bracket active 복구
Event running 복구
record_applied_at = NULL
Bracket 생성 시 확정한 Entry / EntryParticipant / Registration / Player 유지
normalized Match 유지
runtime Result 제거
runtime placement RankingAward를 Result보다 먼저 제거
전환 이전 Bracket에서 기록 반영이 만든 identity만 기존 방식으로 원복

P0-4까지의 apply → revert → reapply legacy/Match 흐름을 Test 환경에서 검증했다.
P0-5 Result lifecycle은 Double Elimination과 Single Elimination 모두 브라우저 E2E까지 완료했다.
Double Elimination은 apply → revert → 결과 변경 → reapply 및 reset final 경로를 검증했고,
Single Elimination은 apply → revert 흐름을 검증했다.

legacy 저장 실패 시에도 이번 반영 과정에서 발생한 Player / Registration identity 변경을 원복한다.

2.4 Records

Test Records는 기록 반영이 완료된 normalized 개인전·팀전 Event를 직접 읽는다.
Production과 legacy-only 과거·팀전·챔피언스 기록은 기존 legacy `ypl_data_v4`를 유지한다.

구현된 기반:

completed + record_applied_at Event만 공식 normalized 기록으로 공개
Event → Entry → EntryParticipant → Player → Match → Result → RankingAward read
Player ID 기준 트레이너 identity
같은 Event의 normalized / legacy 회차 중복 억제
RankingBaseline + RankingAward 원장 합산
counts_series / counts_season 정책 반영
개인전은 최종 TeamSnapshot 우선, 없으면 연결된 legacy party fallback
트레이너 기록
대회 기록
포켓몬 기록
랭킹
참가 대회 이력
우승 / 준우승 / 4강
팀전 placement는 팀 우승 / 준우승 / 4강 이력으로 보존
개인 우승 / 준우승 / 4강 count에서는 제외하는 canonical 정책
linked legacy team bracket은 roster / Pokémon / 기존 Match compatibility source로 유지
normalized team placement / history / archive와 연결 legacy round의 중복 표시를 차단
시즌 3 이후 Match 원본 보존
팀전 선발 경기 보존
에이스 결정전 보존
챔피언스 회차의 저장된 round 사용

기본 미공개:

개인 승 / 패
승률
Rival / Head-to-Head
연승

Match 원본은 유지한다.

2.5 Team Builder

P2-1 Team Builder foundation ✅

- canonical Pokémon/form identity
- local saved/draft schema v3 및 v2 migration
- unresolved member lossless restore
- TeamSnapshot v1 serializer / loader foundation
- Regulation / Cup destructive change confirmation
- saved team 전환 / 새 팀 / 현재 팀 복제 UX

P2-2 Event context + submission eligibility + applicant lookup + operator submission-status read UX ✅

- Event context는 `?eventId=<event-id>`를 사용하며 Event의 `regulation_id`, `cup_rule_id`,
  `cup_rule_settings`를 authoritative 값으로 고정한다. free Team Builder mode는 독립 동작을 유지한다.
- 신청자 이름은 `trim(name)` 후 해당 Event의 `registration_name` exact match로 찾고,
  `application / advancement / manual`만 허용한다. 0건은 미발견, 1건은 선택, 2건 이상은
  `YPL_AMBIGUOUS_REGISTRATION`으로 중단하며 fuzzy match와 임의 선택은 사용하지 않는다.
- 기존 completeness validator와 official submission eligibility를 분리한다. Pokémon 1~6,
  1~5마리, 기술 0~3개, 일부 ability/item 누락은 허용할 수 있으며 `Incomplete != Invalid`다.
  Pokémon 0, 6 초과, unresolved member, canonical ID resolve 실패, Regulation/Cup/Clause/
  ability/item/move/Stat Points 위반 및 legality data 확인 불가는 fail closed 한다.
  `submission_target_at`은 hard deadline이 아닌 soft deadline이다.
- `RegistrationSubmission` 존재 여부를 source of truth로 하는 operator read model/UI를 제공한다.
  개인전은 대진표 전후, 팀전은 대진표 생성 후 `Team Entry → EntryParticipant → registration_id
  → EventRegistration → RegistrationSubmission`으로 선수별 상태를 읽는다. 미제출자는 Entry나
  Match에서 제거하지 않는다.

P2-2 browser/local 검증 완료:

- Event context 및 Regulation/Cup 고정, 신청자 exact-match, free mode 정상
- 6 Pokémon + 0 moves는 Team Incomplete이지만 제출 준비 완료, Pokémon 0은 제출 불가
- 팀전 대진표 생성 후 전체/팀별/선수별 제출 현황과 latestSubmittedAt 표시 정상
- targeted tests PASS, 전체 Node tests 113/113 PASS, production build PASS, `git diff --check` PASS

P2-5 실제 공식 파티 제출 ✅

- 공지에서 `?view=builder&eventId=<event-id>`로 직접 진입하고 EventRegistration exact-match 후 제출한다.
- `open / running`이고 `record_applied_at IS NULL`인 Event만 허용하며 `completed`와 기록 반영 완료 Event는
  UI와 RPC 양쪽에서 차단한다.
- 제출은 TeamSnapshot → TeamSnapshotMember → RegistrationSubmission의 atomic RPC로 저장한다.
  재제출은 기존 row를 수정하지 않고 새 Snapshot / Submission과 증가한 revision을 만든다.
- Event의 `regulation_id`, `cup_rule_id`, `cup_rule_settings`를 authoritative 값으로 사용하고,
  soft deadline 이후 제출은 late warning만 표시한다.
- 모노타입 `assignedType`은 Event 모드에서도 직접 선택 가능한 Team Builder local validation state다.
  EventRegistration / TeamSnapshot의 공식 배정값으로 저장하지 않으며, unsupported Cup Rule은 fail closed 한다.
- Test `ypl_schema_validation`에서 team10 revision 1~3과 team1 제출현황을 검증했다. RPC는 Production에
  적용하지 않았다.

P2-6 final_submission_id freeze + Records integration ✅

- 실제 `EntryParticipant.registration_id`가 가리키는 Registration만 대상으로 기록 반영 순간
  각 Registration의 latest `RegistrationSubmission`을 `EventRegistration.final_submission_id`로 freeze한다.
  미제출 실제 참가자는 NULL로 둔다.
- 과거 Submission / TeamSnapshot / TeamSnapshotMember revision은 immutable하게 유지한다.
  기록 반영 취소 시 pointer와 공개 시각을 해제하고, 재제출 후 재반영하면 최신 revision을 다시 freeze한다.
- Apply 순서는 `Match → Result → RankingAward → final_submission_id freeze → legacy ypl_data_v4 save
  → Event completed → record_applied_at → team_revealed_at`이다.
- Revert 순서는 `RankingAward 제거 → Result 제거 → legacy revert → final pointer release
  → Event running → record_applied_at NULL → team_revealed_at NULL`이다.
- freeze 이후 legacy save가 실패하면 exact pointer snapshot으로 복구한다. delayed restore는 Event가
  completed이거나 `record_applied_at` 또는 `team_revealed_at`이 설정된 경우 허용하지 않는다.
  release 실패 시 legacy applied snapshot → Result snapshot → RankingAward snapshot 순으로 보상 복구하며,
  재시도에서도 중복 Result / RankingAward를 만들지 않는다. Event completion은 재조회하고
  `completed + record_applied_at IS NOT NULL + team_revealed_at IS NOT NULL`일 때만 성공 처리한다.
- normalized 개인전 archive는 `Event → Entry(entry_type=individual) → EntryParticipant →
  EventRegistration`으로 실제 참가자 전체를 읽는다. Result가 있으면 우승 / 준우승 / 4강으로,
  Result가 없는 실제 참가자는 임의 순위를 추론하지 않고 참가로 표시한다. 펼친 상태에서만 각 참가자의
  final party를 보여 주며, final이 없으면 `파티 미제출`을 표시한다. 팀전 party 상세는 범위 밖이다.
- Pokémon Records는 `pokemon_id`로 집계하고 canonical Pokédex의 한국어 이름을 우선 표시하며,
  resolve 실패 시에만 `pokemon_name_snapshot`을 fallback으로 사용한다. 중간 revision은 집계하지 않는다.
- 실제 E2E와 local validation은 아래 완료 기록을 따른다.
  `제7회 파이컵라이트` Test1~Test6의 정상 revert 후 Event running, Result / RankingAward 0,
  Match 11 및 Entry 6 / EntryParticipant 6과 Submission revision 유지; 재반영 후 Event completed,
  `record_applied_at` / `team_revealed_at` 생성, 전원 final pointer 생성(final = latest revision 1),
  Result 4, RankingAward 4, Match 11 유지. Records의 final party, 전체 참가자 archive accordion,
  한국어 Pokémon 이름을 확인했다. 최신 local validation은 targeted 15/15, 전체 Node 132/132,
  production build 122 modules, `git diff --check` PASS다.
- Records는 `final_submission_id → RegistrationSubmission → TeamSnapshot → TeamSnapshotMember`만
  공식 파티로 사용한다.

3. normalized DB 전환 상태

설계 범위:

Player
Season
Event
EventRegistration
RegistrationSubmission
TeamSnapshot
TeamSnapshotMember
Entry
EntryParticipant
BracketRuntime
BracketEntrySlot
BracketIdentityChange
Match
Result
RankingAward
RankingBaseline
TitleDefinition
TitleAward
PlayerPartner
HallOfFameEntry
ChampionshipAdvancement

이 목록은 schema 설계 범위이며 모두 runtime에서 사용 중이라는 의미가 아니다.

현재 runtime에서 직접 사용하는 normalized 엔티티
Player
Season
Event
EventRegistration
Entry
EntryParticipant
BracketRuntime (Event-linked normalized runtime discriminator)
BracketEntrySlot (persisted actual draw)
BracketIdentityChange (runtime ownership / rollback metadata)
Match (Event-linked normalized formed Match)
Result (Event-linked 개인 Entry·Team Entry final placement)
RankingAward (Event-linked Master / Light 개인·팀전 runtime placement payout)
P2-5~P2-7에서 official submission write, final Records projection, normalized bracket runtime의
운영 source of truth로 전환한 엔티티
RegistrationSubmission
TeamSnapshot
TeamSnapshotMember
RankingBaseline
ChampionshipAdvancement
Title 관련 구조
HallOfFame 관련 구조

Production migration 전까지 legacy ypl_data_v4를 유지한다.

4. 완료된 normalized foundation
P0. 신청 → 기록 normalized end-to-end 완성 — Test 기준 완료

목표:

신청
→ EventRegistration
→ 참가 확정
→ Entry / EntryParticipant
→ Bracket
→ Match
→ Result
→ RankingAward
→ Records
1단계 — Entry 연결 — 구현 및 Test DB E2E 완료
EventRegistration에서 실제 참가자 확정
개인전 Entry 생성
EntryParticipant 생성
Bracket participant를 Entry ID 기준으로 연결
불참자 제외
수동 참가자 처리
2단계 A — normalized Match — 구현 및 Test DB E2E 완료
Bracket 생성·결과 변경 → Match snapshot 동기화
record apply 직전 final sync
record revert에서는 실제 경기 Match 유지
2단계 B-1 — normalized Result — 구현 및 Test DB E2E 완료
최종 성적 → Result 생성
Entry ID 기반 idempotent sync
historical Result 보호
반영 취소 / 재반영 Result lifecycle

2단계 B-2 — normalized RankingAward — 구현 및 Test DB E2E 완료
실제 지급 포인트 → RankingAward 생성
Rookie rankingEnabled=false 정책 적용
Light / Master 랭킹 반영
중복 반영 방지
Master 60 / 40 / 20, Light 30 / 20 / 10 canonical policy를 legacy와 공유
Test DB placement unique index 적용
Test DB anon CRUD GRANT 적용 및 재조회 확인
3단계 — 반영 취소 / 재반영 — 구현 및 Test DB E2E 완료
normalized Match 유지, Result / RankingAward 원복
Event lifecycle 원복
Entry identity 보존 정책 확정
재반영 시 중복 데이터 생성 방지
4단계 — Records 전환 — 구현 및 Test DB 브라우저 E2E 완료
Records가 normalized Event / Entry / Result를 직접 읽도록 전환
Trainer 기록 연결
Event 상세 연결
Pokémon 통계 연결
RankingAward 기반 랭킹 전환

완료 조건:

  P0/P1은 normalized identity, Match/Result/RankingAward runtime, normalized Records read,
  개인전·팀전 E2E를 포함한 **normalized competition lifecycle foundation** 완료를 의미한다.
  P2-7에서 Event-linked Single / Double / Team bracket runtime까지 normalized cutover를 완료했으며,
  Production과 historical/legacy-only 영역의 legacy 의존은 별도 compatibility 경계로 남아 있다.

P1. 팀전 normalized 연결 — Test 기준 완료

개인전 normalized end-to-end에 이어 팀전 Event-linked write 흐름을 연결한다.

P1-1 — Team Entry / EntryParticipant identity — 구현 및 Test DB E2E 완료
EventRegistration의 registration_data.answers 팀 지망 정보 표시
기존 수동 팀 편성 UI에서 최종 팀 구성 확정
Team Entry 생성
멤버별 EntryParticipant 생성
Player identity 확정
legacy 팀 participant에 normalized identity metadata 연결
Event running 전환
기록 반영 전 삭제 rollback
삭제 후 재생성 시 중복 방지

P1-2 — normalized team Match — 구현 및 Test DB E2E 완료
팀 대 팀 parent bracket Match 생성
실제 출전 Player 기준 team_bout 생성 및 legacy 결과 동기화
팀장 identity는 EntryParticipant role='captain'으로 보존
canonical 팀 명단과 실제 경기 lineup 분리
경기별 출전자 변경 및 동일 선수 복수 경기 출전 지원
모든 예정 개인전 결과 입력 후 팀 경기 확정
동점 시 내부 ace Match 생성, UI에서는 타이브레이커로 표시
타이브레이커 출전자 변경 가능
stable source_node_key 기반 update 및 played_at 보존/갱신 검증
downstream stale Match 정리 및 legacy 저장 실패 compensation 검증
P1-3 — Team Result / player RankingAward — 구현 및 Test DB E2E 완료
Team Entry 단위 Result 생성
입상 Team Entry의 공식 멤버별 RankingAward 생성
Team Master 우승 30 / 준우승 20, Team Light 우승 15 / 준우승 10을 선수별 고정 지급
팀전 4강은 Result만 보존하고 RankingAward는 생성하지 않음
팀전 RankingAward는 points-only로 기록하고 개인 우승·준우승·4강 횟수는 증가시키지 않음

P1-4 — team record lifecycle — 구현 및 Test DB E2E 완료
팀전 기록 반영 / 취소 / 결과 변경 / 재반영 lifecycle 검증
normalized Result / RankingAward와 legacy 랭킹·시즌 기록의 동시 반영 및 rollback 검증
반영 취소 시 Match / Entry / EntryParticipant identity는 유지하고 Result / RankingAward / legacy 기록만 제거
경기 결과 변경 후 재반영 시 새 우승·준우승 결과와 점수를 중복 없이 재생성
팀전 점수 정책을 preview / legacy write / normalized RankingAward에서 동일하게 적용

P1-5 — Records normalized team read 및 전체 E2E — 완료 / Test

Event-linked canonical 팀전 write는 P1-4까지 완료했고, P1-5에서 Records read를 팀전까지 확장했다.
completed + record_applied_at Event를 개인전·팀전 모두 normalized Records read 대상으로 포함한다.
Team Entry당 Result 1개를 EntryParticipant를 통해 각 Player profile history로 펼친다.
팀 history는 팀 우승 / 팀 준우승 / 팀 4강으로 표시하고, 팀 placement는 개인 wins / runnerUps / top4 count에서 제외한다.
Team RankingAward는 저장된 ledger를 그대로 읽으며 Team Master 30 / 20, Team Light 15 / 10의 points-only 정책과 0 placement count delta를 유지한다.
팀 4강 Result는 보존할 수 있고 RankingAward는 생성하지 않는다.
normalized team Event와 명시적으로 연결된 legacy tournament round의 placement / history / archive 중복을 제거한다.
linked legacy team bracket은 roster / Pokémon / 기존 Match compatibility source로 유지하며, 그 bracket의 placement / history는 normalized team 기록과 중복하지 않는다.
legacy-only 팀전과 normalized individual Records dedupe / fallback은 기존 동작을 유지한다.
Records 일반 사용자 화면에서는 source metadata와 raw 내부 code를 표시하지 않으며, team_bout / ace 상세 UI는 P1-5 범위에 추가하지 않았다.
Test DB 브라우저 E2E와 local acceptance audit을 완료했다.

P1 전체(P1-1 ~ P1-5)는 Test 환경 기준 완료했다.

P2-1 Team Builder foundation, P2-2 Event context + submission eligibility + applicant lookup,
P2-5 실제 공식 파티 제출, P2-6 final submission freeze + Records integration은 Test 기준 완료했다.
관련 RPC와 normalized runtime은 Production에 적용하지 않았다.

P2. Team Builder → 공식 파티 제출

신청→기록 normalized 운영 흐름에 연결한 상태다.

Team Builder
→ TeamSnapshot v1
→ RegistrationSubmission
→ EventRegistration
→ Entry

진행 상태:

- P2-1 Team Builder foundation ✅
- P2-2 Event context + submission eligibility + applicant lookup + operator submission-status read UX ✅
- P2-5 실제 공식 파티 제출 ✅
- P2-6 final_submission_id freeze + Records integration ✅
- P2-7 Event-linked Bracket normalized cutover ✅ Test 기준 완료

P2-1의 serializer / loader는 local과 official Snapshot 경계를 준비하는 pure foundation이며,
개인 localStorage 저장본과 공식 제출 Snapshot은 분리한다.

P2-7 — Event-linked Bracket normalized cutover ✅ Test 기준 완료

- Single Elimination: pure projection, persisted draw, stable node key, winner lifecycle,
  BYE advancement, stale invalidation, normalized Result apply
- Team: 기존 Team Entry / EntryParticipant / captain / team_bout / ace 구조를 재사용한
  normalized runtime create, projection, winner/series change와 stale cleanup
- Double Elimination: Winners/Losers Bracket, Grand Final, Reset Final projection/runtime 및
  upstream winner 변경에 따른 downstream stale cleanup
- malformed normalized runtime은 fail closed하며 historical / legacy-only bracket은 compatibility path로 유지
- Production migration은 별도 후속 단계이며 아직 수행하지 않음

P3. Champions core runtime — Test 기준 완료

Champions는 별도 tournament engine이 아니라 기존 normalized competition lifecycle을 재사용하고,
Champions-specific orchestration만 추가한다.

```text
Champions Series N
├─ Qualifier Event
└─ Final Event
```

- Qualifier와 Final은 Player identity만 공유하며 EventRegistration, Entry, EntryParticipant,
  RegistrationSubmission, TeamSnapshot, Match, Result는 각각 독립적으로 보존한다.
- Qualifier와 Final의 실제 참가자는 모두 운영자가 수동 확정한다. 시즌 랭킹 Top N, qualifier Top N,
  불참자에 대한 자동 차순위 승계·substitute는 사용하지 않는다.
- `ChampionshipAdvancement`의 source는 `ranking`, `qualifier`, `manual`이며 자동 판정 결과가 아니라
  운영자가 선택·확정한 실제 진출 경로를 기록한다.
- advancement 확정 시 `ChampionshipAdvancement`와 `Final EventRegistration(registration_source=advancement)`만
  만들고 Final Entry는 만들지 않는다. Final Entry / EntryParticipant는 실제 Final bracket 생성 시 만든다.
- 불참 시 기존 advancement를 운영자가 취소하고 새 대상자를 직접 등록한다. downstream Submission, Entry,
  EntryParticipant, Match, Result, RankingAward 또는 runtime state가 있으면 cascade delete하지 않고 fail closed한다.
  Player와 Qualifier source facts는 보존한다.
- Qualifier는 `qualification_slots`만큼 advancement가 확정되면 종료할 수 있으며, 종료는 선발 과정 종료를
  의미한다. Qualifier의 Event, 등록·Entry·참가자·Submission·TeamSnapshot, 실제 Match와 winner facts,
  advancement, Records 참가 이력은 보존하지만 Result, RankingAward, HallOfFameEntry는 만들지 않는다.
- Final은 기존 normalized Event 흐름인 `EventRegistration → Entry / EntryParticipant → Match → Result →
  RankingAward → final_submission_id freeze → Records → Event completed`를 사용한다. `battle_format`과
  `competition_format`은 별도 필드다.
- Final champion Result가 공식 확정되면 `HallOfFameEntry`를 연결한다. `generation`은
  `competition_settings.championship.generation`을 authoritative source로 사용하고, 기존
  `generationNumber`는 compatibility 용도로만 읽는다. 서비스 전역 hardcoded generation default는 제거했으며,
  현재 YPL 시즌 3 Champions Event 설정은 generation 7이다.
- 신규 Champion party는 Final의 official TeamSnapshot에서 `pokemon_id`를 읽어 sprite로 렌더링하며,
  기존 `image_ref`는 legacy compatibility로 유지한다.

### Champions 검증 경계

Qualifier / advancement / Final / HOF의 핵심 CRUD와 관계는 Test DB smoke까지 완료했다. Champions의
exhaustive browser E2E는 기능 blocker가 아니라 최종 통합 QA 항목으로 이월한다. Production migration은
수행하지 않았다.

## 다음 우선순위

1. YPL Season 자동 전환
2. Team Builder 운영 UX / 안정화
3. 전체 기능 통합 QA / 실제 운영자 수동 검증
4. Production Cutover
5. Auth/RLS security hardening

Production Cutover와 Auth/RLS의 실제 순서는 최종 운영·코드 상황에 따라 조정할 수 있다.
2026-09-20 Team Event 일정 때문에 Team 기능이 중요했지만, P2-7 Team runtime이 Test 기준
완료된 현재 별도 Team architecture phase는 만들지 않는다.

### YPL Season 자동 전환 설계 — 다음 작업

아직 구현하지 않은 다음 구조 변경이다. YPL series에 한해 DB/server-side scheduler가 Asia/Seoul 기준
매년 `03/01 00:00 KST`, `09/01 00:00 KST` boundary에서 Season number를 1 증가시킨다.

- 목표 예: YPL Season 3은 2026-09-01, Season 4는 2027-03-01, Season 5는 2027-09-01 시작
- Browser local time이나 사용자 접속 시점에 의존하지 않는다.
- YPL series에는 정확히 하나의 `current` Season만 존재해야 하며, 기존 current 해제와 다음 Season current
  활성화를 하나의 idempotent operation으로 처리한다.
- 같은 boundary의 중복 실행과 concurrent 실행에서도 중복 Season 생성·이중 증가가 없어야 하며, 과거 Season의
  row·number는 수정하지 않는다.
- 기존 Event의 `season_id`는 immutable historical fact로 보존한다. rollover 이후 신규 Event만 새 current
  YPL Season을 참조한다.
- 다음 Season을 미리 생성해 상태만 바꾸는 방식과 boundary transaction에서 deterministic하게 생성하는 방식 중
  기존 schema/운영 구조에 맞는 최소 구현을 선택한다. `number`, `starts_on`, code/name convention,
  current uniqueness, retry idempotency는 반드시 보장한다.
- Classic 등 다른 series에는 YPL 자동 rollover를 강제하지 않으며, 과거 날짜 기준 Season 재구성도 하지 않는다.

Production 적용은 아직 하지 않았다.

### Team Builder 운영 UX / 안정화 방향

검색·form identity·Regulation validation·모노타입·저장/복원 UX를 운영 흐름에 맞게 안정화한다.
Replica Team ID Import는 resolver 확보 여부를 확인한 뒤 별도 판단한다.

Production Cutover와 Auth/RLS hardening은 Test 검증, 백업, 권한 설계가 갖춰진 뒤 진행한다.

5. 완료된 기반 작업
운영 데이터 조사
Production site_data / ypl_data_v4 백업
Supabase 프로젝트 접근 확보
테이블 / 권한 / Auth 구조 조사
legacy 데이터 구조 인벤토리
과거 기록 복구 가능 범위 1차 분류
full_match   3회
placement   48회
winner_only  6회
normalized DB / migration
normalized schema 작성
YPL_DB_Test 구축
legacy migration generator 작성
ypl_data_v4 migration 회귀 검증
Player identity 검증
Registration 구조 검증
historical TeamSnapshot migration 검증
recoverable Match migration 검증
RankingBaseline 검증
Title / Partner / HOF migration 검증
팀전 지망 데이터 구조 검증
ace Match 구조 검증

migration 검증 완료와 실제 사이트 runtime 연결 완료는 구분한다.

6. 보류 / 추후 결정
Replica Team ID Import

Team Builder 공식 제출 흐름까지 안정된 이후 진행한다.

Title automation

Champions Final champion의 HallOfFameEntry 연결까지는 완료했지만, `N대 챔피언` 칭호와 기타
TitleDefinition / TitleAward의 AUTO / REVIEW 자동 지급은 구현하지 않았다. YPL 시즌 3의 후속 대상은
`7대 챔피언`이며, 현재 next priority가 아닌 후순위로 유지한다.

Battle Data

`Battle Data`는 Pokémon Champions 전체 메타 통계 데이터를 조회·분석하는 외부/광범위 메타 기능을
뜻한다. 현재 YPL Records/통계(trainer records, tournament history, Pokémon 사용 통계, Ranking,
Result, Team history)와는 별개다. 데이터 확보와 실제 활용 타당성 문제로 현재 개발 계획에서는
제외하며, 재개하더라도 최하위 우선순위로 둔다.

Tera Type

현재 TeamSnapshot v1에는 포함하지 않는다.

향후 실제 Regulation에서 필요하면 확장한다.

개인 W/L 공개

Match 원본은 보존하지만 기본 프로필에서는 공개하지 않는다.

RankingAward 수정 이력

최종 지급값은 반드시 보존한다.

향후:

기존 Award 수정
vs
원 지급 + adjustment ledger

중 운영 방식에 맞춰 결정한다.

7. 운영 안전 원칙
Production 운영 데이터의 기준 원본은 Supabase ypl_data_v4
GitHub SEED를 운영 원본으로 간주하지 않음
운영 데이터 변경 전 백업
Production DB는 Test 검증 전 수정하지 않음
과거 기록을 추측해 생성하지 않음
통계 숫자보다 Event / Entry / Match / Result 원본 사실을 우선
개인 Team Builder 저장본을 공식 대회 기록 원본으로 직접 사용하지 않음
대진표 결과 수정은 기본적으로 반영 취소 → 수정 → 재반영
schema 설계 완료와 runtime 구현 완료를 구분해서 기록

상세 구조는 docs/ARCHITECTURE.md에서 관리한다.

8. 개발 검증 전략

소단계 개발 중에는 targeted tests, 대표 happy-path smoke, DB/RPC 변경 시 최소 Test smoke,
build, `git diff --check`를 기본으로 한다. 모든 소단계마다 exhaustive E2E를 반복하지 않는다.

큰 기능이 완성된 뒤 통합 browser E2E, 주요 edge case, 실제 운영 흐름 QA를 묶어서 수행한다.
최종 배포 전 운영자는 신청 → 파티 제출 → 대진표 생성 → 경기 진행 → 결과 변경/cancel → 기록
반영 → Records → revert → 재수정 → 재반영 → 삭제의 전체 흐름을 수동 확인한다.

Production migration, destructive DB migration, data-loss 가능 delete/rollback, 권한/RLS 변경은
중간 단계에서도 보수적으로 검증한다. 이는 테스트를 생략하는 것이 아니라 중복 exhaustive 검증을
기능 완료 시점으로 묶는 전략이다.
