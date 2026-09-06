# YPL 기술 구조 및 데이터 아키텍처

> 이 문서는 YPL 사이트의 **현재 기술 구조, 데이터 원본, 테스트 안전수칙, Records 데이터 모델 및 향후 migration 원칙**을 관리합니다.
>
> 현재 할 일과 우선순위는 `docs/ROADMAP.md`, 실제 변경 이력은 `docs/PATCH_NOTES_2026-08-26.md`를 봅니다.

마지막 업데이트: 2026-09-06

---

# 1. 시스템 구성

```text
GitHub / GitHub Pages
= 애플리케이션 코드 + SEED

Supabase
= 실제 공유 운영 데이터

Browser localStorage
= Team Builder 개인 저장 데이터
```

## 1.1 애플리케이션 구조

현재 주요 코드 책임은 다음과 같이 분리되어 있습니다.

```text
src/
├─ pages/        화면
├─ components/   공통 UI / layout
├─ admin/        관리자 UI
├─ services/     데이터·도메인 로직
├─ data/         정적 데이터
├─ storage.js    저장 위치 선택
└─ App.jsx       전체 조합
```

화면이 Supabase 구현을 직접 다루지 않고 서비스 / storage 계층을 통해 접근하는 구조를 유지합니다.

---

# 2. 운영 데이터 원본

전체 Production 운영 데이터는 아직 다음 legacy 저장소에 의존합니다.

```text
Supabase
table: site_data
key: ypl_data_v4
```

Test의 신규 Event-linked runtime에서는 normalized model을 canonical source of truth로 사용합니다.

```text
Player / Season / Event / EventRegistration
Entry / EntryParticipant
BracketRuntime / BracketEntrySlot / BracketIdentityChange
Match / Result / RankingAward
```

신규 Event-linked bracket의 actual draw는 `bracket_entry_slots`가 원본이며, Entry의 `seed`는
metadata로 별도 취급합니다. DB에는 persisted draw와 실제 formed Match/winner facts만 저장하고,
BYE·future Match·topology·advancement edge·Double losers movement·GF/Reset activation은 pure
projection으로 계산합니다. Production은 아직 normalized migration 전이므로 Test architecture 완료와
Production 적용 완료를 혼동하지 않습니다.

GitHub 코드의 SEED는 fallback 및 개발용 기본 데이터이며 자동 백업본이 아닙니다.

따라서 Production의 현재 데이터 판단은:

```text
운영 데이터 판단
Supabase > GitHub SEED
```

를 원칙으로 합니다.

## 2.1 현재 legacy 구조

`ypl_data_v4` 한 JSON 안에 여러 운영 데이터가 함께 존재합니다.

대표 영역:

```text
tournaments
brackets
rankings
seasons
champions
titleGroups
news / board / 기타 운영 데이터
```

Records 1차 버전은 새 테이블을 만들지 않고 이 데이터를 읽어 파생 기록을 계산했습니다.
Test의 P0-8부터 기록 반영이 완료된 normalized Event를 직접 읽으며, P1-5에서 개인전·팀전으로 범위를 확장했다. legacy-only 과거·팀전·챔피언스 기록은 기존 자료로 보완합니다.

---

# 3. 실행 환경과 테스트 안전수칙

## 3.1 Production

공식 GitHub Pages는 운영 Supabase를 사용합니다.

## 3.2 Beta Pages

개인 GitHub Pages production build도 운영 Supabase를 바라볼 수 있으므로 **조회 / UI 확인 전용**으로 취급합니다.

하지 않는 작업:

- 관리자 저장
- 공지 수정
- 대진표 기록 반영
- 칭호 / 명예의 전당 수정
- 기타 공유 운영 데이터 write

## 3.3 Local development

일반 Vite dev는 `.env.production`을 자동으로 읽지 않으므로 로컬 SEED 또는 localStorage 경로를 사용할 수 있습니다.

운영 Supabase 실제 데이터를 읽어 확인해야 할 때는 production build / preview를 사용하되 **read-only 검증**을 원칙으로 합니다.

---

# 4. Team Builder 저장 구조

현재 Team Builder의 개인 팀은 운영 `ypl_data_v4`와 분리합니다.

```text
YPL 운영 데이터
→ Supabase

Team Builder 개인 팀
→ Browser localStorage
```

기존 저장 키 호환성을 유지합니다.

Local saved team은 편집 가능한 working data이며 localStorage schema v3으로 보존합니다. 이는 공식 제출 데이터와 별개입니다. `savedTeams`, `activeSavedTeamId`, `draft`를 기반으로 팀 전환, 새 팀, 복제를 구분하며, 새 팀은 현재 Regulation / Cup / Type context만 유지하고 members는 비웁니다.

대회 엔트리 제출 기능을 추가할 때는 개인 작업본을 그대로 연결하지 않고 **제출 당시 Team Snapshot을 별도로 고정**합니다.
P2-1에서는 이 경계를 위한 local serializer / loader foundation을 구현했고, P2-2에서는 공식 제출을
판정하기 위한 Event context, applicant Registration lookup, eligibility, 운영자 제출 상태 read만 구현했다.
실제 공식 Submission DB write와 revision은 P2-5에서 구현했고, P2-6에서 `final_submission_id` freeze와
Records의 공식 Snapshot projection까지 완료했다.

### Team Builder identity 경계

- display name 및 localized name은 identity가 아니다.
- `pokemon_id`에는 실제 dataset에서 resolve 가능한 form-specific stable canonical ID만 사용한다.
- saved member를 복원할 때 resolve되지 않는 member는 삭제하지 않고 원본 name / ID / item / moves / stat을 보존한 unresolved 상태로 둔다.
- unresolved member가 있으면 official TeamSnapshot 생성을 차단한다.
- Regulation / Cup 변경으로 현재 편집 팀에서 illegal member가 제거될 때는 confirmation 후 기존 filtering semantics를 적용하며, saved team 원본과 current draft를 구분한다.

### P2-2 공식 제출 판정과 운영자 read 경계

P2-2 구현 완료 범위:

- Team Builder는 `?eventId=<event-id>` query convention으로 Event context를 열며,
  `regulation_id`, `cup_rule_id`, `cup_rule_settings`는 Event authoritative 값으로 고정한다.
  Event context에서는 Regulation / Cup 변경을 막고 P2-1 destructive-change confirmation semantics를 유지한다.
- free Team Builder mode는 기존대로 독립 동작한다.
- 참가자가 입력한 이름을 `trim(name)`한 뒤 해당 Event의 `registration_name` exact match로 조회한다.
  `registration_source`는 `application`, `advancement`, `manual`만 허용하고 `migration`은 제외한다.
  0건은 미발견, 1건은 선택, 2건 이상은 `YPL_AMBIGUOUS_REGISTRATION`으로 중단하며 fuzzy match와
  임의 선택은 금지한다. `player_id`가 NULL인 Registration도 제출용 lookup 대상이다.
- 기존 Team completeness validator와 official submission eligibility는 분리한다.
  Pokémon 1~6, 1~5마리, 기술 0~3개, 일부 ability/item 누락은 Regulation-invalid가 아니면 허용한다.
  Pokémon 0 / 6 초과, unresolved member, canonical Pokémon ID resolve 실패, Regulation/Cup/Species
  Clause/Item Clause/ability/item/move/Stat Points 위반, legality validation data 확인 불가는 차단한다.
  즉 `Incomplete != Invalid`이며 legality data 확인 불가는 fail closed다.
- `RegistrationSubmission` 존재 여부가 제출 상태 source of truth다. 최소 read model은
  `registrationId`, `registrationName`, `hasSubmission`, `latestRevision`, `latestSubmittedAt`를 가진다.
  개인전은 대진표 전후에 상태를 표시할 수 있고, 팀전은 팀 편성 modal이 아니라 대진표 생성 후
  `Team Entry → EntryParticipant → registration_id → EventRegistration → RegistrationSubmission`으로
  선수별 상태를 확인한다. revision 숫자는 기본 UI에 노출하지 않아도 된다.
- 미제출자는 Entry / Match에서 제거하지 않으며 참가 자체를 막지 않는다.

P2-2 당시 아직 구현하지 않았던 항목 (P2-5/P2-6 후속 완료):

- TeamSnapshot DB insert
- TeamSnapshotMember DB insert
- RegistrationSubmission DB insert
- revision write
- `final_submission_id` freeze
- result-apply submission freeze
- actual Submission → Records final snapshot E2E

위 항목은 P2-2 시점의 미구현 목록이다. 실제 Submission write / revision은 P2-5에서,
`final_submission_id` freeze와 Records final Snapshot projection은 P2-6에서 완료했다.

현재는 Auth/RLS가 없고 이름 exact match 기반 운영이므로, 이 단계의 귀속 표현은 Auth identity
verification이 아닌 **EventRegistration applicant lookup/confirmation**이다.

### P2-5 실제 공식 파티 제출

P2-5에서 Event-linked Team Builder의 실제 제출 write를 Test 환경에 연결했다.

- 공지의 `?view=builder&eventId=<event-id>` direct entry 후 EventRegistration exact-match를 거친다.
- `open / running`이고 `record_applied_at IS NULL`인 Event만 제출 가능하다. `completed` 또는 기록 반영 완료
  Event는 UI와 RPC 양쪽에서 차단한다. `submission_target_at`은 soft deadline이므로 이후 제출은 late warning만 낸다.
- 제출 RPC는 Event와 Registration을 row lock하고 Event의 `regulation_id`, `cup_rule_id`,
  `cup_rule_settings`를 authoritative source로 사용한다. 한 transaction 안에서 TeamSnapshot,
  TeamSnapshotMember, RegistrationSubmission을 생성하며 실패 시 rollback한다.
- 재제출은 기존 Snapshot / Submission을 UPDATE하지 않고 새 Snapshot과 새 Submission을 생성해 revision을
  증가시킨다. 기록 반영 전에는 `EventRegistration.final_submission_id`를 NULL로 유지하고, 기록 반영
  순간에만 latest Submission을 최종 pointer로 고정한다.
- 모노타입 `assignedType`은 참가자가 Team Builder에서 직접 고르는 local validation state다. Event 모드에서도
  Regulation / Cup Rule은 잠그되 assignedType은 잠그지 않으며, 공식 배정 사실로 EventRegistration / Snapshot에
  저장하지 않는다. unsupported Cup Rule은 fail closed 한다.
- Test `ypl_schema_validation`에서 team10 revision 1~3, soft deadline 이후 재제출, team1 제출현황을 검증했다.
  RPC는 Production에 적용하지 않았다.

P2-6에서 기록 반영 시 실제 `EntryParticipant.registration_id`에 해당하는 Registration의 latest
RegistrationSubmission을 `EventRegistration.final_submission_id`로 고정하고, 미제출 실제 참가자는 NULL로
둔다. 취소 시 pointer와 `team_revealed_at`을 해제하며, 재반영 시 최신 revision을 다시 고정한다. 과거
Submission / TeamSnapshot / TeamSnapshotMember는 immutable하게 보존한다. Records는 해당 pointer가 가리키는
immutable TeamSnapshot만 공식 파티로 사용한다. Event-linked Bracket normalized cutover는 P2-7에서
Test 기준 완료했으며, Production migration은 별도 단계로 남아 있다.

---

# 5. Records 데이터 원칙

## 5.1 원본 사실 우선

다음 계산 결과를 원본으로 저장하지 않습니다.

```text
A = 18승 11패
망나뇽 = 14회 사용
```

대신 다음 원본 사실을 보존합니다.

```text
Tournament
Entry
Match
Result
```

즉:

- 누가 참가했는가
- 어떤 엔트리를 제출했는가
- 누가 누구와 경기했는가
- 누가 이겼는가
- 어디까지 진출했는가

를 저장하고 통계는 여기서 계산합니다.

## 5.2 과거 데이터

없는 경기 기록을 추측하지 않습니다.

```text
full_match
= 전체 대진표가 있어 경기 단위 복원 가능

placement
= 입상 기록만 확인 가능

winner_only
= 우승자만 확인 가능

manual
= 별도 자료로 검증된 기록
```

## 5.3 Match 범위

YPL 시즌 3부터 기록에 반영된 대진표의 Match 원본을 사용합니다.

포함:

