package org.madcamp.bangkku

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * 방꾸요정 WebView 셸 — 배포된 웹앱(BuildConfig.APP_URL)을 앱으로 감싼다.
 * - OAuth(카카오/네이버/구글) 페이지는 WebView 안에서 진행(콜백이 앱 도메인으로 복귀).
 * - 그 외 외부 링크(네이버쇼핑 '닮은 상품' 등)는 시스템 브라우저로.
 * - 파일 선택(도면/방 사진 업로드) 지원, 뒤로가기는 웹 히스토리 우선.
 * - 시작 크래시는 죽는 대신 스택트레이스를 화면에 표시(USB/Logcat 없이 진단).
 */
class MainActivity : AppCompatActivity() {
    private var web: WebView? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooser =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = filePathCallback ?: return@registerForActivityResult
            filePathCallback = null
            val uri = result.data?.data
            cb.onReceiveValue(if (result.resultCode == RESULT_OK && uri != null) arrayOf(uri) else arrayOf())
        }

    // WebView 안에서 유지할 호스트 — 앱 도메인 + OAuth 로그인 페이지들
    private val inAppHosts = listOf(
        "madcamp-kaist.org",
        "kauth.kakao.com", "accounts.kakao.com", "kapi.kakao.com",
        "nid.naver.com",
        "accounts.google.com", "accounts.youtube.com", "google.com/accounts",
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 비동기 크래시도 다음 실행 때 화면에 보이도록 기록
        val prefs = getSharedPreferences("crash", MODE_PRIVATE)
        Thread.setDefaultUncaughtExceptionHandler { _, e ->
            prefs.edit().putString("last", Log.getStackTraceString(e)).commit()
            android.os.Process.killProcess(android.os.Process.myPid())
        }
        val prev = prefs.getString("last", null)
        if (prev != null) {
            prefs.edit().remove("last").commit()
            showError("이전 실행이 아래 오류로 종료됐어요", prev)
            return
        }
        try {
            initWebView(savedInstanceState)
        } catch (t: Throwable) {
            showError("앱 시작 오류", Log.getStackTraceString(t))
        }
    }

    /** 크래시 대신 스택트레이스를 화면에 표시 — 이 화면을 캡처해서 공유하면 원인 진단 가능. */
    private fun showError(title: String, trace: String) {
        val tv = TextView(this)
        tv.text = "🛠 $title\n(이 화면을 캡처해서 개발자에게 보내주세요)\n\n$trace"
        tv.setTextIsSelectable(true)
        tv.textSize = 12f
        tv.setPadding(40, 80, 40, 80)
        val sc = ScrollView(this)
        sc.addView(tv)
        setContentView(sc)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun initWebView(savedInstanceState: Bundle?) {
        val web = WebView(this)
        this.web = web
        setContentView(web)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage(세션/취향 저장)
            databaseEnabled = true
            allowFileAccess = false
            // 구글 OAuth가 WebView UA를 차단(disallowed_useragent)하는 것 회피 — 일반 모바일 크롬 UA로
            userAgentString = userAgentString
                .replace("; wv", "")
                .replace(Regex("Version/\\d+\\.\\d+ "), "")
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val host = (url.host ?: "") + url.path.orEmpty()
                val keepInApp = inAppHosts.any { host.contains(it) }
                return if (keepInApp) false else {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))   // 쇼핑 링크 등은 브라우저로
                    } catch (_: Exception) { /* 브라우저 없음 등 — 무시 */ }
                    true
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                filePathCallback?.onReceiveValue(arrayOf())
                filePathCallback = callback
                try {
                    fileChooser.launch(params.createIntent())
                } catch (_: Exception) {
                    filePathCallback = null
                    callback.onReceiveValue(arrayOf())
                }
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val w = this@MainActivity.web
                if (w != null && w.canGoBack()) w.goBack() else finish()
            }
        })

        if (savedInstanceState == null) web.loadUrl(BuildConfig.APP_URL)
        else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web?.saveState(outState)
    }
}
