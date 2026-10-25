# 📱 프롬프터 (클라우드 버전)

태블릿 = **프롬프터 화면**, 폰 = **리모콘**.
인터넷 서버(Render)에 올려두면 **노트북도, 같은 와이파이도 필요 없습니다.** LTE끼리도 연결됩니다.

## 이전 버전과 달라진 점

| | 이전 (노트북 버전) | 지금 (클라우드 버전) |
|---|---|---|
| 서버 | 노트북에서 START_Windows 실행 | Render 서버가 대신 함 |
| 연결 조건 | 모든 기기 같은 와이파이 | 인터넷만 되면 됨 |
| 들어가는 법 | 매번 QR 찍기 | 홈 화면 아이콘 누르기 |
| 다른 사람 | — | **방 코드**가 다르면 내 대본을 못 봄 |
| 끊겼을 때 | 재연결은 되지만 서버가 대본을 잊을 수 있음 | 태블릿이 대본을 기억했다가 다시 올려줌, 읽던 위치 유지 |
| 연결 확인 | — | 리모콘에 "프롬프터 화면 연결됨" 표시 |

## 배포하기 (처음 1번만, 약 15분)

### 1. GitHub에 올리기 (코딩 없이 웹에서)
1. github.com 가입 → 오른쪽 위 **＋ → New repository**
2. 이름 `prompter`, **Public** 선택, **Create repository**
3. 다음 화면에서 **uploading an existing file** 클릭
4. 이 압축을 푼 폴더 **안의 내용물 전부**(server.js, package.json, package-lock.json, render.yaml, public 폴더 등)를 끌어다 놓기
   - `node_modules` 폴더가 있다면 올리지 마세요.
   - 폴더째 끌어다 놓아야 `public/` 구조가 유지됩니다.
5. 아래 **Commit changes** 클릭

### 2. Render에 연결하기
1. render.com → **Sign in with GitHub** (가입 겸 로그인)
2. **＋ New → Blueprint** → 방금 만든 `prompter` 저장소 선택 → **Apply**
   - Blueprint가 안 보이면: **＋ New → Web Service** → 저장소 선택 →
     Build Command `npm install`, Start Command `node server.js`, Instance Type **Free**
3. 2~3분 기다리면 `https://prompter-xxxx.onrender.com` 주소가 생깁니다.
4. 주소 뒤에 `/version` 을 붙여 열었을 때 `2026-10-26-cloud-rooms` 가 나오면 성공.

### 3. 기기 설정 (처음 1번만)
1. 태블릿 크롬에서 받은 주소 열기 → **새로 만들기**로 방 코드 생성 → **이 방 쓰기**
2. 태블릿: **프롬프터 화면 · 이 기기에서 열기** → 크롬 메뉴(⋮) → **홈 화면에 추가**
3. 폰: 같은 주소에서 **같은 방 코드** 입력 → **리모콘 · 이 기기에서 열기** → **홈 화면에 추가**
   (또는 태블릿 시작 페이지의 리모콘 QR을 폰으로 찍기)

## 발표 당일
1. 발표 **5분 전** 폰·태블릿 홈 화면 아이콘 열기
   - 무료 서버가 자고 있으면 깨는 데 최대 1분 ("서버 깨우는 중…" 표시)
2. 리모콘 위쪽 **초록 점 + "프롬프터 화면 연결됨"** 확인
3. 노트북은 PPT만 F5

## 알아둘 점
- **무료 서버는 15분간 아무 연결이 없으면 잠듭니다.** 두 기기를 켜 둔 동안은 20초마다 신호를 보내므로 잠들지 않습니다.
- 서버가 잠들었다 깨면 서버 쪽 대본은 지워지지만, 태블릿이 기억하던 대본을 자동으로 다시 올립니다.
- 방 코드를 아는 사람은 같은 방에 들어올 수 있으니 남이 못 맞힐 코드를 쓰세요.
- 절대 잠들지 않게 하려면 Render 유료 인스턴스(월 $7~)로 바꾸면 됩니다.

## 구조
- `server.js` — 페이지 제공 + 방별 WebSocket 중계(대본·상태 저장, 접속 기기 수 알림, 연결 유지 신호)
- `public/common.js` — 방 코드 확인, 끊겨도 계속 다시 붙는 연결
- `public/display.html` — 프롬프터 화면
- `public/remote.html` — 리모콘
- `public/index.html` — 시작 페이지(방 코드 + QR + 사용법)
- `render.yaml` — Render 자동 설정

## 내 컴퓨터에서 실행 (선택)
Node.js가 있으면 `npm install` 후 `npm start` → `http://localhost:4173`