- 개인전
- 팀전 선발 경기
- 에이스 결정전
- 경기 단계
- 승자 / 패자
- 시즌 / 대회 구분

제외:

- BYE

팀전 Match에는 향후 개인전과 분리 집계할 수 있도록 팀전 문맥을 유지합니다.

## 5.4 공개와 저장의 분리

원본으로 저장했다고 모든 파생 통계를 공개하지는 않습니다.

기본 미공개:

- 개인 승 / 패
- 승률
- Rival / Head-to-Head
- 연승

기본 공개:

- 참가
- 우승 / 준우승 / 4강
- 전체 대회 이력
- 엔트리
- 칭호
- 명예의 전당

---

# 6. 대진표 → Records 연결

historical / legacy-only bracket에서는 legacy JSON 대진표 graph를 compatibility 원본으로 봅니다.
신규 Event-linked normalized runtime에서는 persisted draw slot과 formed Match/winner fact를
원본으로 보고, Bracket UI는 pure projection으로 계산합니다.

```text
persisted draw / Match winner 입력
→ Result / RankingAward sync
→ final submission freeze
→ legacy compatibility 기록 반영
→ Records 계산
```

반영이 완료된 대진표는 잠급니다.

수정 절차:

```text
반영 취소
→ 연결 기록 원복
→ 대진표 수정
→ 다시 기록 반영
```

대진표에서 생성된 회차를 직접 수정할 경우 graph와 결과가 달라질 수 있으므로 장기적으로 직접 편집 제한을 검토합니다.

---

# 7. 최종 성적 파생 규칙

## 싱글 엘리미네이션

```text
우승
준우승
4강
8강
16강
...
```

실제 탈락 라운드 기준으로 계산합니다.

BYE는 한 라운드를 이긴 것으로 보지 않습니다.

## 더블 엘리미네이션

두 번째 패배로 탈락한 시점을 기준으로 최종 순위를 계산합니다.

예:

```text
우승
준우승
3위
4위
공동 5위
공동 7위
```

같은 elimination batch에서 탈락하면 공동 순위가 될 수 있습니다.

Grand Final Reset 구조를 고려합니다.

## 조별리그 + 본선

본선 진출자는 본선 결과를 사용합니다.

비진출자는 현재:

```text
조별리그 탈락
```

으로 기록합니다.

현 조별리그 코드의 동률 처리 기준이 충분히 구조화되기 전에는 정확한 `조 3위` 같은 표시는 만들지 않습니다.

## 팀전

팀의 최종 성적을 각 팀원 기록에 연결합니다.

예:

```text
팀 우승
팀 준우승
팀 4강
팀 8강
```

팀전 입상은 팀 이력으로 보존합니다. canonical 정책상 팀전 placement는 해당 트레이너의 개인 우승·준우승·4강 count에 포함하지 않습니다.
Records projection은 팀전 placement를 팀 history로 보존하되 개인 우승·준우승·4강 count에서는 제외합니다. 이 분리는 P1-5에서 legacy snapshot, normalized merged projection, Records profile hero에 일관되게 적용했습니다.

---

# 8. 챔피언스 시리즈

챔피언스 시리즈 회차 번호는 별도 계산하지 않습니다.

source of truth:

```text
tournaments[].rounds[].round
```

`champ = true`는 해당 회차가 Champions라는 사실만 의미합니다.

```text
round = 8
champ = true
→ 챔피언스 시리즈 8회
```

---


## 8.1 선발전과 본선

챔피언스 시리즈는 필요에 따라 **선발전(Event)과 본선(Event)을 별도로 운영**합니다.

두 Event는 같은 챔피언스 회차에 속하지만 경기와 제출 데이터는 독립적으로 관리합니다.

```text
챔피언스 시리즈 N회
├─ 선발전 Event
└─ 본선 Event
```

분리 이유:

- 선발전과 본선은 서로 다른 파티를 사용할 수 있습니다.
- 따라서 `EventRegistration`, `Entry`, `EntryParticipant`, `RegistrationSubmission`, `TeamSnapshot`, `Match`,
  `Result`를 서로 공유하지 않습니다.
- 선발전 통과 시 본선에는 `registration_source = advancement`인 새 Registration을 만들고, 본선 파티를 새로 제출합니다.
- 본선 Entry / EntryParticipant는 실제 본선 bracket을 생성할 때 그 Registration에서 생성합니다.
- 선발전의 TeamSnapshot을 본선으로 복사하거나 재사용하지 않습니다.

같은 Player가 두 Event에 참가하는 것은 정상이며, Player 식별자만 동일하게 유지합니다.

## 8.2 선발전의 목적과 종료 조건

선발전은 우승자를 정하는 별도 대회가 아니라 **지정된 수의 본선 진출자를 선발하기 위한 예선 단계**입니다.

예:

```text
본선 정원 8명
├─ 시즌 순위 등을 참고해 운영자가 직접 본선 직행 4명 결정
└─ 선발전에서 추가 진출자 4명 선발
```

참가 확정은 자동 선발 로직이 아니라 운영자 수동 확정이다.

- 당시 시즌 순위와 운영 규정을 참고하여 운영자가 본선 직행자를 직접 결정합니다.
- 선발전 참가자와 본선 진출자 모두 운영자가 마지막에 실제 참가자로 직접 확정합니다.
- 시즌 랭킹 Top N 또는 qualifier Top N의 자동 진출을 사용하지 않으며, 불참 시 자동 차순위 승계나 substitute도 사용하지 않습니다.
- 선발전은 `qualification_slots`에 해당하는 인원이 확정되면 종료할 수 있습니다.
- 선발 인원은 회차별 수요와 운영 규정에 따라 달라질 수 있습니다.
- 선발전은 반드시 1명의 최종 우승자를 만들 필요가 없습니다.

## 8.3 선발전 기록 정책

선발전의 실제 경기는 Match 원본으로 저장합니다.

포함:

- Qualifier Event / EventRegistration
- 참가 Entry
- EntryParticipant
- 참가 Player
- 제출 TeamSnapshot
- RegistrationSubmission
- 실제 Match
- 승자 / 패자
- `ChampionshipAdvancement`
- Records의 qualifier 참가 이력

선발전 Match는 **트레이너의 공식 승 / 패 경기 기록에는 포함**합니다.

반면 선발전은 최종 입상 대회가 아니므로 다음 데이터는 생성하지 않습니다.

```text
Result
- 우승
- 준우승
- 4강

RankingAward
HallOfFameEntry
챔피언 기록
```

즉:

```text
선발전 Match
→ 승 / 패 통계 반영 O
→ 랭킹 포인트 반영 X
→ 우승 / 준우승 / 4강 기록 X
```

선발전에서 여러 명이 본선에 진출하더라도 이들을 1위, 2위, 3위, 4위로 강제 분류하지 않습니다. 모두 **본선 진출자**로만 취급합니다.

## 8.4 본선 진출 관계

본선 진출은 `ChampionshipAdvancement`로 기록한다. 이 row는 자동 판정 결과가 아니라 운영자가 선택·확정한
실제 진출 경로와 대상을 기록한다.

진출 경로:

```text
ranking
= 시즌 순위 등을 근거로 운영자가 본선 직행 처리

qualifier
= 선발전을 통과하여 본선 진출

manual
= 기권 대체 등 운영상 예외
```

advancement 확정 시:

```text
ChampionshipAdvancement
→ Final EventRegistration(registration_source = advancement)
→ 실제 Final bracket 생성 시 Final Entry / EntryParticipant
```

Final Entry는 advancement 확정 시 미리 만들지 않는다. `ranking`은 시즌 순위 등을 참고해 운영자가 직접
직행 처리한 경로, `qualifier`는 Qualifier 통과를 운영자가 직접 확정한 경로, `manual`은 기권 대체 등
운영 예외 경로다.

이 관계는 **Player의 진출 경로를 설명하기 위한 기록**이며 TeamSnapshot을 연결하거나 복사하기 위한 관계가 아니다.

불참으로 advancement를 취소할 때는 운영자가 기존 대상을 취소한 뒤 새 대상을 직접 등록한다. downstream
Submission, Entry, EntryParticipant, Match, Result, RankingAward 또는 runtime state가 있으면 cascade
delete하지 않고 취소를 거부한다(fail closed). downstream이 없는 runtime-owned Final Registration만
안전하게 정리할 수 있으며, 기존 Player와 Qualifier source facts는 보존한다.

## 8.5 명예의 전당

명예의 전당은 **챔피언스 본선 Event의 champion Result가 공식 확정된 우승자만** 대상으로 합니다.

선발전에서 마지막까지 남거나 본선 진출을 확정한 사실은 명예의 전당 또는 챔피언 획득으로 처리하지 않습니다.

`HallOfFameEntry`의 generation source는 `competition_settings.championship.generation`이다. 기존
`generationNumber`는 compatibility 용도로만 읽으며, YPL 시즌 3 Champions Event에는 `generation = 7`을
명시한다. 서비스 전역 hardcoded generation default는 제거했다. 한 generation에 Singles / Doubles champion이
각각 존재할 수 있고 battle format은 `HallOfFameEntry → Event.battle_format`으로 판별한다.

신규 Champion party는 이미지 업로드가 아니라 다음 관계에서 official TeamSnapshot을 읽어 sprite로 렌더링한다.

```text
HallOfFameEntry
→ Result
→ Entry
→ EntryParticipant
→ EventRegistration.final_submission_id
→ RegistrationSubmission
→ TeamSnapshot
→ TeamSnapshotMember.pokemon_id
```

기존 `image_ref`는 legacy compatibility로 유지한다. Title 자동 지급은 이 core 범위에 포함하지 않는다.

## 8.6 과거 챔피언스 데이터

과거 챔피언스 선발전 데이터가 보존되어 있지 않은 경우 이를 역추정하지 않습니다.

```text
과거 본선 기록
→ 현재 확인 가능한 Event / Result / Hall of Fame만 보존

과거 선발전
→ 원본 자료가 없으면 생성하지 않음
```

현재 구현도 이 원칙을 따른다. Qualifier의 실제 Match/winner facts와 참가 이력은 보존하되, Qualifier를
우승·준우승·4강으로 역분류하거나 과거 자료가 없는 선발전을 추정해 만들지 않는다.

## 8.7 Champions core runtime — Test 기준 완료

Champions는 별도 tournament engine이 아니다. 기존 normalized competition lifecycle을 재사용하고
Champions-specific orchestration만 추가한다. Qualifier는 `qualification_slots`만큼 advancement가
확정되면 “본선 선발 과정 종료”로 완료하며 일반 placement apply를 수행하지 않는다.

Final은 기존 normalized Event lifecycle을 사용한다.

```text
Final EventRegistration
→ 운영자 실제 참가자 수동 확정
→ Entry / EntryParticipant
→ normalized bracket
→ Match
→ Result
→ RankingAward
→ final_submission_id freeze
→ Records
→ Event completed
```

`battle_format`과 `competition_format`은 별개다. 예를 들어 `battle_format = doubles`와
`competition_format = single_elimination`을 함께 사용할 수 있다.

Champions core의 Qualifier CRUD, 수동 advancement와 불참 취소, Final lifecycle, HOF 연결 및 official
party relation은 Test DB smoke까지 완료했다. exhaustive browser E2E는 기능 blocker가 아니라 최종 통합
QA로 이월한다. Production migration은 아직 수행하지 않았다.

---

# 9. 포켓몬 기록

현재 포켓몬 기록은 **엔트리 등록 기준**입니다.

가능한 지표:

- 엔트리 등록 횟수
- 채용률
- 사용 트레이너 수
- 우승 엔트리 포함
- 준우승 엔트리 포함
- 4강 엔트리 포함
- 같이 등록된 포켓몬

현재 만들지 않는 지표:

```text
포켓몬 경기 승률
```

이유는 실제 경기별 선출 포켓몬을 기록하지 않기 때문입니다.

---

# 10. 데이터 모델 요약

신규 Event-linked 운영 사실은 normalized 관계로 저장하고, legacy-only/historical 데이터는
compatibility adapter로 읽습니다.

## Player

트레이너 고유 식별자.

이름 문자열만 연결 키로 쓰지 않고 장기적으로 `player_id`를 사용합니다.

## Season

시즌 정보.

## Event

예:

