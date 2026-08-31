# YPL 개발 패치노트
## 2026-08-26

> **문서 안내**
> - 이 파일은 과거 변경 과정을 보존하는 **변경 이력(Changelog)** 입니다.
> - 현재 상태와 다음 작업은 `docs/ROADMAP.md`를 확인합니다.
> - 기술 구조·데이터 모델·Supabase 운영 원칙은 `docs/ARCHITECTURE.md`를 확인합니다.
> - 과거 단계의 정책이 이후 단계에서 변경된 경우 **가장 뒤의 최신 단계가 현재 정책**입니다.


오늘 진행한 YPL(Yonsei Pokémon League) 웹사이트 구조 개선 작업을 단계별로 기록한다.

> 원칙
> - 기존 운영 기능과 디자인은 최대한 유지한다.
> - 현재 운영 데이터는 Supabase의 `site_data / ypl_data_v4`를 기준 데이터로 유지한다.
> - 구조 개선과 신규 기능 개발을 단계적으로 분리한다.
> - 각 단계 완료 후 주요 변경사항, 변경 이유, 검증 결과, Git 커밋을 이 문서에 누적 기록한다.

---

## 1단계 — 페이지 컴포넌트 분리

### 무엇을 변경했나

기존에는 대부분의 페이지 UI와 기능이 `src/App.jsx` 한 파일에 집중되어 있었다.

약 3,257줄 규모였던 `App.jsx`에서 다음 페이지를 `src/pages/`로 분리했다.

- `HomePage.jsx`
- `AboutPage.jsx`
- `NewsPage.jsx`
- `BoardPage.jsx`
- `RecordsPage.jsx`
- `BracketsPage.jsx`
- `TitlesPage.jsx`
- `ChampionsPage.jsx`
- `src/pages/index.js`

향후 기능 확장을 위한 기본 디렉터리도 준비했다.

- `src/components/`
- `src/services/`
- `src/data/`

### 왜 변경했나

Team Builder, Battle Data, YPL Meta 등 신규 기능이 추가될 예정이므로 모든 페이지가 `App.jsx`에 계속 쌓이면 코드 탐색과 수정이 어려워지고, 한 기능 수정이 다른 기능에 영향을 줄 위험이 커진다.

페이지별로 코드를 분리하여 각 페이지의 책임 범위를 명확하게 하고 이후 기능 추가와 유지보수를 쉽게 하기 위해 진행했다.

### 사용자 체감 변화

없음.

기존 UI, 페이지 구성, 데이터 흐름, 디자인을 그대로 유지했다.

### 유지한 항목

- `ypl_data_v4`
- Supabase 저장 방식
- 기존 관리자 기능
- 기존 `view` 기반 화면 전환
- 기존 CSS 및 디자인
- 기존 production 데이터 구조

### 검증

- Production build 성공
- 기존 주요 화면 정상 전환
- 기록의 누적 랭킹 / 시즌별 성적 / 대회 회차 정상
- 공지 참가 신청 정상
- 게시판 글쓰기 정상
- 관리자 로그인 정상
- 대진표 상세 정상
- 우승 엔트리 Modal 정상
- 운영 Supabase 데이터 정상 로딩
- 브라우저 콘솔 오류 및 경고 없음
- `git diff --check` 정상

### Git

```text
d32175b refactor: split page components from App
```

---

## 2단계 — 공통 컴포넌트 분리

### 무엇을 변경했나

여러 페이지에서 공통으로 사용하는 UI를 `src/components/`로 분리했다.

#### 공통 UI

- `src/components/common/Modal.jsx`
- `src/components/common/Reveal.jsx`
- `src/components/common/Dropdown.jsx`
- `src/components/common/StandTable.jsx`
- `src/components/common/ListSearch.jsx`
- `src/components/common/Pager.jsx`

#### 레이아웃

- `src/components/layout/Navigation.jsx`
- `src/components/layout/SiteHeader.jsx`

또한 `src/components/index.js`에서 공통 컴포넌트를 export하도록 정리했다.

### 추가로 정리한 부분

- App에서 각 Page로 `Reveal`, `Modal`, `Dropdown`, `StandTable` 등을 임시 prop으로 전달하던 구조 제거
- 공지와 게시판에 중복되어 있던 `ListSearch`와 `Pager` 통합
- 데스크톱 Navigation과 모바일 drawer를 공통 레이아웃 컴포넌트로 분리
- 기존 페이지에서 공통 컴포넌트를 직접 import하도록 변경

### 왜 변경했나

같은 UI가 여러 파일에 중복되어 있으면 디자인이나 동작을 수정할 때 여러 위치를 동시에 수정해야 하고, 서로 조금씩 다른 버전이 생길 수 있다.

공통 UI를 한곳에서 관리하여 다음과 같은 구조를 만들기 위해 진행했다.

```text
App
 ├─ Pages
 └─ Components
```

앞으로 Team Builder나 Battle Data를 추가할 때도 기존 YPL의 Modal, Header, Navigation 등 공통 UI를 재사용할 수 있다.

### 사용자 체감 변화

없음.

UI 문구, 색상, 카드, Navigation 디자인, 동작을 변경하지 않고 내부 구조만 정리했다.

### 변경하지 않은 항목

- `src/storage.js`
- `STORAGE_KEY = ypl_data_v4`
- `.env.production`
- Supabase SQL / RLS / Auth
- SEED 및 production 데이터 구조
- 관리자 인증 방식
- Team Builder
- Battle Data

### Windows 빌드 검증

Windows 로컬 환경에서 Vite production build 성공.

```text
vite v5.4.21 building for production...
✓ 90 modules transformed.
dist/index.html                  6.02 kB │ gzip:   4.62 kB
dist/assets/index-Bj1l9T52.js  920.89 kB │ gzip: 417.79 kB
✓ built in 936ms
```

Production preview:

```text
http://localhost:4173/ypl-site/
```

### Git 검증

- `git diff --check`: 오류 없음
- Windows 환경의 LF → CRLF 줄바꿈 경고만 발생
- 작업 트리 clean 상태 확인

### Git

```text
160e5b1 refactor: extract common components
```

---

## 3단계 — Storage / Service 구조 정리

### 무엇을 변경했나

