# 🧚 방꾸요정 — 원룸 실치수 가구배치

원룸 자취방에 **실제 파는 가구를 실치수로** 놓아 보고 그대로 사는 앱.
방 크기만 넣으면 가구를 2D로 배치하고, **진짜 3D(아키스케치식)** 로 방 안에 실측 가구를 놓아 돌려보며 확인한 뒤 구매 링크로 잇는다.

> 기획서: [docs/방꾸요정-기획서.md](docs/방꾸요정-기획서.md) · 기능 명세서: [docs/방꾸요정-기능명세서.md](docs/방꾸요정-기능명세서.md)

## 구조

```
web/     React + Vite. 2D 축척 플래너(react-konva) + 3D 미리보기(react-three-fiber).
         3D 가구는 ABO 실측 GLB(브라우저 WebGL, GPU 서버 불필요). Android WebView로 감쌀 예정
server/  FastAPI — 네이버쇼핑 grounding. 키 없으면 폴백
docs/    기획서 · 기능 명세서
```

## 3D 미리보기 (아키스케치식)

- **뷰어**: react-three-fiber(three.js) — 전부 브라우저 WebGL, GPU 서버 불필요. orbit 카메라 + 바닥 드래그 이동 + `R`키 90° 회전.
- **가구**: [Amazon Berkeley Objects](https://amazon-berkeley-objects.s3.amazonaws.com/) 실측 GLB 20종(치수가 모델에 내장, 실척 배치). 원본 4K 텍스처를 1024+webp로 압축해 개당 ~0.3MB. 라이선스 CC BY-NC(비상업) — [web/public/glb/SOURCE.txt](web/public/glb/SOURCE.txt).
- **판정**: 겹침/방밖은 실치수 발자국으로 계산해 3D에서 빨간 하이라이트.
- **임의 제품(2단계)**: 네이버/중고 사진 → camp-3 3090에서 image-to-3D(SF3D/Hunyuan3D) 오프라인 생성 후 실치수 후보정 예정.

## 실행

### 빠른 실행 (권장) — 원클릭

```bash
./run.sh            # 빌드 + 백엔드(8000) + 프런트(5173) + GPU 터널(8600) 전부 시작
# → VS Code PORTS 탭에서 5173 열기
./run.sh stop       # 전부 중지
```

코드를 고쳤으면: `./run.sh` 다시(리빌드) → 브라우저 하드 새로고침(Ctrl+Shift+R).
`run.sh`는 멱등이라 이미 떠 있는 건 재시작하지 않아(VS Code 포워딩이 안 끊김). 프런트는 빌드본을 서빙(`serve_build.py`)해 포워딩 터널에서도 안정적이다.

### 개별 실행 (개발용)

```bash
# 프런트
cd web && npm install && npm run dev     # http://localhost:5173
npm test                                 # 기하·방크기·homography 순수함수 단위 테스트

# 백엔드 — 설치 없이(권장, venv/pip 불필요): 네이버 실검색까지 바로
cp server/.env.example server/.env        # 네이버 키 채우기
python3 server/devserver.py               # http://localhost:8000  (stdlib only)

# 백엔드 — 실 배포용 FastAPI (pip 필요; venv 안 되면 python3-venv 설치 or 위 devserver 사용)
cd server && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload             # http://localhost:8000
```

> 백엔드는 선택 — 없어도 프런트는 로컬 시드 카탈로그로 동작한다. 네이버 실검색을 원하면 위 둘 중 하나를 켠다.
> `venv`가 안 되면(`ensurepip`/`python3-venv` 미설치, 몰입 VM에서 흔함) **설치 없이 devserver**를 쓰면 된다.

### GPU 리라이팅 연동 (선택 — camp-3 3090)

합성 목업을 SD img2img로 하모나이즈하려면 camp-3의 리라이팅 서버(`:8600`, `/relight`)에 연결한다.
camp 내부망은 VM 간 22번만 열려 있으므로 **camp-15에서 camp-3로 SSH 터널**을 문다.

```bash
# camp-15에서 (백그라운드 터널)
ssh -i camp3.pem -L 8600:127.0.0.1:8600 -N root@172.10.5.71 &

# server/.env 에 추가:
#   SD_SERVER_URL=http://127.0.0.1:8600
# 백엔드 재시작 → curl localhost:8000/health 에서 "sd_server": true 확인
```

연결되면 앱 **미리보기 탭 → "✨ GPU 리라이팅 적용"** 버튼으로 하모나이즈된 결과를 본다.
서버가 없으면 `/api/relight`는 `status: CLIENT`를 반환하고 프런트는 목업을 그대로 유지한다(폴백).
camp-3 서버 기동: `python3 relight_server.py`(SD 1.5 img2img, strength 0.3 저-denoise 밴드).

## 현재 구현 상태 (MVP 코어)

- ✅ 방 크기 입력: 예측(평수→공용면적 차감→종횡비) / 한변 실측 보정 / 완전 실측
- ✅ 축척 2D 플래너: 실치수 드래그 배치, 90° 스냅 회전, **겹침·방밖 실시간 하이라이트**(AABB)
- ✅ **3D 미리보기**: ABO 실측 GLB를 방 안에 실치수 배치, orbit·바닥 드래그·R키 회전, 겹침/방밖 하이라이트
- ✅ 실측 GLB 카탈로그 20종(ABO) + 자연어 검색(백엔드 grounding, 없으면 로컬 폴백)
- ⏳ 미연동(키·서버 필요): 네이버쇼핑 실검색, 임의 제품 image-to-3D 생성, 실구매 딥링크

**정직 원칙**: 배치·치수는 기하가 결정(디퓨전 아님) · 3D 가구는 실측 GLB(실척 보장) · 치수 보장은 정형 소스(ABO/IKEA)만.

> 2.5D 빌보드 합성(구 `Composite.jsx`·`homography.js`)은 3D 피벗으로 대체됨 — 품질 상한이 낮아 미리보기에서 제외.
