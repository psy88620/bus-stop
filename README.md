# 내 주변 버스

접속하면 내 위치 근처 버스정류장과 도착 예정을 보여 주고, 지도에 정류장을 표시합니다. 정류장을 누르면 그 정류장의 실시간 정보(도착 예정·버스 위치)로 갑니다.
전국 검색: **도시(필수) + 읍·면·리(선택) + 정류장 이름** (읍·면·리를 적으면 이름은 비워도 됩니다).
스쿨패스(`school_pass`)의 근처 버스 기능을 누구나 쓰도록 옮긴 것입니다. 출처: 국토교통부(공공데이터포털).

## 구조

| 위치 | 역할 |
|---|---|
| `index.html` `index.js` | 내 위치 → 근처 정류장 목록 + 지도, 전국 검색 |
| `stop.html` `stop.js` | 정류장 실시간 정보: 도착 예정, 노선을 누르면 버스 위치(목록+지도) |
| `lib.js` `style.css` `config.js` | 공용 코드, 모양, 설정(Worker 주소·카카오 키) |
| `data/` | 전국 정류장 22만 건을 도시별 파일로(`tools/build_stops.py`가 만듦). 페이지가 직접 읽어 근처·이름 검색 — 키 필요 없음 |
| `worker/` | Cloudflare Worker. **공공데이터 키를 숨기고** 도착 예정·버스 위치만 대신 받아 캐시(15초·10초) |

GitHub Pages는 정적 호스팅이라 비밀 키를 둘 수 없어서, 키가 필요한 일(도착·위치)만 Worker가 맡습니다.

## 배포 (처음 한 번)

1. **Worker**
   ```
   cd worker
   npm install
   npx wrangler login
   npx wrangler secret put DATA_GO_KR_KEY     # 공공데이터포털 인증키 붙여넣기
   npx wrangler deploy                        # 끝에 나오는 https://bus-stop-api.○○.workers.dev 주소를 복사
   ```
   `wrangler.toml`의 `ALLOWED_ORIGINS`에 있는 주소(기본 `https://psy88620.github.io`)에서 온 요청만 응답합니다. 계정을 바꾸면 거기를 고치세요.
2. **카카오 지도 키**: [카카오 개발자](https://developers.kakao.com) → 앱 → 플랫폼 키의 **JavaScript 키**, 사이트 도메인에 `https://psy88620.github.io` 등록(로컬 시험은 `http://localhost:8080`도).
3. `config.js`에 Worker 주소(`API_BASE`)와 JavaScript 키(`KAKAO_JS_KEY`)를 넣고 커밋. (둘 다 공개되어도 되는 값입니다.)
4. GitHub 저장소 Settings → Pages → Branch `main` / root.

## 로컬 시험

```
cd worker && echo DATA_GO_KR_KEY=키 > .dev.vars && npx wrangler dev --port 8787   # Worker
python -m http.server 8080                                                          # 다른 창에서 페이지
```
`config.js`의 `API_BASE`를 `http://127.0.0.1:8787`로 잠깐 바꾸고 http://localhost:8080 을 엽니다. Worker 단독 시험: `DATA_GO_KR_KEY=키 node worker/test.mjs`.

## 정류장 데이터 갱신

정류장 파일(공공데이터 15067528)이 바뀌면 `DATA_GO_KR_KEY=키 python tools/build_stops.py` (약 3분) 후 `data/`를 커밋.

## 알아 둘 점

- **직전 버스(추정)**: 정류장 상세 페이지의 노선마다 "직전 버스는 ○정류장 앞을 지나갔어요 · 약 N분 전(추정)"을 보여 줍니다. 버스 위치 정보에서 이미 이 정류장을 지나간 버스를 찾고, 정류장 한 곳에 약 1.3분으로 어림한 값이라 구간 길이·막힘에 따라 오차가 큽니다. 8정류장(약 10분) 넘게 앞선 버스는 표시하지 않습니다.
- 공공데이터 API는 **동시 접속 30개 한도**가 있어서, Worker는 노선 조회를 3개씩 나눠 하고 페이지는 정류장 도착 조회를 4개씩 보냅니다. 많은 사람이 동시에 쓰면 한도를 넘을 수 있어(그땐 "받지 못했습니다" 표시) 캐시가 이를 줄여 줍니다.
- 읍·면·리 검색은 행정구역 경계가 아니라 카카오가 알려 주는 중심 좌표 반경(읍·면 4km, 리·동 1.5km)이라, 큰 면의 끝자락은 빠질 수 있습니다.
- 도착 정보가 없는 지역·시간대가 있습니다(공공데이터가 제공하지 않는 지자체).