- 대회명
- 시즌
- 날짜
- 포맷
- Rookie / Master / Light / Champions
- Regulation
- 특수 룰
- 팀전 여부
- 공식 W/L 포함 정책

## Entry

한 Event의 참가 단위. 개인전은 Player 1명, 팀전은 Team Entry와 여러 EntryParticipant로 표현한다.

## Bracket runtime

### BracketRuntime

Event당 하나의 normalized bracket runtime discriminator다.

```text
BracketRuntime
- event_id
- topology_kind
- projection_version
- previous_event_status
```

`topology_kind`는 Single/Double/Team runtime의 해석 기준이며, runtime lifecycle과 이전 Event
상태 복구에 필요한 metadata를 함께 보존한다.

### BracketEntrySlot

실제 대진표 draw를 저장하는 canonical persisted fact다.

```text
BracketEntrySlot
- runtime_id
- slot_key
- entry_id
- seed metadata
```

`Entry.seed`와 actual draw slot은 서로 다른 의미다. BYE는 slot row로 저장하지 않는다.

### BracketIdentityChange

runtime 생성·삭제 과정에서 확정된 identity ownership과 rollback metadata를 보존한다.
안전한 소유권이 확인된 변경만 rollback하며, malformed runtime은 legacy로 우회하지 않고 fail closed한다.

### Persistent facts와 projection

Persistent facts:

- `Entry`
- `EntryParticipant`
- persisted `BracketEntrySlot`
- 실제 formed `Match`
- `Match`의 winner fact

Derived projection:

- BYE
- future Match
- graph topology와 advancement edge
- Double Elimination loser movement
- Grand Final / Reset activation

Bracket graph 전체를 DB에 저장하지 않는다.

## Team Snapshot / Entry Pokémon

제출 당시 엔트리 고정본.

## Match

실제 경기 사실.

예:

- event_id
- stage
- entry_a / entry_b
- winner
- team context
- ace 여부

## Title Award

칭호 획득 이력.

AUTO / REVIEW / MANUAL 구분을 검토합니다.

---

# 11. Migration 원칙

현재 `ypl_data_v4`를 한 번에 제거하지 않습니다.

현재 runtime은 신규 Event-linked normalized 경로와 Production/historical compatibility 경계를
분리한다.

신규 Event-linked Test runtime:

```text
Event
→ EventRegistration
→ Entry
→ EntryParticipant
→ BracketRuntime
→ persisted BracketEntrySlot
→ Match
→ Result
→ RankingAward
→ final submission
→ Records
```

Bracket UI는 persistent facts를 pure projection한다.

신규 기능은 normalized-first로 개발한다. 새로운 canonical 운영 사실을 legacy JSON에 추가로
확대하지 않으며, `ypl_data_v4`는 장기적으로 historical data compatibility, 아직 migration되지
않은 legacy-only Event, 과거 Records fallback 용도로 축소한다.

normalized bracket runtime의 원칙은 다음과 같다.

```text
Entry / EntryParticipant / persisted draw slot / formed Match / winner
→ pure Bracket UI projection
→ Result / RankingAward / Records
```

Persistent facts는 Entry, EntryParticipant, persisted actual draw slot, formed Match, winner다.
BYE, future Match, topology, advancement edge, Double loser movement, GF/Reset activation은
projection에서 계산한다. Bracket graph 전체를 DB에 저장하지 않는다.

P2-7에서 Test 기준 normalized Single / Double / Team runtime cutover를 완료했다. Production은
아직 `public.site_data / ypl_data_v4` 기반이며, historical bracket·legacy-only Event·legacy
round/ranking/season write·historical Records fallback은 compatibility path로 유지한다.

권장 전환:

```text
1. 운영 JSON 원본 백업
2. 현재 데이터 인벤토리 작성
3. 새 schema 설계
4. 테스트 환경 구축
5. legacy JSON → 새 구조 변환 검증
6. 읽기 경로부터 병행
7. write 경로 점진적 전환
8. 충분히 검증된 뒤 legacy 의존 축소
```

## 절대 먼저 하지 않는 것

- 백업 없이 운영 테이블 수정
- 운영 JSON을 새 SEED로 덮어쓰기
- 과거 기록 자동 추정
- schema 확정 전 대규모 migration
- 운영 페이지에서 직접 write 테스트

---

# 12. Supabase 접근권한 확보 후 점검 순서

2026-08-29 기준 Supabase 프로젝트 접근권한을 확보했습니다.

다음 순서로 **읽기와 백업부터** 진행합니다.

```text
1. 프로젝트 / 테이블 목록 확인
2. site_data 구조 확인
3. ypl_data_v4 원본 export
4. 별도 백업 파일 보관
5. RLS 정책 확인
6. Auth 사용 여부 확인
7. anon / authenticated 권한 확인
8. 실제 데이터 인벤토리 작성
9. SEED와 diff
10. 이후 schema 설계
```

보안 구조는 실측 전 추측하지 않습니다.

현재 프론트엔드에 클라이언트 관리자 UI가 존재하므로 Supabase RLS/Auth와 실제 write 권한이 어떤 상태인지 우선 확인해야 합니다.

---

# 13. 보안 방향

장기 목표:

```text
UI에서 관리자라고 표시됨
≠ 데이터 write 권한 보유
```

실제 write 권한은 Supabase Auth / RLS 같은 서버 측 정책으로 통제하는 구조가 목표입니다.

확인해야 할 항목:

- `site_data` SELECT 정책
- INSERT / UPDATE / DELETE 정책
- anon key로 가능한 범위
- authenticated 사용 여부
- 관리자 역할 표현 방식
- 게시판 PIN / 신청 응답 등 민감 데이터 노출 범위

실제 정책 변경은 운영 데이터 백업과 현재 정책 검토 후 진행합니다.

---

# 14. 문서 역할

```text
ROADMAP.md
→ 지금 어디까지 왔고 다음에 무엇을 할지

ARCHITECTURE.md
→ 기술 구조와 데이터 원칙

PATCH_NOTES_2026-08-26.md
→ 실제로 무엇을 언제 변경했는지
```

ROADMAP에는 과거 구현 과정을 길게 누적하지 않습니다.

PATCH_NOTES는 과거 상태가 현재 정책과 다르더라도 **변경 이력**으로 유지합니다.

<!-- YPL_NORMALIZED_MODEL_V1_START -->
# 정규화 데이터 모델 v1

> 상태: **논리 모델 확정**
> 이 절은 실제 PostgreSQL/Supabase DDL을 작성하기 전의 도메인 모델을 정의한다.
> 물리 테이블명, index, FK delete policy, RLS 등은 다음 DDL 단계에서 확정한다.

## 1. 설계 원칙

- 통계 숫자보다 원본 사실을 저장한다.
- 공식 대회 성적은 `Result`, 실제 랭킹 반영값은 `RankingAward`로 분리한다.
- 과거에 없는 Match를 역산하거나 추정하지 않는다.
- Team Builder 개인 작업본은 localStorage에 유지하고, 대회 제출 시 별도의 immutable Team Snapshot을 만든다.
- 제출 후 수정은 기존 Snapshot UPDATE가 아니라 새 Submission + 새 Snapshot으로 기록한다.
- 개인전과 팀전을 동일한 Event / Entry 모델로 표현한다.
- 팀전의 공식 Result는 팀 Entry에 한 번만 기록하며 선수별 Result를 중복 생성하지 않는다.
- 팀전 선수별 랭킹 변화는 RankingAward에서 각각 기록한다.

## 2. 전체 관계

```text
Player
└─ PlayerPartner

Season
└─ Event
   ├─ EventRegistration ── Player
   │  └─ RegistrationSubmission
   │     └─ TeamSnapshot
   │        └─ TeamSnapshotMember
   │
   ├─ Entry
   │  └─ EntryParticipant ── Player / EventRegistration
   │
   ├─ Match
   │  └─ Match (team_bout / ace)
   │
   └─ Result
      ├─ RankingAward ── Player
      └─ HallOfFameEntry

RankingBaseline ── Player / Season

TitleDefinition
└─ TitleAward ── Player
```

### 제출 귀속 원칙

`RegistrationSubmission`은 **EventRegistration**에 귀속한다.

이유:

- 참가 신청 직후부터 파티를 제출할 수 있어야 함
- 개인전은 대진표 생성 전에도 제출 가능해야 함
- 팀전은 최종 팀 Entry가 만들어지기 전에도 선수별 제출이 가능해야 함
- 재제출 revision은 실제 대진표 참가 단위와 독립적으로 보존해야 함

따라서 공식 최종 제출 포인터는 `EventRegistration.final_submission_id`로 관리한다.

`Entry`는 신청 객체가 아니라 실제 대진표 참가 단위다.

---

## 3. Player

```text
Player
- id
- display_name
- status
- created_at
- updated_at
```

- 이름 자체를 PK로 사용하지 않는다.
- display_name은 동명이인 가능성을 고려해 전역 UNIQUE를 강제하지 않는다.
- 필요 시 향후 PlayerAlias를 추가할 수 있다.

### 신규 신청 시 Player 식별

신규 `application`에서 참가자가 입력한 이름은 앞뒤 공백을 제거한 뒤 `Player.display_name`과 exact match한다.

- 일치하는 Player가 0명 → `EventRegistration.player_id = NULL`로 신청 저장
- 일치하는 Player가 1명 → 기존 Player 재사용
- 동일 `display_name`의 Player가 2명 이상 → `EventRegistration.player_id = NULL`로 신청 저장
- fuzzy match로 유사 이름의 다른 Player를 자동 선택하지 않는다.

신청 단계에서는 신규 Player를 만들지 않는다. 실제 참가자가 확정되는 Event 연결 개인전 Bracket 생성 단계에서 NULL identity를 다시 exact match하고, 0명이면 신규 Player 생성, 1명이면 재사용, 2명 이상이면 자동 확정을 중단한다. 전환 이전 Bracket은 기록 반영 단계의 기존 fallback을 유지한다.

---

## 4. Season

```text
Season
- id
- code
- name
- series
- number
- starts_on nullable
- ends_on nullable
- sort_order
- status
- created_at
```

예:

```text
code   = classic-4
name   = CLASSIC SEASON 4
series = classic
number = 4
```

```text
code   = ypl-3
name   = YPL SEASON 3
series = ypl
number = 3
```

정확한 날짜를 모르는 과거 시즌은 추측하지 않고 nullable로 둔다.

공식 신규 Event는 정확히 하나인 `status = current` 시즌에 자동 연결한다. current 시즌이 0개이거나 2개 이상이면 임의 선택하지 않고 생성 오류로 처리한다. 이미 `season_id`가 있는 Event를 공지에서 수정할 때는 기존 연결을 보존한다.

### YPL Season 자동 전환 — 향후 확정 설계

현재 자동 rollover는 구현·Production 적용 전이다. 향후 자동화 대상은 `series = ypl`이며, Browser local
clock이나 사용자 접속 시점이 아니라 Asia/Seoul 기준 DB/server-side scheduler가 다음 boundary를 처리한다.

```text
03/01 00:00 KST → YPL Season +1
09/01 00:00 KST → YPL Season +1
```

운영 기준 예시는 다음과 같다.

```text
YPL Season 3 → 2026-09-01 시작
YPL Season 4 → 2027-03-01 시작
YPL Season 5 → 2027-09-01 시작
```

- YPL series에는 항상 정확히 하나의 `status = current` Season만 존재해야 한다.
- 기존 current 해제와 다음 Season current 활성화는 하나의 idempotent operation으로 처리한다.
- 같은 boundary의 중복 실행에서도 Season number가 두 번 증가하지 않아야 하며, concurrent 실행에서도
  duplicate Season을 만들지 않아야 한다.
- 과거 Season row/number와 이미 저장된 Event의 `season_id`는 수정하지 않는다. rollover 이후 생성되는 신규
  Event만 새 current YPL Season을 참조한다.
- next Season row를 미리 생성해 상태만 변경하거나 boundary transaction에서 deterministic하게 생성하는 방식 중
  기존 schema와 운영 구조에 맞는 최소 방식을 선택한다. `number`, `starts_on`, code/name convention,
  current uniqueness, retry idempotency는 반드시 보장한다.
- Classic historical series 등 다른 series에는 이 자동 rollover를 강제하지 않으며, 과거 날짜를 기준으로
  Season을 재구성하거나 번호를 역산하지 않는다.