기존에는 `App.jsx`가 `src/storage.js`의 `getData` / `setData`를 직접 불러오고, `ypl_data_v4` 저장 키까지 직접 알고 있었다.

이번 단계에서 운영 데이터 전용 서비스 계층을 추가했다.

- `src/services/siteDataService.js` 생성
- `src/services/index.js`에서 서비스 export
- `App.jsx`는 이제 저수준 저장 함수 대신 다음 함수만 사용
  - `loadSiteData()`
  - `saveSiteData()`
- 운영 데이터 키 `ypl_data_v4`는 `SITE_DATA_KEY`로 서비스 계층에서 관리

현재 구조는 다음과 같다.

```text
App / Pages
    ↓
siteDataService
    ↓
storage.js
    ↓
window.storage / Supabase / localStorage
```

### 왜 변경했나

앞으로 Team Builder, 대회 엔트리, Battle Data 등 데이터 종류가 늘어날 때 화면 코드가 Supabase나 localStorage 구현 방식에 직접 의존하면 다시 `App.jsx`가 복잡해진다.

화면은 “YPL 운영 데이터를 읽고 저장한다”는 기능만 알고, 실제 저장 위치 선택은 기존 `storage.js`가 담당하도록 책임을 분리했다.

이렇게 하면 향후 저장 방식이 바뀌더라도 화면 코드를 대규모로 수정할 필요가 줄어든다.

### 사용자 체감 변화

없음.

기존 데이터 로딩, 저장, 참가 신청 동시 저장 확인 로직은 그대로 유지한다.

### 변경하지 않은 항목

- `src/storage.js`의 실제 저장 동작
- `STORAGE_MODE` 우선순위
  - `window.storage`
  - Supabase
  - localStorage
- production Supabase 프로젝트 연결
- `site_data` 테이블
- 기존 저장 키 `ypl_data_v4`
- SEED 구조
- 데이터 정규화(`normalizeData`)
- 테마 localStorage
- 관리자 로그인 방식
- RLS / Auth
- 기존 production 데이터

### 안전성 원칙

- 운영 Supabase에 쓰기 테스트를 하지 않음
- 기존 데이터 migration 없음
- 기존 데이터를 seed로 초기화하는 로직 추가 없음
- 서비스 계층은 기존 `getData` / `setData`를 그대로 호출함

### 검증

- 변경 범위 diff 확인
- `git diff --check` 오류 없음
- 기존 `src/storage.js` 변경 없음
- `App.jsx`에서 `getData`, `setData`, `STORAGE_KEY`, 임시 `loadData` / `persist` 직접 의존 제거 확인
- Windows 로컬에서 production build 및 preview 회귀 테스트 필요

### 예정 Git 커밋

```text
refactor: separate site data service
```

---

## 4단계 — 관리자 기능 분리

### 무엇을 변경했나

`App.jsx`에 직접 들어 있던 관리자 전용 UI와 편집 모달을 `src/admin/` 영역으로 분리했다.

추가된 구조:

- `src/admin/AdminModeBar.jsx`
- `src/admin/AdminModalHost.jsx`
- `src/admin/adminAuth.js`
- `src/admin/editors/AdminEditors.jsx`
- `src/admin/index.js`

관리자 영역으로 이동한 기능:

- 관리자 로그인 모달
- 메인 정보 수정
- 챔피언 추가·수정·삭제
- 칭호 추가·수정·삭제
- 공지 작성·수정·삭제 및 신청서 폼 빌더
- 랭킹/성적표 편집
- 대회 회차 편집
- 관리자 모드 안내 바
- 관리자 모달 종류에 따른 저장/삭제 조합 로직

`App.jsx`는 관리자 상태(`admin`)와 현재 열려 있는 모달 상태(`modal`)를 유지하되, 실제 관리자 UI 렌더링과 편집 세부 구현은 `AdminModalHost`에 맡긴다.

### 왜 변경했나

기존에는 일반 사용자 화면을 조합하는 `App.jsx` 안에 관리자 로그인과 여러 편집기의 세부 코드가 함께 들어 있어, 일반 기능 수정과 관리자 기능 수정의 경계가 불분명했다.

관리자 기능을 별도 영역으로 분리하면:

- 일반 사이트 구조와 관리자 편집 기능의 책임이 분명해짐
- 향후 관리자 기능 추가·수정 시 `App.jsx` 영향 감소
- 5단계 Supabase Auth/RLS 보안 전환 시 관리자 인증 부분만 교체하기 쉬움
- Team Builder 등 신규 기능의 관리자 도구를 향후 같은 `admin/` 영역에 추가하기 쉬움

### 사용자 체감 변화

없음.

기존과 동일하게:

```text
관리자 버튼 → 아이디/비밀번호 입력 → 관리자 모드
```

흐름을 유지한다.

### 보안 관련 주의

이번 4단계는 **보안 강화 단계가 아니다.**

기존 관리자 계정 확인 로직을 `adminAuth.js`로 위치만 옮겼으며, 클라이언트 코드에서 인증하는 현재 방식은 그대로다. 실제 서버 측 권한 검증은 5단계에서 별도로 진행한다.

### 변경하지 않은 항목

- 관리자 로그인 UX
- 관리자 ID/비밀번호 값
- 관리자 편집 기능의 동작
- `ypl_data_v4`
- `site_data` 테이블
- `src/storage.js`
- `siteDataService`
- `.env.production`
- Supabase Auth / RLS
- SEED 및 production 데이터 구조
- 사이트 디자인과 CSS

### 코드 구조 결과

`App.jsx`는 관리자 에디터 코드가 빠지면서 약 240줄 이상 감소하고, 관리자 모달의 세부 구현은 `src/admin/`으로 이동한다.

### 검증

- 전체 `src` JS/JSX TypeScript parser 구문 검사 통과
- 상대 import 누락 0건
- 기존 관리자 저장 콜백과 삭제 콜백 동작을 동일하게 유지하도록 이전
- Windows 로컬에서 production build 및 preview 회귀 테스트 필요

### 예정 Git 커밋

```text
refactor: separate admin features
```

---

## 5단계 — 관리자 인증 및 Supabase 보안 개선 (보류)

### 상태

이번 단계는 실제 운영 Supabase 프로젝트의 관리자 권한이 필요하므로 **코드에 반영하지 않고 보류**했다.

