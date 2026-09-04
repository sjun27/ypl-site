# YPL 개발 로드맵

> 이 문서는 **현재 구현 상태와 앞으로의 개발 순서**만 관리합니다.
>
> - 과거 변경 이력: `docs/PATCH_NOTES_2026-08-26.md`
> - 기술 구조·데이터 모델·운영 원칙: `docs/ARCHITECTURE.md`

마지막 업데이트: 2026-09-04

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
Match (개인전 runtime mirror)
Result (개인전 runtime final placement)
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

Production 운영 데이터의 기준 원본은 아직 Supabase public.site_data / ypl_data_v4다.

normalized 구조는 Test Supabase에서 개발·검증 중이며 Production에는 적용하지 않는다.

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
normalized Event 연결 — 개인전 구현 완료 / Test
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

아직 미구현
팀전 Event의 멤버별 Registration/Player identity 확정

Event 연결 팀전은 위 구조가 완성될 때까지 차단한다.

기존 legacy-only 팀전은 유지한다.

2.3 기록 반영

현재 기록 반영은 normalized identity + legacy Records의 hybrid 구조다.

normalized에서 처리
연결 Event 확인
Bracket 생성 시 확정된 Entry / EntryParticipant / Registration / Player 검증
Event 연결 개인전의 실제 Match snapshot 동기화
Event 연결 개인전의 우승 / 준우승 / 실제 4강 Result 동기화
Event 연결 Master / Light 개인전의 실제 지급 RankingAward 동기화
전환 이전 Bracket은 기존 record-apply identity 확정 fallback 사용
Event completed
record_applied_at 기록
아직 legacy에서 처리
대회 회차
대회 회차의 입상 필드 및 기록 반영 write
누적 랭킹 / 시즌별 성적 write

Records read는 Test의 P0-8부터 완료된 normalized 개인전 Event와 legacy 과거·팀전 기록을 합치는 hybrid 구조다.

현재 정책:

Master → 랭킹 반영 / 시즌 반영
Light  → 랭킹 반영 / 시즌 반영
Rookie → 랭킹 미반영 / 시즌 미반영
Team   → normalized 기록 반영 미지원
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

Test Records는 P0-8부터 기록 반영이 완료된 normalized 개인전 Event를 직접 읽는다.
Production과 과거·팀전·챔피언스 기록은 기존 legacy `ypl_data_v4`를 유지한다.

구현된 기반:

completed + record_applied_at Event만 공식 normalized 기록으로 공개
Event → Entry → EntryParticipant → Player → Match → Result → RankingAward read
Player ID 기준 트레이너 identity
같은 Event의 normalized / legacy 회차 중복 억제
RankingBaseline + RankingAward 원장 합산
counts_series / counts_season 정책 반영
최종 TeamSnapshot 우선, 없으면 연결된 legacy party fallback
트레이너 기록
대회 기록
포켓몬 기록
랭킹
참가 대회 이력
우승 / 준우승 / 4강
팀전 입상 포함
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

Team Builder는 현재 다음 수준까지 구현되어 있다.

구현된 기반
본사이트 통합
Regulation / Cup Rule 선택
Pokémon
특성
성격 / Alignment
Stat Points
지닌물건
기술
개인 팀 localStorage 저장
아직 마무리되지 않은 영역
Pokémon 목록 / 검색 최종 검증
동일 종 / 폼 / 리전폼 identity 검증
Regulation validation 정리
도구 validation 정리
일부 번역 / 검색 데이터 정리
모노타입 관련 기능
저장 / 복원 UX 최종 회귀
설계만 완료된 영역
TeamSnapshot v1 canonical contract
아직 미구현
Team Builder → TeamSnapshot serializer
TeamSnapshot → Team Builder loader
EventRegistration 기반 공식 파티 제출
RegistrationSubmission revision
final_submission_id
관리자 제출 현황
제출 Snapshot과 Entry 연결

현재 우선순위는 Team Builder 안정화가 아니라 신청부터 기록까지 normalized 운영 흐름을 먼저 완성하는 것이다.

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
Match (Event-linked 개인전 runtime mirror)
Result (Event-linked 개인전 runtime final placement)
RankingAward (Event-linked Master / Light runtime placement payout)
schema / migration 검증은 되었으나 운영 runtime source of truth가 아닌 엔티티
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

개인전 기준으로 신청부터 Records까지 legacy 기록 저장에 의존하지 않고 하나의 normalized 흐름으로 처리할 수 있어야 한다.

P1. 팀전 normalized 연결

개인전 end-to-end 흐름이 안정된 뒤 진행한다.

EventRegistration의 팀 지망 정보 사용
팀 편성
Team Entry 생성
멤버별 EntryParticipant 생성
Player identity 확정
팀전 Match 생성
에이스 Match 생성
팀 Result 생성
선수별 RankingAward 생성
팀전 기록 반영 / 취소

완료 후 Event 연결 팀전 차단을 해제한다.

P2. Team Builder → 공식 파티 제출

신청→기록 normalized 운영 흐름을 먼저 완성한 뒤 연결한다.

Team Builder
→ TeamSnapshot v1
→ RegistrationSubmission
→ EventRegistration
→ Entry

구현:

TeamSnapshot serializer
TeamSnapshot loader
참가자 Registration 확인
공식 Submission 생성
재제출 revision 보존
제출 시각 관리
관리자 제출 현황
결과 반영 시 final_submission_id freeze
최종 Snapshot과 Entry 연결

개인 localStorage 저장본과 공식 제출 Snapshot은 분리한다.

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

바로 다음
1. P1 팀전 normalized 연결

그 이후
2. Team Builder → TeamSnapshot → 공식 Submission
3. 챔피언스 운영 자동화
4. Team Builder 자체 안정화 / 추가 UX
5. Auth / RLS
6. Production migration
