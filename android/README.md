# 방꾸요정 안드로이드 앱 (WebView 셸)

배포된 웹앱(`https://bangkku.madcamp-kaist.org`)을 감싸는 네이티브 안드로이드 앱.
1주차에 쓰던 **Android Studio 그대로** 열어서 빌드하면 APK가 나온다.

## 빌드 순서 (팀원 노트북에서)
1. 레포 클론/pull 후 Android Studio에서 **`android/` 폴더를 Open** (루트 말고 android!)
2. Gradle sync 자동 진행 (SDK 34 없으면 자동 설치 프롬프트 → 수락)
3. 실기기 연결(USB 디버깅) 또는 에뮬레이터 → **Run ▶**
4. 배포용 APK: **Build > Build App Bundle(s)/APK(s) > Build APK(s)**
   → `android/app/build/outputs/apk/debug/app-debug.apk`

## 구조
- `app/src/main/java/.../MainActivity.kt` — WebView 셸 전부(단일 파일)
  - OAuth(카카오/네이버/구글)는 WebView 안에서 진행 → 콜백이 앱으로 복귀
  - 구글의 WebView 차단(disallowed_useragent)은 UA 정규화로 회피
  - 쇼핑 링크(닮은 상품)는 시스템 브라우저로
  - 파일 업로드(도면/방 사진), 뒤로가기=웹 히스토리, 상태 복원 지원
- 로드 URL 변경: `app/build.gradle`의 `APP_URL` 한 줄

## 주의
- **웹이 먼저 배포돼 있어야** 폰에서 동작한다(localhost 불가).
- HTTPS 전용(`usesCleartextTraffic=false`) — 터널 도메인은 자동 https.
- 앱 안 로그인은 카카오/네이버 권장. 구글은 UA 회피로 대부분 동작하나
  구글 정책상 막히면 브라우저(PWA)에서 로그인 후 사용.