현재 운영 Supabase 프로젝트는 다른 동아리 운영진 계정에서 관리되고 있어, 추후 프로젝트 접근 권한을 확보한 뒤 다시 진행한다.

현재 관리자 로그인 및 운영 데이터 권한 구조는 4단계 완료 시점과 동일하다.

---

## 6단계 — 기존 Team Builder 통합

### 무엇을 변경했나

기존 별도 프로젝트 `YPL Team Builder v0.6`의 핵심 기능과 저장 스키마를 React 기반 YPL 본사이트 안으로 이식했다.

추가된 주요 파일:

- `src/pages/TeamBuilderPage.jsx`
- `src/team-builder.css`
- `src/data/teamBuilderRegulations.js`
- `src/data/teamBuilderCupRules.js`
- `src/data/teamBuilderLocalization.js`
- `src/services/championsData.js`
- `src/services/teamBuilderCore.js`

본사이트 Navigation에 `팀빌더` 메뉴를 추가하고 `view === "builder"`에서 독립 페이지로 렌더링한다.

### 기존 v0.6에서 유지한 기능

- 6마리 Team Slot
- Regulation M-A / M-B 데이터 구조
- Regulation별 사용 가능 포켓몬 풀
- 파이컵 추가 룰 레이어
- 모노타입 챌린지 및 배정 타입 필터
- 포켓몬 한글/영문 검색
- 동일 전국도감번호 기준 Species Clause
- 동일 도구 중복 방지 Item Clause
- 특성 선택
- 성격(Stat Alignment) 선택
- Stat Point 개별 최대 32 / 총합 최대 66 검증
- Lv.50 최종 능력치 표시
- Pokémon Champions learnset 기반 기술 4개 선택
- Regulation별 사용 가능 도구 필터
- Team Valid / Invalid / Incomplete 검증
- Team Box 저장 / 불러오기 / 복제 / 삭제
- 자동 임시저장
- `Ctrl+S` / `Cmd+S` 저장창 호출

### 기존 저장 데이터 호환

기존 v0.6에서 사용하던 localStorage 키와 저장 스키마를 유지했다.

```text
ypl-team-builder:saved-teams:v1
ypl-team-builder:working-draft:v1
```

따라서 같은 브라우저에 기존 팀빌더 v0.6 저장 데이터가 남아 있다면 새 본사이트 Team Builder에서도 그대로 읽을 수 있도록 설계했다.

### 데이터 구조 원칙

Team Builder 데이터는 기존 운영 `ypl_data_v4`에 추가하지 않았다.

현재 단계에서는:

```text
YPL 운영 데이터 → Supabase / ypl_data_v4
Team Builder 개인 팀 → 브라우저 localStorage
```

로 분리한다.

대회 엔트리 제출 및 Supabase 팀 저장은 별도 단계에서 구현한다.

### 디자인 통합

기존 v0.6의 독립 사이트 Header를 제거하고 YPL 본사이트의:

- Navigation
- 색상 변수
- 카드
- 버튼
- Modal
- Reveal animation
- 다크모드

을 그대로 사용하도록 재구성했다.

Team Builder 전용 CSS는 `.tb-*` 클래스로 scope하여 기존 페이지 스타일과 충돌하지 않도록 했다.

### 상세 데이터

기존 v0.6과 동일하게 Pokémon Showdown Champions 데이터 소스를 사용하여 다음을 불러온다.

- Pokédex / Base Stats / Type / Ability
- Champions learnset
- Move data
- Item data

상세 데이터는 브라우저 localStorage에 12시간 캐시하며, 네트워크 연결 실패 시에도 Regulation 로스터 자체는 유지된다.

### 이번 단계에서 하지 않은 것

- Battle Data 페이지 구현
- Battle Data → Team Builder 연결
- 대회 엔트리 제출
- Supabase에 개인 팀 저장
- `ypl_data_v4` 변경
- 관리자 기능 변경
- Supabase Auth / RLS 변경
- Regulation 최신 데이터 갱신

Regulation 내용 자체는 통합 대상인 기존 v0.6 데이터를 그대로 사용하며, 최신 Regulation 갱신은 별도 데이터 업데이트 작업으로 분리한다.

### 검증

- 신규 Team Builder 관련 JS/JSX 구문 검사 통과
- 신규 상대경로 import 누락 없음
- Windows 로컬 production build 및 preview 회귀 테스트 필요

### 예정 Git 커밋

```text
feat: integrate team builder
```

---

## 이후 예정 단계

### 7단계 — 대회 엔트리 제출
Team Builder에서 만든 팀을 실제 YPL 대회 엔트리로 제출할 수 있도록 연결한다.

### 8단계 — Pokémon Champions Battle Data
Pokémon Champions의 배틀 메타 데이터를 조회하고 Team Builder와 연결한다.

### 9단계 — YPL Meta
YPL 제출 엔트리 및 대회 결과를 기반으로 등록률, 인기 기술·도구, 조합, Top Cut 등의 자체 통계를 제공한다.

---

## Git 사용 원칙

오늘 개발 중 만든 커밋은 우선 로컬 Git에만 저장한다.

`git commit`만 수행한 상태에서는 GitHub 원격 저장소에는 변경사항이 올라가지 않는다.

GitHub에 공유할 준비가 끝난 뒤 명시적으로 `git push`를 수행할 때만 원격 저장소에 반영한다.

---

## 6.1단계 — Team Builder v0.6 동작 충실도 복원

6단계 통합 후 실제 사용 과정에서 독립형 `ypl-team-builder-v0.6`과 본사이트 통합본 사이에 세부 동작 차이가 확인되어, **기존 v0.6을 기능 기준본(source of truth)으로 다시 대조**했다.

### 복원한 핵심 동작

- Validation 결과 표시를 v0.6 방식으로 복원
  - `Team Valid / Team Invalid / Team Incomplete` 판정 문구 복원
  - Invalid 상태에서도 규정 위반뿐 아니라 미완성 항목과 경고를 함께 표시
  - 모노타입 타입 미선택, 6마리 미완성, 기술 4개 미설정, 상세 데이터 로딩/실패 상태를 구체적으로 안내
  - Validation 메시지에 Regulation 및 파이컵 룰 요약 표시
