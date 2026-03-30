# PKM 프로젝트 컨텍스트

## 프로젝트 개요

개인 지식 관리(PKM) 시스템을 처음부터 직접 설계하고 구현하는 프로젝트.
기존 도구(Notion, Obsidian 등)를 쓰지 않고, 완전히 자신의 사고 구조에 맞게 설계하는 것이 목표.

---

## 핵심 설계 원칙

1. **캡처와 정리를 완전히 분리한다** — 캡처 순간에 판단이 개입하면 마찰이 생긴다
2. **완벽한 캡처보다 캡처 가능한 순간을 최대화한다** — 걷는 중엔 핵심 단어 하나만 붙잡고, 멈추는 순간 30초 안에 꺼낸다
3. **각 층마다 요구사항이 다르다** — 캡처층은 속도, 처리층은 판단, 저장층은 탐색

---

## 시스템 구조 (3층)

```
캡처층 → 처리층 → 저장층
```

### 캡처층
- 마찰 제로. 판단 없이 무조건 던진다
- 모바일(Android) 웹뷰 앱으로 구현 예정
- 형식 강제 없음 — 짧은 텍스트, 긴 텍스트, 이미지 모두 수용

### 처리층
- 주기적으로 inbox를 훑으며 판단하는 곳
- **AI 정제** — Claude API가 날것 메모를 받아 content 재작성, 태그 제안, NoteLink 후보 제시
- 사람이 확인·승인 후 저장층으로 보냄
- 이메일 inbox 스타일 UI (목록 + 상세 2패널, 키보드 단축키 D/S/↑↓)

### 저장층
- 정제된 노트만 올라오는 곳
- 그래프 뷰 + 아웃라이너 모드 전환
- 다른 사람도 읽을 수 있는 형태 (위키 역할)

---

## 데이터 스키마 (v4 — 최종)

### Note (핵심 엔티티)
```sql
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,          -- UUID
  type        TEXT NOT NULL              -- 'text' | 'image' | 'voice' | 'cluster'
              CHECK(type IN ('text', 'image', 'voice', 'cluster')),
  content     TEXT,
  status      TEXT NOT NULL DEFAULT 'inbox'
              CHECK(status IN ('inbox', 'processing', 'done', 'deleted')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT                       -- soft delete
);
```

