# 싱크블록


Excalidraw v0.17.3 베이스로 작업된 화이트보드 프로젝트 입니다.
WebRTC(Janus 미디어 서버), 슬라이드 기능등 연동 되어있습니다.

NodeJs20, React18 로 되어있습니다..

이 프로젝트를 실행시, room 서버와 같이 켜져야하며, firebase storage를 사용하며, mongodb로 씬 정보를 저장하고 있습니다. mongodb와는 api로 연결되어있습니다.

room 서버 : https://github.com/ucompanion/white-board-room  
Excalidraw: https://github.com/excalidraw/excalidraw
Excalidraw 문서: https://docs.excalidraw.com/docs  
Janus: https://janus.conf.meetecho.com/

## 명령어
```bash
# 패키지 설치
yarn

# 개발모드 실행
yarn start

# 빌드
yarn build

# 실행
npx http-server ./excalidraw-app/build -a localhost -p 5001 -o
```

## 폴더 구조 및 파일 설명

```
.codesandbox
   |-- Dockerfile
   |-- tasks.json
.dockerignore
.editorconfig
.env.development: 개발 환경 환경변수
.env.production: 프로덕션 환경 환경변수
.github: excalidraw의 파생 무시
.gitignore
.husky: excalidraw의 파생 무시(빌드시 호출하긴합니다만 무시)
   |-- pre-commit
Dockerfile: 임시로 docker 서버로 돌릴때 도커컴포즈
LICENSE
README.md
crowdin.yml
dev-docs: excalidraw의 문서(무시)
docker-compose.yml: 임시로 docker 서버로 돌릴때 도커컴포즈
examples: excalidraw의 예제(무시)
excalidraw-app: 화이트보드 어플리케이션
   |-- App.scss
   |-- App.tsx
   |-- CustomStats.tsx
   |-- app-jotai.ts
   |-- app_constants.ts
   |-- bug-issue-template.js
   |-- collab: 협업을 위한 코드 
   |   |-- Collab.tsx: 협업 관련 코드
   |   |-- Portal.tsx: 소켓 통신 관련
   |   |-- RoomDialog.tsx: 협업 링크 모달
   |   |-- reconciliation.ts: 협업 관련 소켓 통신시 엘레멘탈 처리 관련
   |-- components: excalidraw 컴포넌트
   |-- data
   |   |-- FileManager.ts: 파일 관련 처리
   |   |-- LoaderSingleton.ts: 현재 로드 및 커넥션 연결 관련 상태 확인
   |   |-- LocalData.ts: 로컬에 파일 데이터 등을 저장
   |   |-- Locker.ts: 잠금 처리
   |   |-- atoms.ts: jatai atom 모음
   |   |-- firebase.ts: firebase 관련 처리
   |   |-- index.ts: 소켓통신 데이터 규격 등.. 이것저것
   |   |-- localStorage.ts: 로컬스토리지 관련 함수
   |   |-- pdf.ts: pdf 처리 관련 함수
   |   |-- player.ts: 녹화된 데이터 재생 관련
   |   |-- recorder.ts: 녹화 관련
   |   |-- recorderServer.ts: 녹화 관련(서버 녹화)
   |   |-- slide.ts: 슬라이드 제어
   |   |-- tabSync.ts
   |   |-- types.ts: 타입 모음
   |   |-- user.ts: 유저 관련
   |   |-- userRole.ts: 과거에 url 기반으로 썼지만 user.ts로 역할 넘김(안씀)
   |-- debug.ts
   |-- global.d.ts: Window 관런 처리
   |-- index.html: 베이스 html
   |-- index.scss: 베이스 스타일
   |-- index.tsx: 베이스
   |-- loading: 로딩 컴포넌트
   |   |-- Loading.scss
   |   |-- Loading.tsx
   |   |-- atom.tsx
   |   |-- types.ts
   |-- package.json: 패키지 정보
   |-- recorder: 녹화 컴포넌트
   |   |-- Recorder.module.scss
   |   |-- Recorder.tsx
   |-- sentry.ts
   |-- share: 공유 다이얼로그 컴포넌트
   |   |-- ShareDialog.scss
   |   |-- ShareDialog.tsx
   |-- slide: 슬라이드 컴포넌트
   |   |-- Scene.module.scss
   |   |-- Scene.tsx
   |   |-- SlideList.module.scss
   |   |-- SlideList.tsx
   |-- tests: 테스트
   |   |-- LanguageList.test.tsx
   |   |-- MobileMenu.test.tsx
   |   |-- __snapshots__
   |   |   |-- MobileMenu.test.tsx.snap
   |   |-- collab.test.tsx
   |   |-- reconciliation.test.ts
   |-- vite-env.d.ts: 환경변수 타입
   |-- vite.config.mts: vite 설정
   |-- webrtc: WebRTC 컴포넌트
   |   |-- Video.module.scss
   |   |-- Video.tsx: WebRTC 비디오 컴포넌트
   |   |-- WebRTC.module.scss
   |   |-- WebRTC.tsx: WebRTC
   |   |-- WebRTCJanus.tsx: Janus
   |   |-- types.ts
firebase-project: 안씀 무시
package.json: 패키지 정보
packages
   |-- excalidraw: excalidraw core(core 일부 수정됨)
public: asset(excalidraw에 있는 것으로 무시)
   |-- Assistant-Regular.woff2
   |-- Cascadia.woff2
   |-- Virgil.woff2
   |-- _headers
   |-- android-chrome-192x192.png
   |-- android-chrome-512x512.png
   |-- apple-touch-icon.png
   |-- favicon-16x16.png
   |-- favicon-32x32.png
   |-- favicon.ico
   |-- favicon.svg
   |-- fonts
   |   |-- Assistant-Bold.woff2
   |   |-- Assistant-Medium.woff2
   |   |-- Assistant-Regular.woff2
   |   |-- Assistant-SemiBold.woff2
   |   |-- Cascadia.ttf
   |   |-- Cascadia.woff2
   |   |-- FG_Virgil.ttf
   |   |-- FG_Virgil.woff2
   |   |-- Virgil.woff2
   |   |-- fonts.css
   |-- manifest.json
   |-- maskable_icon_x192.png
   |-- maskable_icon_x512.png
   |-- og-image-2.png
   |-- robots.txt
   |-- screenshots
   |   |-- collaboration.png
   |   |-- export.png
   |   |-- illustration.png
   |   |-- shapes.png
   |   |-- virtual-whiteboard.png
   |   |-- wireframe.png
   |-- service-worker.js
scripts: 빌드 관련 스크립트(excalidraw에 있는 것으로 무시)
   |-- autorelease.js
   |-- build-locales-coverage.js
   |-- build-node.js
   |-- build-version.js
   |-- buildDocs.js
   |-- buildExample.mjs
   |-- buildPackage.js
   |-- locales-coverage-description.js
   |-- prerelease.js
   |-- release.js
   |-- updateChangelog.js
setupTests.ts
tsconfig.json
vercel.json
vitest.config.mts
yarn.lock
```
# whiteboard
# whiteboard