- Validation 내부 오류 메시지에서 포켓몬 이름을 한국어 표시명 기준으로 통일
- 성격 선택을 v0.6과 동일한 검색/선택형 입력 방식으로 복원
  - 한국어/영문 성격명 검색
  - Stat Alignment 효과 표시
  - 유효하지 않은 값 입력 시 이전 값으로 복귀
- 도구 입력 검증 복원
  - Regulation 사용 가능 도구 여부 검증
  - Item Clause 중복 입력 시 전용 오류 메시지 표시
  - 한국어/영문 도구명 검색
- 기술 입력 검증 복원
  - 해당 포켓몬의 실제 Champions learnset 기준 검증
  - 같은 기술 중복 입력 시 전용 오류 메시지 표시
  - 유효하지 않은 기술 입력 시 구체적인 오류 메시지 표시
  - 기술 메타정보(타입/분류/위력/명중/PP) 표시 유지
- Team Box 동작을 v0.6에 맞게 복원
  - 빈 팀 이름 저장 방지
  - 기본 팀 이름을 Regulation/파이컵 룰 기준으로 자동 제안
  - 이름 중복 시 번호 자동 증가
  - 저장 팀 복제 시 `복사본`, `복사본 2` 방식으로 중복 이름 회피
  - 저장 팀 수정 시각 표시
  - 현재 불러온 팀 표시
  - 삭제 시 되돌릴 수 없다는 확인 문구 표시
  - 현재 팀에서 저장되지 않은 변경사항이 있으면 다른 팀 불러오기 전에 확인
  - 현재 Regulation에서 찾을 수 없는 저장 포켓몬은 제외 후 개수 안내
- Draft/자동 임시저장 동작 복원
  - 저장소 사용 가능 여부 감지
  - `pending / saved / error` 상태 표시
  - `pagehide` 및 탭 비활성화 시 즉시 저장
  - URL로 명시적인 다른 Regulation/파이컵 룰을 요청한 경우 오래된 draft를 자동 복원하지 않음
- Regulation 전환 시 기존 v0.6과 동일하게 사용 불가능 포켓몬만 자동 제거
- 포켓몬 제거 후 선택 슬롯을 인접 슬롯으로 이동
- 포켓몬 풀을 한국어 표시명 기준으로 정렬
- 모노타입 풀 개수 표시와 빈 상태 안내 문구를 v0.6 방식으로 복원
- Regulation / 파이컵 룰 / 타입을 URL query에 동기화
- `Ctrl+S` / `Cmd+S` Team Box 호출과 `Esc` 닫기 동작 유지
- 한국어 번역 누락 audit(`window.YPL_LOCALIZATION_AUDIT`) 복원

### 유지한 항목

- YPL 본사이트 디자인 시스템
- React 페이지 구조
- 기존 v0.6 localStorage 저장 키 및 schema v2
- Pokémon Showdown Champions 데이터 소스
- 운영 `ypl_data_v4` 및 Supabase 데이터 구조

### 변경 이유

6단계의 첫 통합본은 기존 기능을 React로 재구현하는 과정에서 일부 상태 처리와 검증 UI가 단순화되었다. Team Builder는 실제 대회 엔트리 작성 도구이므로, 디자인 통일보다 **기존 검증 메커니즘과 세부 입력 규칙을 그대로 보존하는 것이 우선**이라고 판단하여 v0.6 동작을 기준으로 복원했다.

### 검증

- 전체 JS/JSX TypeScript parser 구문 검사 통과
- 상대경로 import 검사 통과
- Windows Vite production build 및 실제 브라우저 회귀 테스트 필요


---

## 6.2단계 — Team Builder UI 선택 조정 및 YPL Tools 구조 준비

6.1의 기존 v0.6 동작 복원은 유지하되, 실제 사용성이 더 좋았던 일부 최신 UI와 향후 도구 확장 구조를 반영했다.

### 변경사항

- 성격 선택 UI는 검색형 입력 대신 6단계 통합본의 드롭다운(select) 방식으로 되돌림
  - Validation 및 Stat Alignment 계산 로직은 그대로 유지
- Team Builder 페이지의 `YPL TOOLS` kicker를 파란색으로 강조
- 상단 Navigation의 기존 단일 `팀빌더` 메뉴를 `YPL Tools` 드롭다운으로 변경
  - 현재 하위 도구는 `팀빌더` 1개만 제공
  - 향후 `배틀데이터` 및 기타 도구를 `TOOL_ITEMS`에 추가할 수 있는 구조로 준비
- 데스크톱에서는 파란색 `YPL Tools` 드롭다운, 모바일 drawer에서는 파란색 Tools accordion 형태로 표시

### 유지한 항목

- 6.1에서 복원한 Validation 메커니즘
- Team Box / Draft / Regulation 전환 / Species Clause / Item Clause / 기술 legality 등 기존 v0.6 동작
- 기존 YPL 디자인 시스템과 운영 데이터 구조
- Team Builder localStorage 저장 방식

### 변경 이유

Team Builder 자체의 검증 메커니즘은 기존 v0.6을 기준으로 유지하되, 성격 선택은 단순 드롭다운 방식이 실제 사용성이 더 좋다고 판단했다. 또한 Team Builder, Battle Data 등 향후 여러 기능을 개별 상단 메뉴로 계속 추가하지 않고 `YPL Tools` 아래에 묶을 수 있도록 Navigation 구조를 미리 준비했다.


---

## 6.3단계 — YPL Tools 내비게이션 톤 통일

6.2 적용 후 실제 화면에서 파란색 CTA 형태의 `YPL Tools`가 기존 YPL 내비게이션보다 지나치게 강조되어 이질적으로 보이는 문제가 확인되어 시각 체계를 다시 통일했다.

### 변경사항

- 데스크톱 `YPL Tools`를 기존 일반 메뉴와 동일한 색상 토큰과 hover/active 체계로 변경
  - 파란색 배경 버튼 제거
  - 기존 메뉴보다 약간 작은 13.5px로 조정
  - 선택 상태는 기존 메뉴와 같은 텍스트 강조 + 하단 indicator 사용