---

## 5. Event

Event는 특정 시즌에 실제로 한 번 열린 대회 하나를 뜻한다.

신규 공식 Event의 `season_id`는 필수다. nullable은 시즌을 확정할 수 없는 과거 migration/수동 보정 호환을 위해서만 남긴다.

```text
Event
- id
- season_id
- name
- round_number
- event_type
- division nullable
- battle_format nullable
- competition_format nullable
- competition_settings
- is_team_event
- regulation_id nullable
- cup_rule_id nullable
- cup_rule_settings
- registration_settings
- held_on nullable
- date_precision
- record_completeness
- status
- submission_target_at nullable
- team_reveal_mode
- team_reveal_at nullable
- team_revealed_at nullable
- record_applied_at nullable
- created_at
- updated_at
```

### 제출 기준 시각

`submission_target_at`은 hard deadline이 아니라 **운영 기준 시각(soft deadline)** 이다.

- 기준 시각 이후에도 최초 제출 및 재제출 가능
- 제출 시각 이력은 보존
- 대회 종료/기록 반영 성공 시 최종 제출본을 확정

### 팀 공개

```text
team_reveal_mode
- on_record_apply
- scheduled
- manual
```

실제 공개 여부의 기준은 `team_revealed_at != null`이다.

일반 대회:

```text
기록 반영 성공
→ Event completed
→ 참가자별 final_submission_id 확정
→ team_revealed_at 기록
```

챔피언스는 scheduled 또는 manual 공개를 사용할 수 있다.

### 기록 완성도

```text
record_completeness
- full_match
- placement
- winner_only
- partial
```

`source`와 `record_completeness`는 의미를 분리한다.

- completeness = 얼마나 복원되어 있는가
- source = bracket / manual / migration 등 어디서 얻었는가

---

## 5.5 EventRegistration

대회 참가 신청과 실제 대진표 참가를 분리한다.

```text
EventRegistration
- id
- event_id
- player_id nullable
- registration_name
- registration_data
- registration_source
- registered_at nullable
- final_submission_id nullable
- created_at
- updated_at
```

`registration_source`:

```text
application
advancement
manual
migration
```

- `application`: 실제 신규 참가 신청
- `advancement`: 랭킹 직행 / 선발전 통과 등으로 Champions 본선 참가 자격을 얻어 생성된 등록
- `manual`: 운영진이 필요에 따라 만든 신규 운영 등록
- `migration`: legacy Entry/Submission을 최신 모델에 연결하기 위한 기술적 anchor

`migration` row는 당시 실제 참가 신청서가 존재했다는 뜻이 아니며, 과거 신청자 수를 복원하는 근거로 사용하지 않는다.

팀전의 1·2·3지망 등 대회별 신청 데이터는 `registration_data JSONB`에 저장한다.

참가자 파티 제출 화면에서는 개인 링크/token/별도 로그인을 만들지 않고:

```text
Event 선택
→ 자기 이름 직접 입력
→ 해당 Event의 submission-eligible Registration exact match
  (application / advancement / manual)
```

방식을 사용한다. 앞뒤 공백 정리는 허용하되 fuzzy match로 다른 사람을 자동 선택하지 않는다.

---

## 6. Entry / EntryParticipant

### Entry

한 Event에 참가한 하나의 참가 단위.

```text
Entry
- id
- event_id
- entry_type
- display_name nullable
- seed nullable
- status
- created_at
- updated_at
```

`entry_type`:

```text
individual
team
```

### EntryParticipant

```text
EntryParticipant
- id
- event_id
- entry_id
- registration_id
- player_id
- member_order
- role nullable
- created_at
```

개인전:

```text
Entry
└─ EntryParticipant 1명
```

팀전:

```text
Entry "하나 히어로즈"
├─ EntryParticipant A
├─ EntryParticipant B
├─ EntryParticipant C
└─ ...
```

팀전 당시의 팀 구성은 EntryParticipant로 보존한다.

과거 기록 중 팀원 명단은 확인되지만 팀명이 남아 있지 않은 경우가 있으므로
`Entry.display_name`은 DB에서 nullable로 둔다. 없는 팀명을 임의로 생성하지 않는다.
신규 팀전의 팀명 필수 여부는 관리자 UI / application validation에서 처리한다.

---

## 7. RegistrationSubmission

```text
RegistrationSubmission
- id
- registration_id
- snapshot_id
- revision
- submitted_at nullable
- source
- created_at
```

권장 제약:

```text
UNIQUE(registration_id, revision)
```

대회 진행 중 현재 공식 제출본:

```text
해당 EventRegistration의 가장 높은 revision
```

결과 적용 후 공식 역사 기록:

```text
EventRegistration.final_submission_id
```

과거 Submission은 삭제하지 않는다.

과거 migration에서 실제 제출 시각을 확인할 수 없으면 `submitted_at = NULL`로 보존하며 현재 시각을 임의로 생성하지 않는다.

`submitted_after_target` 같은 파생 상태는 저장하지 않고:

```text
submitted_at > Event.submission_target_at
```

으로 계산한다.

---

## 8. Team Snapshot v1

Team Snapshot의 목표:

> Snapshot만으로 제출 당시의 배틀 세팅을 Team Builder에서 다시 열 수 있어야 한다.

### TeamSnapshot

```text
TeamSnapshot
- id
- schema_version
- regulation_id nullable
- cup_rule_id nullable
- cup_rule_settings
- source_type
- source_reference nullable
- imported_at nullable
- created_at
```

`source_type` 후보:

```text
manual
replica_import
historical
```

Replica Team ID 직접 Import는 현재 안정적인 공개 resolver를 확보하지 못했으므로 **보류**한다.
향후 resolver가 확보되면 동일 Snapshot 규격으로 adapter만 추가한다.

### TeamSnapshotMember

```text
TeamSnapshotMember
- id
- snapshot_id
- slot
- pokemon_id nullable
- pokemon_name_snapshot
- ability_id nullable
- nature_id nullable
- stat_hp
- stat_atk
- stat_def
- stat_spa
- stat_spd
- stat_spe
- item_id nullable
- move_1_id nullable
- move_2_id nullable
- move_3_id nullable
- move_4_id nullable
```

정책:

- Pokémon 1~6마리
- Team Invalid만 제출 차단
- Team Incomplete는 제출 허용
- unresolved member가 포함된 local team은 official TeamSnapshot 생성을 차단한다.
- 기술 4개 미만, 일부 설정 미완성도 Regulation-invalid가 아니면 허용
- Pokémon 0마리는 공식 제출 불가
- Stat Points는 계산 결과가 아니라 입력 사실을 저장
- IV는 Pokémon Champions에서 고정이므로 v1에 저장하지 않음
- Tera Type은 현재 Mega Rule 기준 v1에서 제외하며 미래 Regulation 확정 후 schema version 증가로 추가 가능
- `pokemon_id`는 form-specific stable canonical ID를 사용
- `pokemon_name_snapshot`은 표시·복원을 위한 당시 이름이며 canonical identity와 분리한다.
- species clause 판정용 identity와 Snapshot 복원용 pokemon_id를 분리
- local saved team의 id / createdAt / updatedAt을 official Snapshot identity 또는 사실로 재사용하지 않는다.
- Snapshot 생성 후 기존 Snapshot을 수정하지 않음
- 파티 제출은 단순 Pokémon 엔트리 목록이 아니라 **특성 / 성격 / Stat Points / 지닌물건 / 기술 4개를 포함한 전체 배틀 세팅**을 보존
- 모노타입 `assignedType`은 Team Builder 로컬 선택/검증 상태이며 EventRegistration / TeamSnapshot / Records에 저장하지 않음

---

## 9. Match

```text
Match
- id
- event_id
- parent_match_id nullable
- match_kind
- round_number nullable
- stage_label nullable
- sequence_no nullable
- entry_a_id nullable
- entry_b_id nullable
- player_a_id nullable
- player_b_id nullable
- winner_entry_id nullable
- winner_player_id nullable
- resolution
- source
- source_node_key nullable
- played_at nullable
- created_at
- updated_at
```

`match_kind`:

```text
bracket
team_bout
ace
```

개인전:

```text
entry_a / entry_b / winner_entry
```

팀전:

```text
부모 Match = 팀 대 팀
└─ 자식 Match = 선발 개인 경기 / 에이스 결정전
```

BYE는 Match로 만들지 않는다.

승자만 저장하고 loser는 중복 저장하지 않는다.

`source_node_key`를 통해 대진표 node와 Records Match를 안정적으로 연결한다.

---

## 10. Result

```text
Result
- id
- event_id
- entry_id
- placement_code
- rank_min nullable
- rank_max nullable
- placement_label
- source
- created_at
- updated_at
```

권장 제약:

```text
UNIQUE(event_id, entry_id)
```

예:

```text
우승
placement_code = champion
rank_min = 1
rank_max = 1

4강
placement_code = semifinalist
rank_min = 3
rank_max = 4

조별리그 탈락
placement_code = group_stage_exit
rank_min = null
rank_max = null
```

팀전 공식 Result는 팀 Entry에 한 번만 생성한다.

선수별 우승/준우승/4강 기록은:

```text
Result
→ Entry
→ EntryParticipant
```

로 계산한다.

---

## 11. RankingAward / RankingBaseline

### RankingAward

```text
RankingAward
- id
- event_id
- player_id
- result_id nullable
- award_kind
- points_delta
- win_delta
- runner_up_delta
- top4_delta
- counts_series
- counts_season
- related_award_id nullable
- reason nullable
- source
- created_at
```

`award_kind`:

```text
placement
adjustment
reversal
```

실제 지급값을 저장한다.
YPL 시즌 3 이후에는 Event별 랭킹 반영 여부를 `competition_settings.rankingEnabled`에 명시한다.

Event-linked 정상 개인전의 canonical placement point policy:

```text
Master  우승 60 / 준우승 40 / 4강 20
Light   우승 30 / 준우승 20 / 4강 10
Rookie  RankingAward 없음
```

Master / Light의 `win_delta / runner_up_delta / top4_delta`는 각 입상에 1씩 기록한다.
Light는 포인트만 Master의 절반이며 입상 횟수는 동일하게 센다. 정상 개인전 placement Award는
`counts_series = true`, `counts_season = true`다. Rookie는 잘못 `rankingEnabled = true`로 저장되어도
Award를 생성하지 않는다. 기존 Light Event의 `division`이 비어 있고 `event_type = light`인 경우도
Light로 해석하며, 기존 `pokecup` Event의 division이 비어 있으면 기존 동작을 보존해 Master 정책을 사용한다.

```text
마스터 리그       → true
파이컵 라이트     → true
루키 리그         → false
```

`is_team_event`는 대회 구조가 팀전인지 나타내고, `division`은 Master / Light / Rookie 랭킹 분류를 나타낸다.
따라서 팀전이라고 자동으로 Master로 해석하지 않으며 Team + Master와 Team + Light를 구분한다.
현재 canonical 팀전 RankingAward는 Team Master 우승 30 / 준우승 20, Team Light 우승 15 / 준우승 10이다.
팀 4강은 Result만 보존하고 RankingAward를 만들지 않는다. 팀전 Award는 points-only로 기록하며
`win_delta = 0`, `runner_up_delta = 0`, `top4_delta = 0`, `counts_series = true`, `counts_season = true`를 사용한다.

결과 반영 흐름:

```text
Result 생성
→ competition_settings.rankingEnabled = true
   → RankingAward 생성
→ false
   → Result만 보존하고 RankingAward는 생성하지 않음
```

따라서 공식 대회 성적과 랭킹 포인트 지급 여부는 서로 독립된 사실로 관리한다.

과거 `ypl_data_v4`는 Event별 실제 RankingAward 지급 이력을 정확히 복원할 수 없으므로 historical migration에서 RankingAward를 역산하지 않고 RankingBaseline만 이전한다.

팀전 기본 배분식 자체보다 각 선수에게 최종 적용된 실제 값을 원본으로 본다.

수정 이력은 overwrite가 아니라 ledger 방식:

```text
placement +20
adjustment +5
reversal -20
```

