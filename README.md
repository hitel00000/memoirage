# PKM (Personal Knowledge Manager)

PKM은 앱 서버 없이 동작하는 offline-first PWA입니다.  
노트는 브라우저 IndexedDB에 저장되며, 캡처/처리/저장(그래프) 흐름을 정적 파일만으로 실행합니다.

## 핵심 방향

- 앱 런타임에서 전용 백엔드를 두지 않는다.
- 로컬 우선(IndexedDB)을 기본 데이터 원천으로 사용한다.
- GitHub Pages 같은 정적 호스팅을 1차 배포 타깃으로 삼는다.
- Firestore는 선택적 확장 경로로 유지한다.

## 현재 구조

```
pkm/
├── CONTEXT.md
├── README.md
├── db.js
├── index.html
├── capture.html
├── processing.html
├── graph.html
├── manifest.json
├── sw.js
├── icon-192.png
└── icon-512.png
```

모든 앱 파일이 루트에 있으며, 링크/스크립트/매니페스트 경로는 `./...` 상대경로 기준으로 맞춰져 있습니다.  
이 구조는 GitHub Pages의 프로젝트 경로(`https://username.github.io/repo-name/`)에서도 경로가 깨지지 않도록 설계되어 있습니다.

## 로컬 실행

1. 루트에서 정적 서버 실행:

   ```bash
   python -m http.server 8000
   ```

2. 브라우저에서 접속:
   - `http://localhost:8000/index.html`
   - `http://localhost:8000/capture.html`
   - `http://localhost:8000/processing.html`
   - `http://localhost:8000/graph.html`

참고:
- 위 방식은 정적 파일 서빙이며 앱 백엔드가 아닙니다.
- `file://`로 직접 열면 Service Worker와 설치형 PWA 동작이 제한될 수 있습니다.

## 저장 계층 (`db.js`)

- 기본: `IndexedDBStore` (`notes`, `links`, 필터, soft delete, clear)
- 선택: `FirestoreStore` (`config.useFirestore = true` + Firebase SDK 필요)
- 공통 API:
  `initDB`, `saveNote`, `getNotes`, `getNoteById`, `updateNote`, `deleteNote`, `saveLink`, `getLinks`, `deleteLink`, `clearDB`, `setConfig`, `getConfig`

## GitHub Pages 배포

1. 이 저장소를 GitHub에 push
2. 저장소 Settings -> Pages
3. Build and deployment:
   - Source: Deploy from a branch
   - Branch: `main` / root
4. 배포 URL 확인:
   - `https://<username>.github.io/<repo-name>/`

현재 경로는 상대경로(`./...`)이므로 프로젝트 페이지 경로에서도 정상 동작합니다.

## 남은 작업

- `graph.html`에 `links` 기반 관계 시각화 로직 연결
- Firestore 모드 사용 시 설정/초기화 문서 보강
- 오프라인 UX 개선(오프라인 안내 UI, 캐시 업데이트 UX)