- `YPL Tools` 위치를 `명예의 전당` 오른쪽으로 이동하여 일반 리그 메뉴와 도구 그룹의 구조를 분리
- 드롭다운은 기존 카드/라인/텍스트 색상 변수를 사용하도록 수정하여 라이트/다크 모드에서 동일한 디자인 원칙 적용
- 모바일 drawer의 Tools trigger도 파란색 배경을 제거하고 기존 drawer 메뉴의 색상 체계와 동일하게 변경
- Team Builder 본문의 `YPL TOOLS` kicker에서 별도 파란색을 제거하고 다른 보조 레이블과 같은 muted 색상으로 통일
- kicker 크기를 10.5px로 소폭 축소
- 한국어 UI 표기를 `팀빌더`에서 `팀 빌더`로 통일
- `YPL Tools` 드롭다운 확장 구조는 그대로 유지

### 유지한 항목

- 6.1의 Validation / Team Box / Draft / Regulation / legality 메커니즘
- 6.2의 성격 select UI
- Team Builder localStorage 저장 구조
- 운영 Supabase 및 `ypl_data_v4`

### 변경 이유

`YPL Tools`는 향후 여러 도구를 묶는 정보 구조상의 그룹이지 주요 CTA 버튼이 아니므로, 독립적인 파란색 버튼보다 기존 YPL 내비게이션과 같은 시각 위계를 사용하는 것이 사이트 전체 일관성에 더 적합하다. 다크모드에서도 별도 하드코딩 색을 사용하지 않고 기존 CSS 변수에 의존하도록 해 두 테마에서 동일한 위계를 유지했다.


---

## 6.4단계 — Team Builder 인터랙션 피드백 및 Validation 위치 개선

6.3의 YPL Tools 톤 통일과 기존 Team Builder 검증 로직은 유지하면서, 클릭 가능한 인터페이스가 정적인 박스처럼 보이던 부분을 개선하고 Team Validation의 정보 위계를 상향했다.

### 변경사항

- Team Validation을 상세 세팅 영역 하단에서 Regulation 카드 바로 아래로 이동
  - 팀을 편집하기 전에 현재 상태를 빠르게 확인할 수 있도록 페이지 상단에 배치
  - 기존 YPL 카드 디자인을 해치지 않도록 패딩, 아이콘, 라운드 값을 줄인 얇은 상태 패널 형태로 조정
  - Validation 로직 및 상세 오류/미완성/경고 메시지는 변경하지 않음
  - 메시지가 많을 때 데스크톱에서는 2열, 모바일에서는 1열로 표시
- Regulation / 파이컵 추가 룰 / 배정 타입 select에 hover 및 focus 피드백 추가
- 포켓몬 선택 목록에서 hover 시 이름과 추가 표시가 기존 YPL accent 체계로 반응하도록 개선
- 팀 구성 슬롯에서 hover/focus 시 테두리와 포켓몬 이름이 자연스럽게 반응하도록 개선
- 특성 / 성격 / 도구 / 기술 입력 영역에 hover/focus 피드백 추가
- 기술 카드 자체도 hover/focus-within 시 테두리와 배경이 반응하도록 개선
- Stat Point 행, slider, 숫자 입력에 hover/focus 반응 추가
- Team Box 저장 팀 항목에도 hover/focus 피드백 추가
- 라이트/다크 모드 모두 하드코딩된 새 강조색을 추가하지 않고 기존 `--cyan`, `--cyan-d`, `--s-card`, `--s-soft`, `--line2` 토큰 사용

### 디자인 원칙

- 실제 클릭/입력이 가능한 곳 위주로 상호작용을 추가하고 단순 정보 카드에는 hover 효과를 남발하지 않음
- hover가 없어도 모바일/터치 환경에서 모든 기능을 사용할 수 있도록 기존 click/tap 동작은 그대로 유지
- 새 애니메이션이나 큰 이동 효과 대신 기존 YPL UI와 같은 테두리·배경·텍스트 변화 중심으로 적용

### 유지한 항목

- 6.1의 Validation 계산 및 상세 메시지 메커니즘
- 6.2의 성격 select UI
- 6.3의 YPL Tools 위치/톤/드롭다운 구조
- Team Box / Draft / Regulation / Species Clause / Item Clause / 기술 legality
- localStorage 및 운영 Supabase / `ypl_data_v4` 구조


---

## 6.4.1 — 기술 입력 hover 범위 조정

6.4에서 기술 입력 카드 전체에 hover/focus-within 반응을 적용했으나, 실제 선택 컨트롤보다 카드 전체가 강조되어 시각적으로 과한 문제가 확인되어 범위를 축소했다.

### 변경사항

- 기술 1~4의 바깥 카드(`tb-move-field`)는 hover/focus 시 배경과 테두리가 변하지 않도록 원래 상태 유지
- 실제 기술명 입력·드롭다운 컨트롤(`tb-input`)에만 기존 hover/focus 테두리 반응 유지
- 기술 메타데이터·설명 영역은 hover에 따라 함께 강조되지 않음
- 라이트/다크 모드 모두 기존 디자인 토큰을 그대로 사용

### 유지한 항목

- 6.4의 Regulation / 파이컵 추가 룰 / 포켓몬 목록 / 팀 슬롯 / 특성 / 성격 / 도구 / Stat Point / Team Box 인터랙션
- 상단 Team Validation 배치 및 검증 로직
- 6.3의 YPL Tools 위치·크기·색상·다크모드 처리

---

## 7단계 — YPL Records System 1차 구현 및 대진표 연동

### 목표

기존 `기록` 페이지를 단순 누적 랭킹 화면에서 YPL 내부 대회 기록을 조회하는 Records System의 1차 버전으로 확장했다.

현재 단계에서는 Supabase 테이블을 새로 만들지 않고 기존 `ypl_data_v4`의 다음 데이터를 읽어 조합한다.

- `tournaments[].rounds`
- `brackets[]`
- `rankings[]`
- `seasons[]`
- `champions[]`
- `titleGroups[]`

즉 **기존 운영 데이터 구조를 유지한 상태에서 먼저 조회·연동 계층을 구현**했다.

### 기록 페이지 구조

기록 페이지를 다음 구조로 변경했다.

```text
기록
├─ 트레이너
├─ 대회
├─ 포켓몬
└─ 랭킹
   ├─ 누적
   └─ 시즌별
```

기존 누적 랭킹과 시즌별 성적 편집 기능은 제거하지 않고 `랭킹` 영역으로 이동했다.

### 트레이너 기록