위 ledger capability와 Bracket의 operational rollback은 구분한다. P0-6의 기록 반영 취소는 아직
최종화되지 않은 runtime 반영을 원복하는 작업이므로 `source = legacy_bracket_runtime`인 placement
Award를 먼저 삭제한 뒤 runtime Result를 삭제한다. `adjustment` / `reversal` 및 다른 source Award는
이 cleanup 대상이 아니며, 별도의 사후 보정 UI는 이번 단계에서 구현하지 않는다.

### RankingBaseline

과거 Event별 Award를 정확히 복원할 수 없는 누적 랭킹은 역산하지 않는다.

```text
RankingBaseline
- id
- player_id
- scope
- series nullable
- season_id nullable
- points
- wins
- runner_ups
- top4s
- source
- captured_at
- note nullable
```

랭킹 scope:

```text
series
→ 클래식 누적 / YPL 누적 등 시즌 계열 누적

season
→ 특정 시즌 랭킹
```

기존 운영 데이터의 `rankings.key = era1 / era2`는 각각
`series = classic / ypl` baseline으로 이전한다.

새 시스템 이후 랭킹:

```text
series 누적 = series RankingBaseline + 해당 series의 counts_series Award
시즌 랭킹 = season RankingBaseline + 해당 season의 counts_season Award
```

---

## 12. Title

### TitleDefinition

```text
TitleDefinition
- id
- code
- name
- description nullable
- group_code nullable
- award_mode
- sort_order
- active
- created_at
- updated_at
```

`award_mode`:

```text
auto
review
manual
```

### TitleAward

```text
TitleAward
- id
- title_id
- player_id
- event_id nullable
- result_id nullable
- source
- reason nullable
- awarded_at
- revoked_at nullable
```

AUTO/REVIEW 후보 자체는 v1에서 별도 테이블로 저장하지 않는다.
공식 승인된 칭호만 TitleAward로 만든다.

잘못 지급된 칭호는 DELETE보다 `revoked_at`을 기록한다.

---

## 13. Player Partner

기존 `titleGroups.partner`는 일반적인 칭호 구조와 의미가 다르다.

```text
item.name = 선수
holders   = 파트너 포켓몬 목록
```

예:

```text
정두호
→ 이어롭 / 픽시 / 해피너스 / 다투곰
```

이를 `TitleAward`로 migration하면 포켓몬 이름을 Player로 잘못 해석하게 되므로 별도 관계로 보존한다.

```text
PlayerPartner
- id
- player_id
- pokemon_id nullable
- pokemon_name_snapshot
- source
- created_at
- revoked_at nullable
```

과거 데이터는 Pokémon canonical ID를 확정할 수 없는 경우 이름 snapshot만 보존한다.

---

## 14. Hall of Fame

```text
HallOfFameEntry
- id
- event_id
- result_id
- player_id
- generation_number
- generation_label nullable
- image_ref nullable
- note nullable
- created_at
- updated_at
```

권장 제약:

```text
UNIQUE(event_id)
```

`generation_number`에는 UNIQUE를 걸지 않는다.

### YPL 시즌 3 이후 챔피언 정책

한 챔피언 세대에 싱글·더블 챔피언이 각각 존재할 수 있다.

예:

```text
7대 챔피언
├─ 7대 싱글 챔피언 A
└─ 7대 더블 챔피언 B
```

두 HallOfFameEntry는 서로 다른 Champions Event를 가리키지만:

```text
generation_number = 7
```

을 동일하게 사용한다.

battle format은 HallOfFameEntry에 중복 저장하지 않고:

```text
HallOfFameEntry
→ Event
→ battle_format
```

으로 판별한다.

신규 Hall of Fame의 Pokémon 파티 이미지는 별도 업로드하지 않는다.

```text
HallOfFameEntry
→ Result
→ winner Entry
→ EntryParticipant
→ EventRegistration.final_submission_id
→ TeamSnapshot
→ pokemon_id 기반 sprite 렌더링
```

`image_ref`는 기존 HOF/custom 이미지 호환용 nullable 필드로만 유지하고 신규 Pokémon 파티의 source of truth로 사용하지 않는다.

---

## 15. Source of Truth 요약

| 알고 싶은 것 | 원본 |
|---|---|
| 시즌 | Season |
| 대회 | Event |
| 참가 신청 | EventRegistration(source=application) |
| 신청 추가 정보 / 팀 지망 | EventRegistration.registration_data |
| 참가 단위 | Entry |
| 실제 참가 선수 / 최종 팀 구성 | EntryParticipant |
| Event-linked bracket runtime | BracketRuntime |
| 실제 persisted draw | BracketEntrySlot |
| runtime ownership / rollback metadata | BracketIdentityChange |
| 제출/재제출 이력 | RegistrationSubmission |
| 제출 당시 팀 세팅 | TeamSnapshot / TeamSnapshotMember |
| 실제 경기 | Match |
| 공식 최종 성적 | Result |
| 공식 통산 우승·준우승·4강 | Result → EntryParticipant에서 계산 |
| 실제 랭킹 지급값 | RankingAward |
| 복원 불가능한 과거 랭킹 시작값 | RankingBaseline |
| Champions 실제 진출 경로 | ChampionshipAdvancement |
| 칭호 획득 | TitleAward |
| 파트너 포켓몬 | PlayerPartner |
| 챔피언 명예의 전당 | HallOfFameEntry |


---

## 17. 신청 → 제출 → 대진표 → 결과 운영 흐름

### Event 생성 시점

Event는 대진표 생성 시점이 아니라 **대회 신청 공지를 게시할 때 생성/연결**한다.

공지 본문의 자연어 대신 다음 구조화 필드를 대회 규칙의 기준으로 사용한다.

```text
regulation_id
cup_rule_id
cup_rule_settings
registration_settings
competition_format
competition_settings
```

### 개인전 참가 확정

기존 관리자 `대진표 → 새 대회 만들기` UX의 큰 틀은 유지한다.

```text
기존 Event 선택
→ 신청자 전원 기본 체크
→ 불참자만 체크 해제
→ 수동 참가자 추가
→ 전체 참가자의 Registration / Player identity read-only preflight
→ 필요한 Player / manual Registration 생성 및 NULL player_id 연결
→ 선택된 Registration에서 Entry / EntryParticipant 생성
→ normalized BracketRuntime 생성
→ persisted actual draw slot 저장
→ pure projection 기반 Bracket UI와 formed Match 동기화
→ Event running
```

개인전은 `1 Player = 1 Registration = 1 Entry = 1 EntryParticipant`로 확정한다.
Event-linked normalized runtime은 Event당 하나만 허용하며, historical / legacy-only Bracket과
팀전에는 이 제한을 확장하지 않는다.

Single은 `single:r1:m1`, Double은 `double:w:r1:m1`·`double:l:r1:m1`·`double:gf:m1`·
`double:reset:m1` 같은 stable node key를 사용한다. actual draw는 `BracketEntrySlot`이 소유하고,
runtime lifecycle ownership / rollback metadata는 `BracketIdentityChange`가 소유한다.

파티 미제출은 참가를 막지 않는다.

별도 참가 확정 화면이나 참가 취소 UI는 만들지 않는다.

대진표 생성 후 불참자는 별도 reseed/remove workflow를 만들지 않고 실제 경기 결과에서 상대 승 / 해당 선수 패로 처리한다.

### 팀전 편성

신청 단계에서 각 참가자는 기존 방식대로 1·2·3지망 팀을 제출한다.

자동 편성은 최종 확정이 아니라 추천 초안이다.

최적화 기준:

1. 팀별 인원을 최대한 균등하게 배치
2. 전체 참가자의 1·2·3지망 만족도를 최대화

실력 밸런스는 시스템에서 계산하지 않는다.

추천안은 여러 번 재생성할 수 있고 운영진이 최종 수정한다.

운영진이 선수를 이동할 때 참가자별 1·2·3지망 전체와 현재 배정이 몇 지망인지 즉시 확인할 수 있어야 한다.

최종 편성 시 Team Entry와 EntryParticipant를 생성한다. 팀원 수는 DB에서 고정하지 않는다.

### 에이스전

에이스전 필요 여부는 roster 인원수가 아니라 **실제 정규 개인전 수**를 기준으로 한다.

- 정규 개인전 수 홀수 → 동률 불가능 → ace 불필요
- 정규 개인전 수 짝수 → 동률 가능
- 실제 정규전 결과가 동률일 때만 ace Match 생성

### 결과 적용과 제출 freeze

일반 대회:

```text
Match
→ Result
→ RankingAward
→ EventRegistration.final_submission_id freeze
→ legacy ypl_data_v4 save
→ Event completed
→ record_applied_at 기록
→ team_revealed_at 기록
→ Records 공개
```

결과 적용 전까지 최초 제출/재제출을 허용한다.

공개 Records에는 `final_submission_id`가 가리키는 최종 Snapshot만 표시하고 이전 revision은 운영 이력으로
보존한다. `team_revealed_at IS NOT NULL`인 finalized Event에서 final pointer가 없는 참가자는 파티 없음으로
표시하며 legacy party로 보충하지 않는다. `team_revealed_at IS NULL`인 historical compatibility Event에
한해 기존 legacy fallback을 허용한다.

기록 반영 취소는 다음 순서를 사용한다.

```text
RankingAward 제거
→ Result 제거
→ legacy revert
→ final pointer release
→ Event running
→ record_applied_at = NULL
→ team_revealed_at = NULL
```

freeze 이후 legacy save가 실패하면 freeze 직전 pointer snapshot으로 exact restore한다. 복구 대상 Event의
현재 pointer가 예상 freeze 결과와 같고 아직 최종 완료 상태가 아닐 때만 pointer를 수정하며, completed이거나
`record_applied_at` 또는 `team_revealed_at`이 설정된 Event에 대한 delayed restore는 conflict/error로 차단한다.
release 실패 시 legacy applied snapshot → Result snapshot → RankingAward snapshot 순서로 보상 복구하고,
재시도에서도 중복 Result / RankingAward를 만들지 않는다. Event completion 상태가 불확실하면 재조회하며,
`status = completed`, `record_applied_at IS NOT NULL`, `team_revealed_at IS NOT NULL` 세 조건이 모두
충족될 때만 성공으로 처리한다.

Bracket participant의 normalized identity는 Entry ID를 기준으로 연결한다. 전환 중에는 legacy graph의 participant ID를 함께 유지한다.

legacy compatibility Bracket 기록 반영의 안전 순서는 다음과 같다.

```text
1. Entry-linked Bracket은 기존 Entry / EntryParticipant identity 검증
2. 전환 이전 Bracket만 Player / Registration identity fallback 수행
3. legacy 기록 결과 준비
4. public.site_data / ypl_data_v4 저장
5. 저장 성공 후에만 Event completed + record_applied_at 기록
```

브라우저 클라이언트의 normalized write와 `public.site_data` 저장은 하나의 PostgreSQL transaction으로 묶이지 않는다. 따라서 예측 가능한 동명이인/중복 충돌은 첫 write 전에 검사하고, legacy 저장 실패 시 Event를 완료 처리하지 않는다. 마지막 Event 완료 처리만 실패한 경우 같은 미리보기의 재시도는 동일 round ID를 다시 저장하므로 중복 회차를 만들지 않는다.

Event 연결 팀전은 멤버별 Player / EventRegistration / EntryParticipant와 Team Entry를 확정하고,
P1-4까지 normalized Match / Result / RankingAward 및 legacy 기록 반영 lifecycle을 지원한다. P1-5에서 normalized team Records read와 개인 / 팀 placement count 분리를 완료했다.
수동 생성 팀전 등 legacy-only 팀전은 기존 compatibility path로 유지한다.


## 18. 현재 runtime 경계와 후속 운영 원칙

P2-7 Event-linked Bracket normalized cutover는 Test 기준 완료했다. 현재 지원 범위는
individual Single Elimination, Double Elimination, Event-linked Team runtime이며,
historical / legacy-only bracket은 기존 compatibility path를 유지한다.

Production 운영 원본은 별도 migration 전까지 `public.site_data / ypl_data_v4`다. Production
Cutover와 Auth/RLS hardening은 Test 검증, 백업, 권한 설계가 갖춰진 뒤 최종 순서를 조정해 진행한다.

