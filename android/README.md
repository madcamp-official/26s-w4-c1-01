# 방꾸요정 안드로이드 앱 (WebView 셸)

배포된 웹앱(`https://bangkku-fairy.madcamp-kaist.org`)을 감싸는 네이티브 안드로이드 앱.
1주차에 쓰던 **Android Studio 그대로** 열어서 빌드하면 APK가 나온다.

## 폰에 바로 설치 (빌드 없이)
폰 브라우저에서 **https://bangkku-fairy.madcamp-kaist.org/bangkku.apk** 를 열면 APK가 내려온다.
> 새로 빌드했는데 예전 게 받아지면 클라우드플레어 캐시다 — 날짜를 붙인 사본(`/bangkku-0730b.apk`)이나 `?v=아무값`을 붙이면 확실히 최신을 받는다.
`설정 > 보안 > 출처를 알 수 없는 앱`(안드로이드 8 기준)에서 브라우저에 설치 권한을 주면 끝.
디버그 서명본이라 "안전하지 않은 앱" 경고가 뜨는 건 정상. minSdk 26 · dex 038이라 갤럭시 S7(8.0)에서도 설치된다.
> 크롬의 "홈 화면에 추가"(PWA)는 구형 기기에서 쓰지 말 것 — 구글이 찍어주는 WebAPK의 dex가 039라
> 안드로이드 8.0이 못 읽고 실행 즉시 죽는다(우리 앱 문제가 아님).

## 빌드 순서 (팀원 노트북에서)
1. 레포 클론/pull 후 Android Studio에서 **`android/` 폴더를 Open** (루트 말고 android!)
2. Gradle sync 자동 진행 (SDK 34 없으면 자동 설치 프롬프트 → 수락)
3. 실기기 연결(USB 디버깅) 또는 에뮬레이터 → **Run ▶**
4. 배포용 APK: **Build > Build App Bundle(s)/APK(s) > Build APK(s)**
   → `android/app/build/outputs/apk/debug/app-debug.apk`

CLI로도 된다(스튜디오 없이, gradle wrapper 포함):
```
cd android && echo "sdk.dir=<안드로이드 SDK 경로>" > local.properties
./gradlew assembleDebug          # 윈도우: gradlew.bat assembleDebug
```
메모리가 적은 서버라면 `./gradlew --no-daemon -Dorg.gradle.jvmargs=-Xmx820m assembleDebug`.

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
