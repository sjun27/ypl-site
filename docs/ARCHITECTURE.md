# YPL 기술 구조 및 데이터 아키텍처

> 이 문서는 YPL 사이트의 **현재 기술 구조, 데이터 원본, 테스트 안전수칙, Records 데이터 모델 및 향후 migration 원칙**을 관리합니다.
>
> 현재 할 일과 우선순위는 `docs/ROADMAP.md`, 실제 변경 이력은 `docs/PATCH_NOTES_2026-08-26.md`를 봅니다.

마지막 업데이트: 2026-08-29

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

현재 운영 데이터의 기준 원본은 다음입니다.

```text
Supabase
table: site_data
key: ypl_data_v4
```

GitHub 코드의 SEED는 fallback 및 개발용 기본 데이터이며 자동 백업본이 아닙니다.

따라서:

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

현재 Records 1차 버전은 새 테이블을 만들지 않고 이 데이터를 읽어 파생 기록을 계산합니다.

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

대회 엔트리 제출 기능을 추가할 때는 개인 작업본을 그대로 연결하지 않고 **제출 당시 Team Snapshot을 별도로 고정**합니다.

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

현재 legacy JSON 단계에서는 대진표 graph를 Match 원본으로 봅니다.

```text
대진표 결과 입력
→ 기록에 반영
→ 대회 회차 생성
→ 랭킹 / 시즌 성적 반영
→ recordMeta 연결
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

팀전 입상은 해당 트레이너의 통산 우승·준우승·4강 집계에도 포함합니다.

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

# 10. 목표 데이터 모델

운영 데이터 조사 후 다음 객체로 정규화하는 것을 목표로 합니다.

## Player

트레이너 고유 식별자.

이름 문자열만 연결 키로 쓰지 않고 장기적으로 `player_id`를 사용합니다.

## Season

시즌 정보.

## Tournament

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

한 Player의 한 Tournament 참가 기록.

## Team Snapshot / Entry Pokémon

제출 당시 엔트리 고정본.

## Match

실제 경기 사실.

예:

- tournament_id
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
   ├─ Entry
   │  └─ EntryParticipant ── Player
   │     └─ EntrySubmission
   │        └─ TeamSnapshot
   │           └─ TeamSnapshotMember
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

`EntrySubmission`은 `Entry` 자체가 아니라 **EntryParticipant**에 귀속한다.

이유:

- 개인전: EntryParticipant 1명 → 해당 선수의 제출
- 팀전: EntryParticipant 여러 명 → 각 선수의 제출을 독립적으로 관리
- 팀전에서도 선수별 재제출, 기준 시각 이후 제출, 최종 제출본 확정이 가능해야 함

따라서 공식 최종 제출 포인터도 `EntryParticipant.final_submission_id`로 관리한다.

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

---

## 5. Event

Event는 특정 시즌에 실제로 한 번 열린 대회 하나를 뜻한다.

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
- is_team_event
- regulation_id nullable
- cup_rule_id nullable
- cup_rule_settings nullable
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
- entry_id
- player_id
- member_order
- role nullable
- final_submission_id nullable
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

## 7. EntrySubmission

```text
EntrySubmission
- id
- entry_participant_id
- snapshot_id
- revision
- submitted_at nullable
- source
- created_at
```

권장 제약:

```text
UNIQUE(entry_participant_id, revision)
```

대회 진행 중 현재 공식 제출본:

```text
해당 EntryParticipant의 가장 높은 revision
```

대회 종료 후 공식 역사 기록:

```text
EntryParticipant.final_submission_id
```

과거 Submission은 삭제하지 않는다.

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
- 기술 4개 미만, 일부 설정 미완성도 Regulation-invalid가 아니면 허용
- Pokémon 0마리는 공식 제출 불가
- Stat Points는 계산 결과가 아니라 입력 사실을 저장
- IV는 Pokémon Champions에서 고정이므로 v1에 저장하지 않음
- Tera Type은 현재 Mega Rule 기준 v1에서 제외하며 미래 Regulation 확정 후 schema version 증가로 추가 가능
- `pokemon_id`는 form-specific stable canonical ID를 사용
- species clause 판정용 identity와 Snapshot 복원용 pokemon_id를 분리
- Snapshot 생성 후 기존 Snapshot을 수정하지 않음

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

팀전 기본 배분식 자체보다 각 선수에게 최종 적용된 실제 값을 원본으로 본다.

수정 이력은 overwrite가 아니라 ledger 방식:

```text
placement +20
adjustment +5
reversal -20
```

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

이미지는 DB에 base64로 직접 저장하지 않고 `image_ref`만 저장한다.

---

## 15. Source of Truth 요약

| 알고 싶은 것 | 원본 |
|---|---|
| 시즌 | Season |
| 대회 | Event |
| 참가 단위 | Entry |
| 실제 참가 선수 | EntryParticipant |
| 제출/재제출 이력 | EntrySubmission |
| 제출 당시 팀 세팅 | TeamSnapshot / TeamSnapshotMember |
| 실제 경기 | Match |
| 공식 최종 성적 | Result |
| 공식 통산 우승·준우승·4강 | Result → EntryParticipant에서 계산 |
| 실제 랭킹 지급값 | RankingAward |
| 복원 불가능한 과거 랭킹 시작값 | RankingBaseline |
| 칭호 획득 | TitleAward |
| 파트너 포켓몬 | PlayerPartner |
| 챔피언 명예의 전당 | HallOfFameEntry |

## 16. 다음 단계

1. 이 논리 모델을 PostgreSQL/Supabase DDL로 변환
2. FK / UNIQUE / CHECK / index 설계
3. 운영 DB가 아닌 테스트 환경에서 schema 생성
4. 현재 `ypl_data_v4` → 새 모델 migration dry-run
5. 건수 및 대표 사례 대조
6. 검증 후 운영 migration 계획 수립

운영 Supabase는 DDL 및 migration 검증이 끝나기 전까지 변경하지 않는다.
<!-- YPL_NORMALIZED_MODEL_V1_END -->