개발 중에는 targeted tests, 대표 happy-path smoke, DB/RPC 변경 시 최소 Test smoke, build,
`git diff --check`를 사용하고, 큰 기능 완료 후 통합 browser E2E와 실제 운영 흐름 QA를 묶어서 수행한다.
Production migration, destructive DB migration, data-loss 가능 rollback/delete, 권한/RLS 변경은
중간 단계에서도 보수적으로 검증한다.
<!-- YPL_NORMALIZED_MODEL_V1_END -->

## Runtime 구조와 routing

현재 애플리케이션은 Test의 신규 Event-linked normalized runtime과
Production/historical compatibility를 분리한다.

```text
Event
→ EventRegistration
→ Entry
→ EntryParticipant
→ BracketRuntime
→ persisted BracketEntrySlot
→ Match
→ Result
→ RankingAward
→ final submission
→ Records
```

### Persistent facts와 projection

Persistent facts는 `Entry`, `EntryParticipant`, persisted actual draw slot, 실제 formed `Match`,
winner다. BYE, future Match, graph topology, advancement edge, Double losers movement,
Grand Final / Reset activation은 pure projection으로 계산한다. Bracket graph 전체를 DB에 저장하지 않는다.

### Runtime routing

```text
runtime exists
→ normalized adapter

normalized runtime malformed
→ fail closed

runtime 없음 + historical / legacy-only bracket
→ legacy adapter

new supported Event-linked bracket
→ normalized runtime create
```

Legacy fallback은 malformed normalized runtime의 recovery path가 아니다.

신규 runtime 생성은 ownership·Event·topology·canonical identity·slot·BYE를 preflight한 뒤
runtime RPC로 수행한다. Single은 기존 Single 전용 create/delete/winner RPC를 유지하고,
Team/Double은 generic normalized runtime RPC를 사용한다. generic RPC는 `SECURITY INVOKER`,
빈 `search_path`, anon `EXECUTE`만 허용하며 normalized runtime artifact 범위 밖의 broad domain
삭제를 수행하지 않는다. Match winner/snapshot sync는 기존 normalizedCompetitionService의
Data API 경로를 유지한다.

결과 적용은 `Match → Result → RankingAward → final submission freeze → Records` 순서로 연결하고,
기록 반영 취소는 `RankingAward → Result → final pointer release` 순서를 지킨다. runtime 삭제와
identity rollback은 `BracketIdentityChange` ownership metadata를 기준으로 수행하며, ownership이
불명확한 interrupted 상태는 자동 정리하지 않는다.

Production `public.site_data / ypl_data_v4`, historical legacy bracket, legacy-only Event,
legacy round/ranking/season write, historical Records fallback은 기존 compatibility path로 유지한다.

### P0-4 normalized Match runtime sync — legacy compatibility adapter

아래 P0-4~P0-6의 `legacy_bracket_runtime` source 규칙은 P2-7 이전 Event-linked 및
legacy compatibility 경로에 적용된다. P2-7 신규 normalized runtime의 canonical draw와 graph
projection은 위의 `BracketEntrySlot` / formed `Match` 원칙을 따른다.

`normalizedCompetitionService.js`가 Event 단위 Match 동기화를 담당한다.

```text
legacy participant pid
→ bracket.participants[].id
→ participant.entryId
→ matches.entry_a_id / entry_b_id / winner_entry_id
```

- `match_kind = bracket`
- `source = legacy_bracket_runtime`
- `source_node_key = legacy match node id`
- 개인전이므로 `player_a_id / player_b_id / winner_player_id = NULL`
- 승자 확정은 `resolution = played`, 미확정은 `unknown`
- 같은 승자를 유지하면 기존 `played_at`을 보존하고, 승자 변경은 새 시각, 취소는 NULL

Single elimination, Double elimination의 winner/loser/GF/reset, Group, Group→Knockout을
동일 snapshot 계산기로 처리한다. reset final은 GF에서 패자조 진출자가 승리했을 때만 활성화한다.

동기화는 partial unique index를 PostgREST upsert conflict target으로 가정하지 않는다.
Event와 runtime source의 기존 row를 먼저 읽고 `source_node_key`로 비교해 UPDATE/INSERT/DELETE한다.
다른 source의 historical Match는 조회·수정·삭제하지 않는다. 빠른 연속 UI 입력은 화면 guard와
Event 단위 service queue로 직렬화한다.

결과 변경은 normalized sync 후 legacy save 순서다. legacy save가 실패하면 이전 Bracket snapshot을
best-effort로 재동기화하고 서버 데이터를 다시 읽는다. Entry identity가 없는 전환 이전 Bracket과
Event 없는 legacy-only Bracket은 Match sync를 건너뛰며 기존 기록 흐름을 유지한다.

### P0-5 normalized Result runtime sync — legacy compatibility adapter

기존 `elimResult`가 legacy 기록 반영에 전달하는 동일한 우승 / 준우승 / 4강 participant ID를
별도 재계산 없이 `bracket.participants[].entryId`로 변환한다.

```text
elimResult
→ participant.id
→ participant.entryId
→ results.entry_id
```

- `source = legacy_bracket_runtime`
- 우승: `champion`, rank 1~1, `우승`
- 준우승: `runner_up`, rank 2~2, `준우승`
- 실제 4강 진출자: `semifinalist`, rank 3~4, `4강`
- Master / Light / Rookie 모두 Result를 생성하며 랭킹 지급 여부는 RankingAward 단계에서 분리

Event의 전체 Result를 읽어 Entry ID 기준으로 runtime snapshot을 비교한다. 기존 runtime row는
필요한 필드만 UPDATE하고, 신규 입상자는 INSERT하며, 더 이상 입상자가 아닌 runtime row만 DELETE한다.
같은 snapshot 재시도는 기존 Result ID를 유지한다. `legacy_tournament` 등 다른 source가 같은
Event / Entry에 존재하면 덮어쓰지 않고 반영을 중단하며, cleanup도 runtime source만 대상으로 한다.

write 순서는 `Entry validation → final Match sync → Result sync → legacy save → Event completed`다.
legacy save 실패 시 Result를 동기화 직전 snapshot으로 best-effort 복구한다. 반영 취소는
`Result 제거 → legacy revert save → Event running` 순서이며 legacy revert save 실패 시 제거한
Result snapshot을 복구한다. Match와 Entry identity는 유지한다.

Event 없는 legacy-only Bracket과 `entryId`가 없는 전환 이전 Bracket은 Result sync를 건너뛰어 legacy compatibility를 유지한다.
Event-linked 팀전은 Team Entry 단위 Result를 지원하며 선수별 Result를 중복 생성하지 않는다.

Test DB 브라우저 E2E에서는 Double Elimination의 apply → revert → 결과 변경 → reapply 및 reset final 경로와 Single Elimination의 apply → revert 경로를 검증했다. 두 형식 모두 기록 반영 전에는 Result가 생성되지 않고, 반영 시 우승 1 / 준우승 1 / 4강 2의 runtime Result가 생성되며, 반영 취소 시 Result만 제거되고 Match / Entry / EntryParticipant는 유지되는 것을 확인했다.

### P0-6 normalized RankingAward runtime sync — legacy compatibility adapter

Result sync 뒤에 Event의 runtime Result를 다시 읽고 다음 normalized 관계만 사용한다.

```text
results.id / results.entry_id
→ entry_participants.entry_id
→ entry_participants.player_id
→ ranking_awards.result_id / player_id
```

이름 문자열로 Player를 찾지 않으며 개인 Entry에 EntryParticipant가 0명 또는 2명 이상이면 반영을
중단한다. 생성 row는 `award_kind = placement`, `source = legacy_bracket_runtime`,
`reason = normalized bracket placement`이고 Master / Light 모두 series와 season count를 켠다.

Event의 Award 전체를 읽되 sync와 cleanup은 runtime placement만 대상으로 한다. `(result_id, player_id)`를
snapshot key로 사용하며 같은 snapshot은 재삽입하지 않고, 변경된 delta는 UPDATE하며, 현재 Result에
없는 stale runtime placement만 DELETE한다. 다른 source placement는 충돌로 중단하고 adjustment / reversal은
보호한다. DB에는 다음 partial unique index를 두어 cross-tab/retry 중복도 차단한다.

```sql
create unique index if not exists uq_ranking_awards_placement_result_player
on ypl_schema_validation.ranking_awards (result_id, player_id)
where award_kind = 'placement'
  and result_id is not null;
```

`result_id` 단독 unique가 아니므로 향후 하나의 팀 Result가 서로 다른 여러 Player Award를 가지는 것을
막지 않는다. partial unique index를 PostgREST upsert conflict target으로 가정하지 않고 SELECT 후
INSERT/UPDATE/DELETE한다. 동시 INSERT가 unique 충돌하면 동일한 runtime payload가 이미 존재하는지
재조회해 같은 반영만 idempotent 성공으로 처리한다.

apply write 순서는 `Entry validation → final Match sync → Result sync → RankingAward sync → legacy save → Event completed`다.
Award sync 실패 시 Award 자체 snapshot을 복구한 뒤 Result를 apply 이전 snapshot으로 복구한다. legacy save
실패 시 RankingAward 이전 snapshot, Result 이전 snapshot 순서로 복구한다. revert는
`RankingAward 제거 → Result 제거 → legacy revert save → Event running` 순서이며, legacy revert save 실패 시
Result, RankingAward 순서로 복구한다.

P0-6 코드와 pure test, production build, Test DB unique index 및 `anon` CRUD GRANT 적용을 완료했다.
Test DB 브라우저 E2E에서는 Master / Light / Rookie 개인전을 각각 apply → revert까지 검증했다.
Master는 Result 4건과 `60 / 40 / 20 / 20` placement Award가 생성되고 legacy 랭킹·시즌 delta도 동일한
`60 / 40 / 20` 정책을 사용했다. Light는 Result 4건과 `30 / 20 / 10 / 10` Award가 생성되고 legacy도
동일한 `30 / 20 / 10` 정책을 사용했다. Rookie는 Result 4건만 생성되고 RankingAward는 0건이며
legacy 누적 랭킹과 시즌 성적도 변경되지 않았다. 세 경우 모두 revert 후 runtime Result / Award가 제거되고
Match / Entry / EntryParticipant는 유지되는 것을 확인했다. RLS와 Production은 변경하지 않았다.
따라서 P0-6 normalized RankingAward 구현 및 Test DB E2E는 완료됐다.

### P0-7 normalized 전체 lifecycle 회귀

P0-4~P0-6에서 구현한 Match / Result / RankingAward lifecycle을 실제 운영과 유사한 하나의 Event에서 end-to-end로 검증했다.

Test Event는 `제7회 파이컵라이트`이며 application Registration 4명(Test1~4)과 대진표 생성 시 추가한 manual Registration 2명(Test5~6), 총 6명으로 진행했다.

대진표 생성 시 Player / Registration / Entry / EntryParticipant 6명이 정상 확정됐고 Event는 open에서 running으로 전환됐다. 6인 Double Elimination을 끝까지 진행한 결과 Reset Final을 포함한 runtime Match 11건이 생성됐으며 11건 모두 played, unresolved 0건, duplicate source node 0건이었다.

첫 기록 반영에서는 Result 4건과 RankingAward 4건이 생성됐다. Light canonical policy에 따라 Test1 우승 +30, Test3 준우승 +20, Test4 / Test6 4강 각 +10이 반영됐으며 legacy ranking / season delta와 normalized Award가 일치했다.

반영 취소 후 RankingAward와 Result는 각각 0건으로 제거됐고 Match 11건, Entry 6건, EntryParticipant 6건은 유지됐다. legacy 해당 회차도 제거됐으며 Event는 running, record_applied_at은 NULL로 복구됐다.

이후 경기 결과를 수정해 우승자를 Test1에서 Test6으로 변경하고 재반영했다. 새 결과는 Test6 우승 +30, Test1 준우승 +20, Test3 / Test4 4강 각 +10이었다. 이전 Test1 champion Result와 win Award는 남지 않았고 새 Result와 RankingAward는 각각 정확히 4건이었다. duplicate Result와 duplicate RankingAward도 모두 0건이었다.

전체 과정에서 Event lifecycle은 running → completed → running → completed로 정상 동작했고 legacy ranking / season도 재반영 결과와 정확히 일치했다.

따라서 P0-7 개인전 normalized write lifecycle 회귀 검증은 완료됐다.