`src/services/recordsAnalytics.js`에서 기존 데이터와 반영 완료된 대진표를 읽어 트레이너별 기록을 계산한다.

현재 제공하는 정보:

- 과거 대회 우승 / 준우승 / 4강
- 기록 확인이 가능한 대회 참가 이력
- 공식 경기 승 / 패 / 승률
- 상대 전적 기반 Rival
- 등록 엔트리 기반 자주 사용한 포켓몬
- 기존 칭호
- 명예의 전당 기록

과거 대회의 경기별 승패는 추측하지 않는다.

**공식 경기 전적은 YPL 시즌 3부터 집계**하며, 실제로 기록에 반영된 개인전 대진표의 Match만 계산한다.

- BYE / 부전승은 공식 1승으로 계산하지 않음
- 팀전 개인 경기의 통산 전적 반영 정책은 아직 확정하지 않아 현재 제외
- 과거 우승·준우승·4강은 기존 회차 기록을 그대로 유지

### 대회 아카이브

기존 대회 회차 데이터를 Records의 `대회` 영역에서 조회하도록 연결했다.

- 전체 보기
- 기존 대회 분류별 보기
- 날짜 / 회차 / 시즌 / 룰
- 우승 / 준우승 / 4강
- 대진표와 연결된 경우 참가자·엔트리 데이터 활용

개별 대회 회차의 시각 형식은 신규 카드 디자인으로 재해석하지 않고 **기존 운영 사이트의 `round2 / r2-*` 레이아웃을 기준으로 복원**했다.

회차 번호, 룰, 우승자·준우승자·4강 등 기존 데이터 값은 자동 생성하지 않으며 저장된 값을 그대로 표시한다.

### 포켓몬 기록

기록에 반영된 대진표의 참가 엔트리를 기준으로 다음 항목을 집계한다.

- 엔트리 등록 횟수
- 엔트리 채용률
- 사용 트레이너 수
- 우승 / 준우승 / 4강 엔트리 포함 횟수
- 같이 등록된 포켓몬
- 시즌별 등록 기록
- 기존 명예의 전당 우승 엔트리 연결

엔트리 6마리에 포함됐다는 사실만으로 실제 경기 선출 여부를 알 수 없으므로 **포켓몬 승률은 만들지 않았다.**

### 대진표 → 기록 반영

대진표 종료 후 `기록에 반영`을 실행하면 다음 항목을 하나의 연결된 기록으로 처리한다.

1. 대상 대회의 회차 추가
2. 선택한 누적 랭킹 반영
3. 선택한 시즌 성적 반영
4. 대진표에 `applied` 메타데이터 저장
5. Records의 트레이너 / 대회 / 포켓몬 조회 결과에 즉시 반영

연동 회차에는 안정적인 `round.id`와 `recordMeta`를 저장한다.

`recordMeta`에는 다음 원복 정보가 포함된다.

- 원본 대진표 ID
- 반영 랭킹
- 반영 시즌
- 입상자별 증감치
- 새로 생성된 랭킹/시즌 행 여부
- 반영 당시 포인트 설정

### 반영 취소 및 회차 동기화

`src/services/recordSync.js`를 추가해 대진표에서 생성한 기록을 되돌릴 수 있게 했다.

`반영 취소` 시:

- 연결된 대회 회차 삭제
- 누적 랭킹 증감 원복
- 시즌 성적 증감 원복
- 테스트 과정에서 새로 생성된 0점 행 제거
- 대진표의 `applied` 상태 해제

대진표에서 생성된 회차를 기존 `회차 편집` 화면에서 편집·삭제할 때도 `id`와 `recordMeta`를 유지하도록 `RoundsEditor`를 수정했다.

### 기록 반영 후 대진표 잠금

기록 반영이 완료된 대진표는 **읽기 전용 상태로 잠근다.**

반영 상태에서는 다음 변경을 막는다.

- 경기 승자 변경 / 취소
- 팀전 세부 시리즈 결과 변경
- 파티·엔트리 수정
- 조별리그 본선 대진 재생성
- 대진표 자체 삭제

결과를 수정하려면 먼저 `반영 취소`를 실행해 기록·랭킹·시즌 성적을 원복한 뒤 대진표를 수정하고 다시 반영한다.

이 잠금은 기록에 반영된 결과와 대진표 원본이 우발적인 클릭 한 번으로 달라지는 것을 방지하기 위한 것이다.

### 로컬 SEED와 운영 Supabase 차이

개발 중 로컬 SEED와 운영 Supabase의 회차 데이터가 완전히 같지 않다는 점을 확인했다.

확인 당시 예:

- 로컬 SEED 클래식: 35회
- 운영 Supabase 클래식: 28회
- 반대로 운영 사이트에만 반영된 최신 회차도 일부 존재

따라서 로컬 개발에서 보이는 기존 회차 수·입상자 정보의 절대값은 운영 데이터 검증 기준으로 사용하지 않는다.

운영 데이터의 기준 원본은 계속:

```text
Supabase
site_data
key = ypl_data_v4
```

이다.

기능 테스트에서는 기존 절대값 대신 **반영 전 → 반영 후 → 반영 취소 후의 변화량**을 기준으로 검증한다.

향후 Supabase 접근권한 확보 후 운영 데이터를 백업한 뒤 SEED 동기화 여부를 별도로 결정한다.

### 검증

현재까지 확인한 항목:

- Records 페이지 Production build 성공
- 트레이너 / 대회 / 포켓몬 / 랭킹 화면 렌더링
- 기존 대회 회차 UI 복원
- 테스트 대진표 생성
- 대진표 결과 입력
- 기록 반영
- 대회 회차 증가
- 누적 랭킹 / 시즌 성적 연동
- Records 트레이너 기록 연동
- 반영 취소 후 연결 데이터 원복

기록 반영 후 대진표 잠금은 브라우저 회귀 테스트에서 정상 작동을 확인했다. 반영 상태에서는 수정이 차단되고, `반영 취소 → 수정 → 재반영` 흐름이 정상 동작한다.

### 변경하지 않은 항목

- 운영 Supabase 스키마
- `site_data / ypl_data_v4`
- Supabase Auth / RLS
- 기존 과거 경기 승패의 임의 복원
- Team Builder 저장 구조
- 칭호 자동 지급
- 명예의 전당 자동 등록

