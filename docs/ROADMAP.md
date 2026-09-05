# YPL 개발 로드맵

> 이 문서는 **현재 구현 상태와 앞으로의 개발 순서**만 관리합니다.
>
> - 과거 변경 이력: `docs/PATCH_NOTES_2026-08-26.md`
> - 기술 구조·데이터 모델·운영 원칙: `docs/ARCHITECTURE.md`

마지막 업데이트: 2026-09-05

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

현재는 legacy 운영 데이터와 normalized DB가 함께 동작하는 전환 단계다.

normalized
Player
Season
Event
EventRegistration
Entry
EntryParticipant
Match (Event-linked 개인전·팀전 runtime mirror)
Result (Event-linked 개인 Entry·Team Entry final placement)
        │
        ▼
현재 연결 경계
        │
        ▼
legacy ypl_data_v4
Bracket
Round / Result
Ranking
Season Record
Records

전체 Production 운영 데이터는 아직 Supabase public.site_data / ypl_data_v4 의존이 존재한다.
다만 Test에서 normalized runtime으로 전환된 신규 Event-linked 사실(Player, Season, Event,
EventRegistration, Entry, EntryParticipant, Match, Result, RankingAward)은 normalized model을
canonical target으로 취급한다. Bracket graph / round / legacy ranking write 등 일부 영역은
아직 ypl_data_v4와 hybrid로 동작하며, Production normalized migration은 적용하지 않는다.

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
기존 legacy 기능
싱글 엘리미네이션
더블 엘리미네이션
리그전
legacy 팀전
경기 결과 저장
기록 반영 완료 대진표 잠금
반영 취소 → 수정 → 재반영
normalized Event 연결 — 개인전 구현 완료 + 팀전 P1-1 identity 구현 완료 / Test
Event 선택
→ EventRegistration 조회
→ 신청자 기본 참가
→ 불참자 제외
→ 필요 시 수동 참가자 추가
→ 전체 identity preflight
→ Player / Registration 확정
→ Entry / EntryParticipant 생성
→ 실제 성립 경기 normalized Match 생성
→ Bracket 생성
→ Event running
→ Event / Registration / Player / Entry ID 보존

현재 Bracket participant는 legacy graph용 participant ID를 유지하면서
`registrationId / playerId / entryId / entryParticipantId`를 함께 보존한다.

Event 연결 개인전의 실제 경기는 legacy Bracket JSON과 normalized `matches`에 이중 저장한다.
BYE, 한쪽 참가자가 아직 결정되지 않은 경기, 비활성 reset final은 normalized Match에서 제외한다.
승자 선택·취소·변경과 Group 본선 생성은 `source = legacy_bracket_runtime` 범위에서 동기화한다.

Event 연결 개인전은 Event당 Bracket 하나만 허용한다.

기록 반영 전 Bracket 삭제 시 해당 Bracket의 참가 확정 metadata를 기준으로
Entry / EntryParticipant와 이번 확정에서 만든 identity 변경을 원복한다.

팀전 P1-1 구현 완료 — Test
EventRegistration의 실제 신청자와 팀 지망 답변 표시
기존 수동 팀 편성 UI를 이용한 최종 팀 구성
팀별 Team Entry 생성
멤버별 EntryParticipant 생성
Player / Registration identity 확정
legacy 팀 participant에 entryId / memberIdentities 보존
기록 반영 전 삭제 시 Entry / EntryParticipant / 이번 확정 identity 원복

Event-linked canonical 팀전의 Match / Result / RankingAward / 기록 반영은 P1-4까지 구현 및 Test DB E2E를 완료했다.
P1-5에서 normalized completed 팀전 Event의 Records read와 개인 / 팀 placement count 분리를 구현하고 전체 E2E를 완료했다.

기존 legacy-only 팀전은 유지한다.

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

P2-7 Event-linked Bracket normalized cutover 예정

- normalized `Entry / EntryParticipant / Match` 기반 Bracket UI projection과 Event-linked Bracket lifecycle을
  canonical runtime으로 전환한다.

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
Match (Event-linked 개인전·팀전 runtime mirror)
Result (Event-linked 개인 Entry·Team Entry final placement)
RankingAward (Event-linked Master / Light 개인·팀전 runtime placement payout)
P2-5/P2-6에서 official submission write 및 final Records projection의 운영 runtime source of truth로 전환한 엔티티
RegistrationSubmission
TeamSnapshot
TeamSnapshotMember
RankingBaseline
ChampionshipAdvancement
Title 관련 구조
HallOfFame 관련 구조