### P0-8 Records normalized read

Test 환경에서 `VITE_YPL_DATA_SCHEMA=ypl_schema_validation`이 명시된 경우에만 normalized Records read를 활성화한다. Production의 `public` schema 또는 명시되지 않은 환경에서는 기존 legacy Records 경로를 유지한다.

공식 normalized 공개 범위는 `status=completed`, `record_applied_at IS NOT NULL`, 개인전·팀전 Event의 교집합이다. 이 Event는 다음 관계를 직접 읽는다.

```text
Event → Entry → EntryParticipant → Player
      → Match
      → Result → RankingAward
Season → RankingBaseline
EventRegistration.final_submission_id → RegistrationSubmission → TeamSnapshot → TeamSnapshotMember
```

- 트레이너 identity는 이름이 아니라 `Player.id`를 사용한다. 동명이인은 별도 profile로 유지하며 fuzzy merge하지 않는다.
- normalized Event ID가 `round.recordMeta.eventId` 또는 `bracket.eventId`에 연결되면 같은 legacy 회차와 대진표는 표시·집계에서 제외한다.
- 과거 migrated Event 중 `record_applied_at`이 없는 기록과 legacy-only 팀전·챔피언스 기록은 legacy fallback으로 보존한다.
- 팀전 공식 Result는 Team Entry당 1개로 읽고, `EntryParticipant`를 통해 각 Player profile history로 펼친다. history label은 `팀 우승`, `팀 준우승`, `팀 4강`이며 개인 placement count에는 포함하지 않는다.
- 팀전 RankingAward는 저장된 ledger를 그대로 사용한다. Team Master 30 / 20, Team Light 15 / 10의 points-only 정책과 `win_delta = runner_up_delta = top4_delta = 0`을 projection에서 재계산하지 않는다.
- normalized team Event와 `recordMeta.eventId`로 명시적으로 연결된 legacy round는 placement / history / archive 중복을 만들지 않는다. 연결된 legacy team bracket은 roster / Pokémon / 기존 Match compatibility source로 유지한다.
- 누적·시즌 랭킹은 `RankingBaseline`에 placement / adjustment / reversal 등 전체 `RankingAward` ledger를 합산한다. `counts_series`와 `counts_season`을 각각 적용하고 동일 Award ID 및 동일 `(result_id, player_id)` placement를 중복 집계하지 않는다.
- 공개 경기 수는 양쪽 Entry와 승자가 확정된 bracket Match만 계산한다. BYE, unresolved, cancelled는 제외하며 개인 승·패·승률 UI는 추가하지 않는다.
- 포켓몬 기록은 finalized Event에서 final submission이 가리키는 immutable TeamSnapshot의 `pokemon_id`만
  사용한다. final pointer가 없으면 legacy party를 fallback하지 않는다. `team_revealed_at IS NULL`인
  historical compatibility Event에서만 같은 Event/Player로 연결된 legacy party를 명시적으로 fallback한다.
- Pokémon display name은 `pokemon_id`로 canonical Pokédex를 resolve하고 한국어 localized name을 우선 사용한다.
  resolve 실패 때만 `pokemon_name_snapshot`을 표시하며, aggregation은 이름이 아닌 `pokemon_id` 기준이다.
- normalized 개인전 tournament archive는 `Event → Entry(entry_type=individual) → EntryParticipant
  → EventRegistration`의 실제 참가자 전체를 읽는다. Result가 있는 참가자는 우승 / 준우승 / 4강으로,
  Result가 없는 실제 참가자는 참가로 표시하며 8강·5위·6위 등을 추론하지 않는다.
- archive 회차는 기존 `bk-submission-toggle` 계열 accordion / collapsible UI를 재사용하고 collapsed 상태에서는
  party를 숨긴다. 펼친 상태에서만 실제 참가자의 final party를 표시하며, final이 없으면 `파티 미제출`을 표시한다.
  신청만 하고 EntryParticipant가 없는 Registration은 제외하고 팀전 party 상세는 포함하지 않는다.
- normalized 조회 실패는 화면에 오류와 재시도 버튼을 표시하며 조용히 legacy만 보여주지 않는다.

Test 프로젝트 `nmqrmvnjenjqityuhngb`의 `ypl_schema_validation.ranking_baselines`에는 Records 조회에 필요한 `anon SELECT`만 추가했다. 재조회 결과 `anon`의 INSERT / UPDATE / DELETE 권한은 없고 RLS 상태도 변경하지 않았다. Production DB는 변경하지 않았다.

브라우저 E2E에서 `제7회 파이컵라이트`가 normalized 회차로 정확히 한 번 표시되고 Test6 우승 +30, Test1 준우승 +20, Test3 / Test4 4강 각 +10이 누적 및 YPL 시즌 3 랭킹에 중복 없이 반영되는 것을 확인했다. Test2 / Test5는 참가 기록만 표시된다. 기존 팀전·챔피언스 아카이브와 legacy 포켓몬 기록도 유지된다.

### P1-1 Team Entry / EntryParticipant identity

Event-linked 팀전의 실제 참가 확정 단계를 normalized 구조에 연결했다.

신청자의 팀 지망은 `EventRegistration.registration_data.answers`에 저장된 실제 form field ID를 그대로 읽는다. P1-1에서는 이를 팀 편성 참고 정보로 표시하며 자동 배정 알고리즘은 추가하지 않았다. 최종 팀 구성은 기존 팀명 / 쉼표 구분 팀원 UI에서 운영자가 확정한다.

팀 편성 확정 시 구조는 다음과 같다.

```text
EventRegistration
→ Player identity 확정
→ Team Entry
   ├─ EntryParticipant
   ├─ EntryParticipant
   └─ ...
→ legacy team Bracket participant
```

Team Entry는 `entry_type = team`이며 실제 팀 하나당 한 행을 생성한다. 각 팀원은 자신의 EventRegistration / Player와 연결된 EntryParticipant 한 행을 가진다. `member_order`는 최종 팀 편성 순서를 보존한다.

legacy 팀 participant에는 팀의 `entryId`와 멤버별 `memberIdentities`를 저장한다. 각 member identity에는 `registrationId`, `playerId`, `entryParticipantId`, `memberOrder`가 포함된다.

Player 식별 정책은 개인전과 동일하다. 신청 시 이미 exact single match된 Player는 재사용하고, 실제 참가 확정 시 아직 NULL인 Registration은 exact match를 다시 수행한다. 0명이면 신규 Player를 만들고 2명 이상이면 자동 확정을 중단한다. fuzzy match는 사용하지 않는다.

기록 반영 전 Bracket 삭제 시 FK 역순으로 EntryParticipant와 Team Entry를 제거하고, 이번 참가 확정에서만 연결하거나 생성한 Registration / Player identity를 원복한다. 기존 Player와 신청 단계에서 이미 연결돼 있던 Registration.player_id는 보존한다.

#### P1-1 Test DB E2E

Test Event `P1-1 팀전 E2E 테스트` (`964a0322-1bad-46ea-a4b0-6ff1eec71336`)에서 20명으로 실제 브라우저 E2E를 진행했다.

- EventRegistration 20명
- 기존 Player exact match 4명, 미확정 16명
- 추가 질문으로 저장된 1지망 / 2지망 / 3지망 답변 표시 확인
- 4팀 × 5명으로 수동 팀 편성
- Team Entry 4건
- EntryParticipant 20건
- Event `open → running`
- Match / Result / RankingAward 0건 유지
- 기존 Player 4명 재사용
- 신규 이름 16명의 Player 생성 및 Registration link

기록 반영 전 Bracket 삭제 후에는 Entry와 EntryParticipant가 모두 0건으로 제거됐고 Event가 `open`으로 복구됐다. 신규 Player 16명은 제거되고 해당 Registration.player_id는 다시 NULL이 됐으며 기존 Player 연결 4명은 그대로 유지됐다.

같은 Event에서 동일 팀 구성으로 다시 대진표를 생성한 결과 Team Entry 4건 / EntryParticipant 20건이 다시 정확히 생성됐고 중복 Player 참가, 중복 Registration 사용, 중복 Team Entry는 모두 0건이었다. legacy Bracket의 `entryId` / `memberIdentities`도 재생성된 normalized identity와 일치했다.

따라서 P1-1 Team Entry / EntryParticipant identity lifecycle은 Test DB 브라우저 E2E까지 완료됐다.

P1-2 normalized team Match는 Test DB 브라우저 E2E까지 완료했다.
P1-3 Team Result / player RankingAward, P1-4 team record lifecycle, P1-5 normalized team Records read도 Test DB 브라우저 E2E까지 완료했다.
Event-linked canonical 팀전 write와 Records read가 활성화됐으며 P1 전체가 Test 환경 기준 완료됐다.

### Event 수정 / 삭제 일관성

Event가 연결된 신청 공지를 수정할 때 기존 Event의 다음 상태를 보존한다.

- `season_id`
- 기존 `registration_settings`
- 기존 Event `status` — 명시적으로 변경하지 않는 한 유지

공지 삭제는 연결 Event를 물리 삭제하지 않고 `cancelled`로 전환한다.

### 팀전

Event-linked canonical 팀전은 normalized team participant identity, Team Entry, EntryParticipant를 사용한다.
P1-4까지 팀전 Match / Result / RankingAward 및 legacy 기록 반영 lifecycle을 완료했고, P1-5에서 normalized team Records read와 개인 / 팀 placement count 분리를 완료했다.
legacy-only 팀전과 전환 이전 Bracket은 기존 compatibility path로 유지한다.

### 전환 원칙

- schema에 테이블이 존재하는 것과 runtime에서 사용하는 것은 구분한다.
- migration 검증 완료와 Production 적용 완료를 구분한다.
- Production `ypl_data_v4`는 normalized end-to-end 검증 전까지 유지한다.
- Production Supabase는 별도 migration 단계 전까지 변경하지 않는다.

---

## P1-2 normalized team Match runtime

- 팀 대 팀 경기는 parent `Match(match_kind='bracket')`로 저장한다.
- 실제 개인전은 child `Match(match_kind='team_bout')`로 저장하고 실제 Player ID를 사용한다.
- 팀장은 `EntryParticipant.role='captain'`으로 보존하며 canonical 팀 명단과 실제 경기 lineup은 분리한다.
- 경기별 출전자 변경과 동일 선수 복수 경기 출전을 지원한다.
- 일반전 동점 시 UI에서는 `타이브레이커`를 사용하되 내부 `match_kind='ace'`, `series.ace`, `:ace` source key는 유지한다.
- stable source key를 기준으로 기존 Match row를 갱신하며 변경되지 않은 경기의 `played_at`은 보존한다.
- 결과 변경 시 stale child/downstream Match를 정리하고 legacy 저장 실패 시 snapshot을 복구한다.
- P1-5 Records normalized team read 및 개인 / 팀 placement count 분리까지 완료했다.

## P1-3 normalized Team Result / player RankingAward

- 공식 팀 성적은 Team Entry당 Result 1개로 저장하며 선수별 Result를 중복 생성하지 않는다.
- Team Master 우승 / 준우승은 각 공식 멤버에게 30 / 20, Team Light 우승 / 준우승은 15 / 10을 지급한다.
- 팀 4강은 Result만 보존하고 RankingAward는 생성하지 않는다.
- 팀전 RankingAward는 points-only이며 `win_delta = 0`, `runner_up_delta = 0`, `top4_delta = 0`이다.
- `counts_series = true`, `counts_season = true`를 사용하고 Player는 `Result.entry_id → EntryParticipant → Player`로 해석한다.

## P1-4 normalized team record lifecycle

Test Event `P1-1 팀전 E2E 테스트`에서 팀전 기록 반영 / 취소 / 결과 변경 / 재반영을 Test DB로 검증했다.

- 첫 반영: 2팀 champion / runner_up, Result 2건 / RankingAward 8건
- 반영 취소: Event `running`, `record_applied_at = NULL`, Result / Award 0건, Match 6건 및 Entry 2건 / EntryParticipant 8건 유지
- 결과 변경 후 재반영: champion / runner_up 교체, Result 2건 / RankingAward 8건, duplicate 없음
- legacy ranking / season과 normalized Result / RankingAward가 일치

## P1-5 Records normalized team read

