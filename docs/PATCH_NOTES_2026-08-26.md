# YPL 개발 패치노트
## 2026-08-26

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

> 예정

목표는 UI 코드와 데이터 읽기·쓰기 로직을 분리하는 것이다.

예정 방향:

- 기존 `src/storage.js`의 역할과 사용처 분석
- Supabase / localStorage / fallback 처리의 책임 분리
- 화면 컴포넌트가 저장소 구현 방식에 직접 의존하지 않도록 service 계층 정리
- 기존 `ypl_data_v4` 및 운영 Supabase 데이터는 그대로 유지
- 기존 production 데이터에 대한 쓰기 테스트는 하지 않음

3단계 완료 후 실제 변경사항과 검증 결과를 이 문서에 추가한다.

---

## 이후 예정 단계

### 4단계 — 관리자 로직 분리
App 내부의 관리자 관련 UI와 편집 로직을 별도 영역으로 정리한다.

### 5단계 — 관리자 인증 및 Supabase 보안 개선
사용자 경험은 현재처럼 단순한 관리자 로그인 형태를 유지하면서, 브라우저 코드가 아니라 서버 측에서 실제 권한을 검증하도록 개선한다.

### 6단계 — 기존 Team Builder 통합
기존 YPL Team Builder 기능을 최대한 재사용하고 현재 YPL 본사이트 디자인에 맞춰 통합한다.

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
