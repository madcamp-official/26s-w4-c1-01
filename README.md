# 🧚 방꾸요정 — 원룸 실치수 가구배치

원룸 자취방에 **실제 파는 가구를 실치수로** 놓아 보고 그대로 사는 앱.
빈 방 사진과 방 크기만 넣으면, 가구를 실치수 스케일로 2D 배치하고, 그 가구가 놓인 방 이미지를 합성해 보여준 뒤 구매 링크로 잇는다.

> 기획서: [docs/방꾸요정-기획서.md](docs/방꾸요정-기획서.md) · 기능 명세서: [docs/방꾸요정-기능명세서.md](docs/방꾸요정-기능명세서.md)

## 구조

```
web/     React + Vite + react-konva (2D 축척 플래너 + 합성 접합). Android WebView로 감쌀 예정
server/  FastAPI — 네이버쇼핑 grounding · (3090) 합성 프록시. 키 없으면 폴백
docs/    기획서 · 기능 명세서
```

## 실행

```bash
# 프런트
cd web && npm install && npm run dev     # http://localhost:5173
npm test                                 # 기하·방크기·homography 순수함수 단위 테스트

# 백엔드(선택 — 없어도 프런트는 로컬 시드로 동작)
cd server && python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                      # 네이버 키 등 채우기
uvicorn app.main:app --reload             # http://localhost:8000
```

## 현재 구현 상태 (MVP 코어)

- ✅ 방 크기 입력: 예측(평수→공용면적 차감→종횡비) / 한변 실측 보정 / 완전 실측
- ✅ 축척 2D 플래너: 실치수 드래그 배치, 90° 스냅 회전, **겹침·방밖 실시간 하이라이트**(AABB)
- ✅ 시드 카탈로그(IKEA 정형치수) + 자연어 검색(백엔드 grounding, 없으면 로컬 폴백)
- ✅ 합성 접합: 바닥 homography로 배치 좌표 → 사진 투영 + 접지 그림자 자작 + 빌보드
- ⏳ 미연동(키·서버 필요): 네이버쇼핑 실검색, 3090 저denoise 리라이팅, 제품 누끼, 실구매 딥링크

**정직 원칙**: 배치·치수는 기하가 결정(디퓨전 아님) · 합성은 목업이지 포토리얼 아님 · 치수 보장은 정형 소스(IKEA)만.