Production migration 전까지 legacy ypl_data_v4를 유지한다.

4. 개발 우선순위
P0. 신청 → 기록 normalized end-to-end 완성

현재 최우선 작업이다.

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

P0/P1은 normalized identity/write mirror, Match/Result/RankingAward runtime, normalized Records
read, 개인전·팀전 E2E를 포함한 **normalized competition lifecycle foundation** 완료를 의미한다.
Event-linked Bracket graph와 일부 round / ranking / season legacy write 의존은 남아 있으며,
이를 전환하는 단계는 P2-7에서 별도로 수행한다.

P1. 팀전 normalized 연결

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

P2-1 Team Builder foundation, P2-2 Event context + submission eligibility + applicant lookup 및
operator submission-status read UX, P2-5 실제 공식 파티 제출은 Test 기준 완료했다. P2-5 RPC는
Production에 적용하지 않았다.

P2. Team Builder → 공식 파티 제출

신청→기록 normalized 운영 흐름을 먼저 완성한 뒤 연결한다.

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
- P2-7 Event-linked Bracket normalized cutover 예정

P2-1의 serializer / loader는 local과 official Snapshot 경계를 준비하는 pure foundation이다.
P2-2 당시에는 Event context, applicant Registration confirmation, official eligibility와 운영자 제출 상태
read만 구현했으며 공식 Submission 생성이나 DB write를 수행하지 않았다.

개인 localStorage 저장본과 공식 제출 Snapshot은 분리한다.

P2-7 — Event-linked Bracket normalized cutover

P2-5와 P2-6 이후, Champions 구현 전에 Event-linked 신규 대진표의 hybrid 의존을 줄이는 전환 단계다.

- normalized `Entry / EntryParticipant / Match` 기반 Bracket UI projection
- 신규 Event-linked Bracket의 canonical 운영 사실을 normalized DB로 이동
- legacy dual-write 의존 축소·제거 및 create / result change / delete lifecycle 단일화
- legacy Bracket은 historical / legacy-only compatibility로 제한
- 기존 Records fallback과 과거 대회 데이터는 보존
- Production migration은 별도 후속 단계

P2-7은 아직 구현되지 않았다.

P3. 챔피언스 운영

설계 방향:

선발전과 본선은 별도 Event
advancement 확정 시 본선 EventRegistration 생성
본선 Entry는 실제 대진표 생성 시 생성
선발전 / 본선 TeamSnapshot 독립

구현:

qualifier / final Event 연결
qualification slots
ranking / qualifier / manual advancement
관리자 진출자 관리
본선 Registration 자동 생성
선발전 종료 처리
본선 결과 → HallOfFameEntry
기록 → Title AUTO / REVIEW 후보
P4. Team Builder 자체 안정화 / 추가 UX

공식 운영 흐름 이후 정리한다.

Pokémon 검색 / 이름 데이터 정리
species / form / regional identity 검증
Regulation validation
도구 validation
모노타입 기능
저장 / 복원 UX 회귀
과거 우승 팀 열기
저장 팀 공유 / 복제

Replica Team ID Import는 이 단계 이후 진행해도 무방하다.

P5. Auth / RLS / Production 전환

기능 구조가 안정된 뒤 진행한다.

전체 회귀 테스트
normalized / legacy 데이터 대조
migration 재실행 검증
Auth 정책 확정
RLS 정책 확정
browser 직접 write 권한 축소
필요한 server-side transaction / RPC 설계
Production migration 계획
Production 백업
Production 적용

Production Supabase는 이 단계 전까지 변경하지 않는다.

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

Battle Data

Pokémon Champions 전체 메타 통계는 현재 우선순위에서 제외한다.

먼저 YPL 내부 Event / Entry / Match / Result 기록을 완성한다.

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

8. 바로 다음 작업
현재 브랜치
feature/records-system