## 7.1단계 — 트레이너 기록 공개 정책 및 챔피언스 시리즈 표기 개선

### 공개 정책 변경

Records가 Match 원본을 보존하는 것과 모든 파생 통계를 회원에게 공개하는 것을 분리했다.

YPL 시즌 3부터 경기별 승자·패자, 상대, 경기 단계, 시즌·대회 등 Match 원본은 계속 보존한다. 따라서 필요하면 내부적으로 개인 승/패, 승률, 상대전적, 연승 등을 다시 계산할 수 있다.

다만 동아리 대회의 참여 장벽과 개인 성적의 과도한 평가화를 피하기 위해 트레이너 기본 공개 화면에서는 다음 항목을 제거했다.

- 개인 공식 승/패
- 개인 승률
- Rival / 가장 많이 만난 상대의 상대전적
- 트레이너 목록의 공식 경기 수

트레이너 기본 화면은 참가, 우승, 준우승, 4강, 대회 이력, 엔트리, 칭호, 명예의 전당 중심으로 유지한다.

### 챔피언스 시리즈 입상 이력

기존 트레이너 대회 이력은 마스터리그에 속한 챔피언스 시리즈도 마스터리그 회차 번호로 표시했다.

이를 다음처럼 변경했다.

```text
기존
마스터리그 8회

변경
🏆 챔피언스 시리즈 2회
```

챔피언스 시리즈 번호는 별도로 계산하지 않는다. 대회 회차 편집에서 이미 저장한 `round` 값을 그대로 사용하고, `champ` 값은 해당 회차를 `챔피언스 시리즈 N회`로 표시할지 여부만 결정한다.

초기 골드 카드 강조안은 실제 화면에서 우승 색상과 의미가 겹쳐 이질적으로 보여, 최종적으로는 배경·보더·트로피 아이콘을 제거하고 작은 `CHAMPIONS SERIES` 키커와 제목 위계만으로 구분하도록 수정했다.

### 유지한 내부 데이터

이번 변경은 표시 정책 변경이다.

- `recordsAnalytics.js`의 Match 원본 수집 유지
- YPL 시즌 3 시작 기준 유지
- BYE 제외 유지
- 팀전 선발 대결 및 에이스 결정전 Match 원본 포함
- 승패·승률·상대전적을 계산할 수 있는 원본 삭제 없음
- 운영 Supabase 스키마와 `ypl_data_v4` 변경 없음

### 함께 반영한 진행상황

- 기록 반영 후 대진표 잠금 브라우저 테스트 완료 상태 반영
- 별도 테스트 Supabase는 현재 만들지 않음
- 개인 GitHub Pages는 운영위원 내부 베타·조회용으로 사용
- 파이컵 Light의 향후 공식 전적 범위는 당장 결정하지 않고 Match 원본을 우선 보존
---

## 7.2단계 — 전체 참가 이력 및 팀전 기록 확장

### 전체 대회 이력

기존 트레이너의 `대회 이력`은 회차 데이터에 남아 있는 우승·준우승·4강만 표시했다.

앞으로 기록에 반영된 대진표가 있는 대회는 참가자 전원의 최종 성적을 대진표에서 자동 계산하여 표시한다.

- 싱글 엘리미네이션: 우승 / 준우승 / 4강 / 8강 / 16강 등 최종 도달 라운드
- 더블 엘리미네이션: 우승 / 준우승 / 3위 / 4위 / 공동 5위 등 최종 순위
- 조별리그 + 본선: 본선 도달 성적 또는 `조별리그 탈락`
- 팀전: 팀의 최종 성적을 각 팀원의 대회 이력에 연결

과거 대진표가 없는 대회는 기존에 확인 가능한 우승·준우승·4강 기록만 유지하며, 누락된 참가자나 성적을 추정하지 않는다.

### 팀전 기록

팀전도 Records의 정식 기록 범위에 포함한다.

- 팀 우승·준우승·4강은 해당 팀원 각자의 우승·준우승·4강 집계에 포함
- 팀전의 선발 순서에 따른 개별 대결을 Match 원본으로 보존
- 동점 시 에이스 결정전도 별도 Match 원본으로 보존
- Match에는 개인전/팀전 구분을 유지
- 개인 승/패·승률은 계속 기본 공개하지 않음

누적 랭킹의 포인트 배분 규칙 자체는 이번 변경에서 수정하지 않는다. 이번 변경은 Records의 원본 보존과 트레이너 기록 표시 범위를 확장하는 작업이다.

### 챔피언스 시리즈 회차 정보 수정

챔피언스 시리즈의 회차 번호를 날짜순으로 별도 생성하던 로직을 제거했다.

회차 번호의 source of truth는 대회 회차에 저장된 `round` 값이다.

```text
round = 8
champ = true
→ 챔피언스 시리즈 8회
```

`champ`는 표시 종류만 결정하며 별도 번호를 만들지 않는다.

### 안내 문구

Records 상단 안내는 과거 기록과 대진표 기반 신규 기록의 범위를 구분하도록 수정했다.

- 과거: 확인 가능한 입상 기록
- YPL 시즌 3 이후 반영 대진표: 개인전·팀전 전체 참가 이력 및 실제 경기 원본
- 개인 승/패·승률 등 평가성 지표: 기본 미노출

### 데이터 구조

새 Supabase 테이블이나 migration은 추가하지 않는다.

현재 `ypl_data_v4`의 대진표 graph, 팀전 `series`, 연결 회차 정보를 읽어 Records 분석 계층에서 파생한다.

---

<!-- YPL_2026_08_31_FINAL_OPERATION_MODEL -->

## 8단계 — 정규화 DB 및 migration 검증

운영 `site_data / ypl_data_v4`를 조사해 정규화 모델과 DDL을 작성하고 별도 Test Supabase에서 legacy migration을 검증했다.

Registration 도입 이전 회귀 기준:

```text
Players              64
Seasons               6
Events                57
Entries              214
EntryParticipants    254
Results              204
Matches               39
RankingBaselines     160
TeamSnapshots         13
SnapshotMembers       78
Submissions           13
HallOfFame              6
PlayerPartners          8
TitleDefinitions       42
TitleAwards            44
```

과거 기록은 없는 사실을 역추정하지 않고 확인 가능한 사실만 이전한다.

관련 Git:

```text
6653125 fix: correct normalized schema constraints
b33b1d4 fix: align normalized schema with legacy records
b4eb8ed fix: preserve legacy records in normalized schema
```

---

## 9단계 — Champions qualifier / final 모델

- 선발전 / 본선을 별도 Event로 저장
- Player identity만 공유
- Entry / Submission / TeamSnapshot 독립
- qualifier Match 저장
- qualifier Result / RankingAward / HOF 없음
- advancement type = ranking / qualifier / manual
- 과거 자료가 없으면 qualifier를 역추정하지 않음

관련 Git:

```text
6b89002 feat: model champions qualifier and final stages
```

---

## 10단계 — 신청 / 제출 / 팀 편성 / 대진표 운영 구조 확정

> 이 단계는 사용자-facing 구현이 아니라 최신 운영 구조의 설계 확정이다.

### 신청과 실제 참가

초기 잠정안의 `신청 = Entry(applied)`를 폐기했다.

```text
EventRegistration = 참가 신청
Entry = 실제 대진표 참가 단위
```

### 파티 제출

팀 편성/대진표 생성 전에도 제출할 수 있도록 Submission을 EventRegistration에 귀속한다.

```text
EventRegistration
└─ RegistrationSubmission
   └─ immutable TeamSnapshot
```

Snapshot은 단순 Pokémon 엔트리 목록이 아니라 다음 전체 배틀 세팅을 보존한다.

```text
Pokémon
특성
성격
Stat Points 6종
지닌물건
기술 최대 4개
```

- 신청 직후 제출 가능
- 결과 적용 전까지 재제출 가능
- 결과 적용 시 final submission freeze
- revision 전체 보존

### 모노타입

`assignedType`은 참가자가 Team Builder에서 직접 선택하는 로컬 상태다.

- localStorage / validation 사용 가능
- DB 저장 안 함
- TeamSnapshot 저장 안 함
- Records 표시 안 함

### 대진표 참가 확정

- 신청자 전원 기본 체크
- 불참자만 체크 해제
- 미제출자도 참가 가능
- 대진표 생성 시 실제 Entry 생성
- 별도 참가 확정/취소 화면 없음

### 팀전 편성

기존 1·2·3지망 신청 방식을 유지한다.

자동 추천은:

```text
인원 균등
+ 1/2/3지망 만족도
→ 추천 초안
→ 재생성 가능
→ 운영진 수정
```

실력 밸런스는 시스템이 계산하지 않는다.

### 에이스전

실제 정규 개인전 수를 기준으로 한다.

- 홀수 → 동률 불가 → ace 없음
- 짝수 → 동률 가능
- 실제 동률일 때만 ace Match

### HOF

신규 Champions 본선 HOF는 우승자의 final TeamSnapshot에서 Pokémon ID를 읽어 sprite를 자동 렌더링한다.

Pokémon 파티 이미지를 새로 업로드/base64 저장하지 않는다.

### Champions 본선 Registration

본선 진출 확정 시 실제 본선 Entry를 미리 만들지 않는다.

```text
ranking / qualifier / manual advancement 확정
→ Final EventRegistration(source=advancement)
→ 본선 파티 제출 가능
→ 본선 대진표 생성 시 Entry 생성
```

따라서 ChampionshipAdvancement의 대상은 `final_entry_id`가 아니라 `final_registration_id`로 변경한다.

### legacy Registration

기존 13개 historical Submission을 잃지 않기 위해 최신 migration에서는 `registration_source = migration`인 기술적 EventRegistration anchor를 사용한다.

이는 실제 과거 신청서가 존재했다는 뜻이 아니며 과거 신청자 수 통계에 사용하지 않는다.

## 2026-09-01 normalized DB migration 검증

### legacy migration generator

`ypl_data_v4`를 최신 normalized schema로 이전하는 generator를 새로 작성했다.

- EventRegistration(source=migration) 기술 anchor 생성
- 기존 Entry / EntryParticipant / Result 관계 보존
- historical TeamSnapshot / RegistrationSubmission 복원
- 저장된 bracket에서 recoverable Match 복원
- 과거 랭킹은 RankingAward를 역산하지 않고 RankingBaseline으로 보존
- partner 그룹의 Pokémon을 Player로 오인하지 않고 PlayerPartner로 분리
- Champions HOF를 실제 champion Result 및 final TeamSnapshot과 연결

### Test DB 회귀검증

YPL_DB_Test의 빈 `ypl_schema_validation` schema에 최신 DDL과 생성 migration SQL을 적용하여 검증했다.

```text
Players                   64
Seasons                    6
Events                    57
EventRegistrations       254
Entries                  214
EntryParticipants        254
Results                  204
Matches                   39
RankingBaselines         160
RankingAwards              0
TeamSnapshots             13
TeamSnapshotMembers       78
RegistrationSubmissions   13
TitleDefinitions          42
TitleAwards               44
PlayerPartners             8
HallOfFameEntries          6
```

추가 회귀검증:

- 이동하 Player identity 1건 유지 및 클래식 누적 25점 확인
- HOF 6건 모두 champion Result → Registration → final Submission → 6 Pokémon Snapshot 연결 확인
- partner Pokémon과 Player 이름 충돌 0건 확인
- 과거 battle_format은 추정하지 않아 전부 NULL 유지
- 저장된 3개 bracket만 competition_format = double_elimination 적용
- 팀명이 없는 historical 팀전은 임의 이름을 만들지 않고 Entry.display_name = NULL 유지
- historical title award date가 없는 44건은 `awarded_at = NULL`로 보존
- Production Supabase는 이번 검증 과정에서 변경하지 않음
- 최신 normalized DDL은 기존 Test schema에 재실행해도 constraint/table/index 충돌 없이 정상 적용됨
- 빈 Test schema에서도 최신 DDL → legacy migration 전체 재적용 및 회귀검증 통과

### 랭킹 반영 정책

YPL 시즌 3 이후 랭킹 반영 여부는 Event의 `competition_settings.rankingEnabled`를 기준으로 처리한다.

- 마스터 리그: 반영
- 팀전: 반영
- 파이컵 라이트: 반영
- 루키 리그: 미반영

Result와 RankingAward는 분리하여, 랭킹 비반영 대회도 공식 성적 Result는 그대로 보존한다.