P1-5는 normalized completed 팀전 Event를 Records read 대상에 포함하고 개인 / 팀 placement count를 분리하는 단계다. Test DB 브라우저 E2E와 local acceptance audit까지 완료했다.

```text
normalized completed Event
→ Team Entry
→ Result (Team Entry당 1개)
→ EntryParticipant
→ Player profile history
```

- 공식 Event는 `status = completed`이고 `record_applied_at IS NOT NULL`인 개인전·팀전을 읽는다.
- 팀 history는 `팀 우승`, `팀 준우승`, `팀 4강`으로 보존한다.
- 팀 placement는 legacy snapshot, normalized merged projection, RecordsPage profile hero의 개인 `wins / runnerUps / top4` count에서 제외한다.
- 개인전 placement count와 기존 Player ID 기반 dedupe는 유지한다.
- Team RankingAward는 저장된 ledger를 그대로 읽는다. Team Master는 멤버별 30 / 20, Team Light는 15 / 10이며, 팀 Award의 개인 placement count delta는 0이다.
- 팀 4강 Result는 보존할 수 있고 RankingAward는 생성하지 않는다.
- normalized team Event와 `recordMeta.eventId`로 명시적으로 연결된 legacy tournament round는 placement / history / archive에서 중복하지 않는다.
- 연결된 legacy team bracket은 제거하지 않고 roster / Pokémon / 기존 Match compatibility source로 유지한다. 그 bracket에서 파생된 placement / history만 normalized team 기록과 중복하지 않도록 제외한다.
- legacy-only 팀전, 과거 챔피언스 기록, legacy Pokémon fallback은 기존 compatibility path로 유지한다.
- team_bout / ace Match는 normalized DB와 linked legacy compatibility source에 보존하지만 P1-5에서 새 Records 상세 UI는 추가하지 않는다.
- `source` metadata는 projection / dedupe / debug 내부에 유지하고 일반 사용자 화면에는 표시하지 않는다. `m-a`, `m-b`, `none` 등 raw 내부 code도 UI에서 제거한다.

Team Builder의 공식 roster 연결과 `final_submission_id` freeze 및 Records의 공식 Snapshot projection은 P2-5와
P2-6에서 완료했다. TeamSnapshot이 보존하는 ability / nature / Stat Points / item / moves는 추후 archive
상세 엔트리 보기 UX로 확장할 수 있으나 P2-6 범위에는 포함하지 않는다.

## 2026-09-06 Champions Brackets 운영 및 Final official party E2E

Champions는 하나의 공지에서 Qualifier / Final Event를 분리 생성한다. Player identity만 공유하며,
EventRegistration, Entry, EntryParticipant, RegistrationSubmission, TeamSnapshot은 stage별 독립 사실이다.
Qualifier는 `championship_phase='qualifier'`, Double Elimination, `division=NULL`; Final은
`championship_phase='final'`, Single Elimination, `division=NULL`이다.

BracketsPage의 Event picker는 phase label(`[선발전]` / `[본선]`)로 두 Event를 일반 Event처럼 표시한다.
Qualifier 화면은 실제 참가자를 확정해 Double runtime을 진행하고 `qualification_slots` 선수만 선택해
qualifier advancement를 만든다. Final 화면은 ranking/manual direct advancement를 필요한 경우에만 추가하고,
Final EventRegistration 후보를 기존 수동 참가 확정에 제공한다. 사용자에게 raw advancement source/table
관리 UI를 노출하지 않는다.

Final official party contract:

```text
Final EventRegistration (application / advancement / manual)
→ Team Builder exact-name lookup
→ RegistrationSubmission (revisioned)
→ immutable TeamSnapshot
→ TeamSnapshotMember
→ record apply freeze: EventRegistration.final_submission_id
→ champion Result
→ HallOfFameEntry
```

`submit_registration_team_snapshot`은 Event와 Registration을 잠그고 open/running 및
`record_applied_at IS NULL`을 확인하며, `application`, `advancement`, `manual` source만 exact match로
수락한다. freeze는 실제 `EntryParticipant` Registration만 대상으로 최신 revision을 선택한다. 따라서
완료·기록반영된 Event에 새 historical submission을 attach하지 않는다.

Test browser E2E에서는 새 2인 Final에서 advancement Registration 두 건이 Team Builder로 각각 제출되어
RegistrationSubmission 2건, TeamSnapshot 2건, TeamSnapshotMember가 생성됐다. 대진·승자·기록 반영 뒤
두 `final_submission_id`가 각 최신 submission을 가리켰고, champion HOF dialog가 winner snapshot의
`pokemon_id` 기반 Gardevoir를 표시했다. legacy `image_ref`는 이 경로에 사용하지 않았다.

Championship advancement/HOF domain RPC의 현재 Test 배포는 `SECURITY DEFINER`와 빈 `search_path`를
사용한다. strict Event/phase/ownership/state 검증 및 narrow anon `EXECUTE`를 유지하며 broad table grant는
추가하지 않았다. Production Auth/RLS cutover 전에 이 privilege model을 재검토한다.

2026-09-07 Champions 삭제 lifecycle 및 normalized storage invariant

Champions의 사용자 관점 lifecycle은 다음과 같이 고정한다.

Champions 공지
→ Qualifier Event
→ 선발전 진행
→ qualification_slots명 본선 진출 확정

동시에:

Champions 공지
→ Final Event
→ 기존 직행자 + Qualifier 통과자
→ 본선 진행
→ Result / RankingAward
→ Champion Hall of Fame

ChampionshipAdvancement의 ranking / qualifier / manual은 서로 다른 tournament mode가 아니라 Final 진출 provenance다.

일반적인 8인 Final은 다음과 같이 구성한다.

기존 본선 진출권 4명
ranking
필요 시 manual replacement
선발전 통과자 4명
qualifier

manual은 일반적인 제3의 진출 루트가 아니라 불참자 대체 등 운영 예외를 기록하는 용도로 본다.

Qualifier bracket 삭제

Qualifier bracket 삭제는 단순히 화면의 bracket graph만 제거하는 작업이 아니라 대진 생성 전 상태로의 operational rollback이다.

삭제 시 다음 순서를 따른다.

해당 Qualifier Entry를 source_entry_id로 가진 qualifier advancement를 취소한다.
해당 advancement가 만든 Final EventRegistration(registration_source = advancement)을 함께 취소한다.
Qualifier의 normalized Match를 삭제한다.
BracketEntrySlot을 삭제한다.
BracketIdentityChange ownership metadata를 snapshot한 뒤 metadata row를 삭제한다.
runtime이 생성한 EntryParticipant를 삭제한다.
runtime이 생성한 Entry를 삭제한다.
기존 Registration의 player_id를 이전 값으로 복구하거나 runtime-created Registration을 삭제한다.
다른 사실에서 참조되지 않는 runtime-created Player만 삭제한다.
BracketRuntime을 삭제한다.
Event status를 runtime 생성 전 previous_event_status로 복구한다.

ranking 또는 manual advancement는 Qualifier bracket에서 파생된 사실이 아니므로 Qualifier 삭제와 무관하게 보존한다.

예를 들어 Final 후보가 다음과 같았다면:

ranking 3
manual 1
qualifier 4

Qualifier bracket 삭제 후에는:

ranking 3
manual 1
qualifier 0

이 canonical 상태다.

Qualifier가 이미 completed 상태여도 다음 조건을 만족하면 bracket 삭제를 허용한다.

event_type = champions
championship_phase = qualifier
record_applied_at IS NULL

Qualifier는 최종 placement tournament가 아니므로 Result, RankingAward, HallOfFameEntry를 생성하지 않는다.

Final bracket 삭제

Final bracket 삭제는 본선 진출 자격 자체를 취소하는 작업이 아니다.

따라서 Final bracket 삭제 시:

삭제:

Final Match
Final Entry
Final EntryParticipant
BracketEntrySlot
BracketIdentityChange
BracketRuntime

유지:

Final EventRegistration
ChampionshipAdvancement
본선 진출 provenance

즉 본선 진출자 확정과 본선 대진 생성은 서로 다른 lifecycle 단계다.

Final bracket을 삭제한 뒤에도 같은 Final Registration들을 이용해 다시 참가자를 확정하고 bracket을 재생성할 수 있어야 한다.

Final 기록 반영 취소

Champions Final의 기록 반영 취소는 FK dependency를 고려해 다음 순서를 따른다.

HallOfFameEntry 제거
RankingAward 제거
Result 제거
final submission freeze 해제
Event record application revert

중간 단계에서 실패하면 이미 제거한 Result / RankingAward / HallOfFameEntry를 compensation restore한다.

Hall of Fame compensation은 기존 HOF row의 identity를 보존하기 위해 원래 HallOfFameEntry.id로 복구할 수 있어야 한다.

Qualifier에는 Hall of Fame을 생성하지 않는다.

normalized bracket storage invariant

신규 Event-linked normalized bracket의 canonical source는 다음 persistent fact다.

Event
→ BracketRuntime
→ BracketEntrySlot
→ Match
→ pure bracket projection

Bracket graph 자체는 canonical persistent data가 아니다.

따라서 public.site_data / ypl_data_v4.brackets에는 projection.source = "normalized"인 bracket을 저장하지 않는다.

애플리케이션의 global save() boundary에서 normalized bracket을 제거하며, BracketsPage의 legacy compatibility merge에서도 projection.source = "normalized"인 bracket을 제외한다.

이 원칙으로 normalized runtime이 삭제된 뒤 예전에 site_data.brackets에 남은 사본이 legacy bracket처럼 다시 나타나는 ghost fallback을 방지한다.

site_data.brackets에는 historical / legacy-only bracket compatibility data만 남긴다.

runtime identity rollback

generic Team / Double runtime 삭제도 BracketIdentityChange를 rollback ownership ledger로 사용한다.

runtime deletion은 runtime artifact만 제거하는 것이 아니라, ownership metadata가 명확하게 증명하는 경우에 한해 다음 domain identity를 원복한다.

runtime-created EntryParticipant
runtime-created Entry
runtime-created Registration
runtime이 변경한 기존 Registration.player_id
runtime-created Player

기존 Player 또는 다른 Event / Result / RankingAward / HallOfFameEntry 등에서 사용 중인 Player는 삭제하지 않는다.

ownership이 불명확하거나 exact-match가 깨진 상태에서는 자동 정리하지 않고 fail closed한다.

generic runtime create failure compensation

Team / Double runtime 생성 과정은 다음 두 구간으로 구분한다.

participant confirmation 성공, runtime 생성 전 실패
client의 rollbackEventParticipantConfirmation()으로 원복
runtime 생성 성공 후 후속 단계 실패
delete_normalized_bracket_runtime()이 participant identity까지 atomic rollback

runtime delete RPC가 성공한 뒤 client에서 participant confirmation rollback을 다시 수행하지 않는다.

이를 통해 double rollback을 방지한다.

11인 multi-BYE materialization

Single / Double bracket에서 BYE 또는 unresolved future node 자체를 Match row로 저장하지 않는다.

하지만 BYE closure에 의해 downstream node의 양쪽 participant가 이미 확정된 경우 해당 node는 실제 formed Match이므로 runtime create 시 즉시 materialize한다.

기존 runtime에서 이 Match가 누락된 경우 winner mutation 경로에서 안전하게 repair할 수 있다.

이 정책으로 11인 bracket처럼 여러 BYE가 동시에 발생하는 non-power-of-two 참가자 수에서도 winner 변경 / 취소 / advancement가 정상 동작한다.

2026-09-07 검증 상태

Champions / HOF / bracket deletion 관련 targeted regression:

25 tests
25 PASS

검증 범위:

11인 Single multi-BYE
11인 Double multi-BYE
Champions Qualifier / Final Event pair
advancement lifecycle
Final HOF 생성
HOF revert compensation
individual Single Elimination runtime deletion
completed Champions Qualifier deletion
qualifier-derived advancement 자동 취소
ranking / manual advancement 보존
FK-safe identity rollback
generic runtime create failure double-rollback 방지
normalized bracket의 site_data ghost 재발 방지

추가 검증:

production build PASS
git diff --check PASS
LF → CRLF 메시지는 Windows working-copy line-ending warning이며 whitespace error는 없음
Test Supabase에서 Qualifier deletion 실제 smoke PASS

Production Supabase migration / read / write는 수행하지 않았다.