이번 브랜치에서 구현
✓ 신청 공지 → Event
✓ 신청 → EventRegistration
✓ 개인전 Event → Bracket
✓ Bracket 생성 시 Player / Registration identity 확정
✓ 개인전 Entry / EntryParticipant 생성
✓ participant.entryId 연결
✓ Bracket 삭제 시 참가 확정 rollback
✓ Event당 연결 Bracket 중복 생성 차단
✓ Master / Light / Rookie 기록 정책
✓ Event completed / record_applied_at lifecycle
✓ 기록 반영 취소 및 identity 원복
✓ legacy 저장 실패 시 identity rollback
✓ Test apply / revert / reapply E2E
✓ P0-4 Bracket 결과 → normalized Match runtime sync
✓ Single / Double / Group / Group→Knockout snapshot
✓ winner toggle/change, downstream cascade, reset activation/deactivation sync
✓ Bracket 삭제 전 runtime Match FK 선행 정리
✓ record apply 직전 final Match sync / revert 시 Match 유지
✓ P0-1~P0-4 실제 Test E2E
✓ P0-5 Entry ID 기반 normalized Result snapshot / idempotent sync
✓ Result apply / revert / reapply 보상 흐름
✓ historical `legacy_tournament` Result 보호
✓ Double Elimination Result apply → revert → 결과 변경 → reapply Test E2E
✓ Single Elimination Result apply → revert Test E2E
✓ P0-6 Master 60 / 40 / 20, Light 30 / 20 / 10 canonical point policy
✓ Rookie / rankingEnabled=false RankingAward 0건 정책
✓ Result.entry_id → EntryParticipant.player_id 기반 placement Award snapshot
✓ runtime placement Award idempotent sync / stale cleanup / 다른 source·ledger 보호
✓ Award → Result FK 순서를 지킨 apply/revert compensation
✓ Test DB `(result_id, player_id)` placement partial unique index
✓ P0-6 pure helper test 및 production build
✓ Test DB `ranking_awards` anon CRUD GRANT 적용 및 재조회 확인
✓ Master RankingAward 60 / 40 / 20 apply → revert 브라우저 E2E
✓ Light RankingAward 30 / 20 / 10 apply → revert 브라우저 E2E
✓ Rookie Result 4건 / RankingAward 0건 apply → revert 브라우저 E2E
✓ Master / Light legacy 랭킹·시즌 delta와 normalized Award 점수 일치 확인
✓ application 4명 + manual 2명 혼합 참가 확정, Entry / EntryParticipant 6명 생성 확인
✓ Reset Final 포함 Match 11건 전체 played / duplicate node 0 확인
✓ 우승자 변경 후 reapply → 이전 champion Result/Award 제거, 새 Result/Award 4건만 생성
✓ 재반영 후 duplicate Result 0 / duplicate Award 0 및 legacy 랭킹·시즌 delta 일치 확인
✓ P0-8 completed + record_applied_at 개인전 Event normalized read boundary
✓ Player ID 기준 트레이너 / Result / 참가 이력 연결
✓ normalized Event와 연결된 legacy 회차·대진표 중복 표시 차단
✓ RankingBaseline + 전체 RankingAward ledger 및 count flag 기반 누적·시즌 랭킹
✓ final TeamSnapshot 우선 / 명시적 legacy party fallback
✓ Test DB `ranking_baselines` anon SELECT 적용 및 권한 재조회
✓ 제7회 파이컵라이트 Records 트레이너·대회·랭킹·포켓몬 브라우저 E2E
✓ P1-5 completed + record_applied_at 팀전 Event normalized Records read
✓ Team Result → EntryParticipant → Player profile history projection
✓ 팀 우승 / 준우승 / 4강 history와 개인 placement count 분리
✓ Team Master 30 / 20, Team Light 15 / 10 RankingAward ledger read
✓ linked legacy team bracket roster / Pokémon / Match compatibility 유지 및 placement/history/archive dedupe
✓ Records UI source metadata 및 raw internal code 비노출
✓ P1-5 Test DB browser E2E 및 local acceptance audit
✓ P2-1 Team Builder canonical identity / schema v3 / lossless restore
✓ P2-1 TeamSnapshot v1 serializer / loader foundation
✓ P2-1 saved team switching / new / duplicate UX 및 destructive change confirmation

바로 다음
1. P2-6 final_submission_id freeze + Records integration ✅

그 이후
2. P2-7 Event-linked Bracket normalized cutover
3. 챔피언스 운영 자동화
4. Team Builder 자체 안정화 / 추가 UX
5. Auth / RLS
6. Production migration