### NoteLink (개념 간 관계)
```sql
CREATE TABLE note_links (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES notes(id),
  target_id      TEXT NOT NULL REFERENCES notes(id),
  relation_type  TEXT NOT NULL
                 CHECK(relation_type IN ('derive', 'contradict', 'support', 'related')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

relation_type 정의:
- `derive` — A에서 B가 파생됐다
- `contradict` — A와 B는 양립할 수 없다
- `support` — A가 B를 뒷받침한다
- `related` — 느슨한 연관

### NoteEvolution (시간적 관계)
```sql
CREATE TABLE note_evolutions (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES notes(id),
  target_id       TEXT NOT NULL REFERENCES notes(id),
  evolution_type  TEXT NOT NULL
                  CHECK(evolution_type IN ('extends', 'shrinks', 'decay')),
  evolved_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

evolution_type 정의:
- `extends` — 개념이 능동적으로 확장됐다
- `shrinks` — 개념의 범위가 능동적으로 좁아졌다
- `decay` — 시간이 지나면서 자연스럽게 흐릿해졌다 (shrinks와 달리 의도적이지 않음)

### NoteClusterMembership (N:M 클러스터 소속)
```sql
CREATE TABLE note_cluster_memberships (
  note_id     TEXT NOT NULL REFERENCES notes(id),
  cluster_id  TEXT NOT NULL REFERENCES notes(id),  -- type='cluster'인 Note
  PRIMARY KEY (note_id, cluster_id)
);
```

cluster 설계 원칙:
- cluster는 별도 테이블이 아니라 `type='cluster'`인 Note다 (재귀적 구조)
- 하나의 Note가 여러 cluster에 동시에 속할 수 있다 (N:M)
- cluster 자체도 다른 cluster의 멤버가 될 수 있다 (추상화의 추상화)
- UI에서는 우선 숨겨두고, 나중에 필요할 때 꺼낸다

### Tag / NoteTag
```sql
CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE note_tags (
  note_id  TEXT NOT NULL REFERENCES notes(id),
  tag_id   TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (note_id, tag_id)
);
```

### Attachment
```sql
CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id),
  url        TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## API 설계 (REST)

### /notes
| Method | Path | 설명 | 레이어 |
|--------|------|------|--------|
| POST | /notes | 노트 생성 | 캡처층 |
| GET | /notes?status=inbox&tag=X&q=X | 목록·필터링 | 처리층 |
| GET | /notes/search?q=X | 전문 검색 | 저장층 |
| GET | /notes/:id | 상세 조회 | 처리·저장층 |
| PATCH | /notes/:id | 상태·내용 수정 | 처리층 |
| DELETE | /notes/:id | soft delete | 처리층 |
| POST | /notes/:id/refine | AI 정제 요청 | 처리층 |
| POST | /notes/:id/merge | 여러 노트 병합 (AI merge용) | 저장층 |

### /links
| Method | Path | 설명 |
|--------|------|------|
| POST | /links | 개념 간 연결 생성 |
| DELETE | /links/:id | 연결 삭제 |

### /evolutions
| Method | Path | 설명 |
|--------|------|------|
| POST | /evolutions | 시간적 관계 생성 |
| DELETE | /evolutions/:id | 시간적 관계 삭제 |

### /graph
| Method | Path | 설명 |
|--------|------|------|
| GET | /graph?cluster_id=X | 노드+엣지 한 번에 |

### /clusters (UI에서 우선 숨김)
| Method | Path | 설명 |
|--------|------|------|
| POST | /clusters | 클러스터 생성 |
| GET | /clusters/:id/members | 멤버 목록 |
| PATCH | /clusters/:id/members | 멤버 추가·제거 |

### /tags
| Method | Path | 설명 |
|--------|------|------|
| GET | /tags | 태그 목록 (사용 빈도 포함) |
| POST | /tags | 태그 생성 |

---

## AI 정제 설계

### 흐름
```
날것 노트 선택 (처리층)
  → POST /notes/:id/refine
  → Claude API (claude-sonnet-4-6)
  → content 재작성 + 태그 제안 + NoteLink 후보
  → 사람이 확인·수정
  → PATCH /notes/:id 로 반영
  → 저장층으로
```

### 구현 방식
- tool use 방식으로 구조화된 JSON 응답 강제 (파싱 실패 방지)
- 컨텍스트로 기존 `status='done'` 노트 최대 20개 전달
- API 키 없을 때 원본 그대로 반환 (graceful fallback)

### 미래 확장
- `/notes/:id/merge` — 여러 노트를 AI가 하나로 병합, 원본들과 NoteEvolution `extends` 관계 자동 생성
- 주기적 자동 merge — AI 모델이 유사 노트를 찾아 merge 제안
- 로컬 경량 모델 전환 가능 — `services/refine.js` 내부 구현만 교체하면 됨

---

## 기술 스택

### 1단계 (현재 — 로컬)
- **백엔드**: Node.js + Express
- **DB**: SQLite + better-sqlite3 (동기 API, WAL 모드)
- **AI**: @anthropic-ai/sdk (claude-sonnet-4-6)
- **캡처층 앱**: Android 웹뷰 (HTML/JS로 UI 작성 후 웹뷰로 감쌈)
- **처리·저장층**: 웹 브라우저 (localhost)
- **인프라**: 로컬 실행 (node server.js)

### 2단계 (나중 — 동기화 필요시)
- **옵션 A**: Cloudflare Tunnel — PC 서버를 외부 노출, 코드 변경 없음
- **옵션 B**: Fly.io / Railway + Turso — SQLite 호환 클라우드 DB

---

## 프로젝트 구조

```
pkm/
  server.js                  # Express 진입점 (포트 3000)
  .env                       # ANTHROPIC_API_KEY (gitignore)
  .env.example               # API 키 형식 안내
  .gitignore
  db/
    init.js                  # DB 초기화 + 스키마 생성
    pkm.db                   # SQLite 파일 (자동 생성, gitignore)
  routes/
    notes.js                 # /notes 라우터
    links.js                 # /links 라우터
    evolutions.js            # /evolutions 라우터
    graph.js                 # /graph 라우터
    clusters.js              # /clusters 라우터
    tags.js                  # /tags 라우터
  services/
    refine.js                # AI 정제 — Claude API 연결
```

---

## 현재 진행 상황

- [x] PKM 원칙 및 3층 구조 설계
- [x] 데이터 스키마 설계 (v4)
- [x] API 설계 (REST)
- [x] UI/UX 설계 (캡처층 모바일, 처리층 inbox, 저장층 그래프/아웃라이너)
- [x] 기술 스택 선택
- [x] 백엔드 구현 (Express + SQLite)
- [x] AI 정제 서비스 구현 (Claude API, tool use)
- [x] .gitignore 설정

---

## 다음 작업

### 즉시
- [ ] 캡처층 Android 웹뷰 앱
  - HTML/JS로 캡처 UI 작성 (설계된 모바일 UI 기반)
  - Android WebView로 감싸기
  - 로컬 서버 (192.168.x.x:3000)에 fetch로 연결

### 그 다음
- [ ] 처리층 웹 UI (localhost에서 브라우저로 접근)
- [ ] 저장층 웹 UI (그래프 뷰 + 아웃라이너)
- [ ] /notes/:id/merge 엔드포인트 구현
- [ ] AI 정제 프롬프트 튜닝

### 나중에
- [ ] 기기 간 동기화 (Cloudflare Tunnel 또는 Turso)
- [ ] 주기적 AI merge 자동화
- [ ] 로컬 경량 모델 검토
