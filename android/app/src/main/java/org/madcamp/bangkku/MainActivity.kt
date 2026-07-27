package org.madcamp.bangkku

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * 방꾸요정 WebView 셸 — 배포된 웹앱(BuildConfig.APP_URL)을 앱으로 감싼다.
 * - OAuth(카카오/네이버/구글) 페이지는 WebView 안에서 진행(콜백이 앱 도메인으로 복귀).
 * - 그 외 외부 링크(네이버쇼핑 '닮은 상품' 등)는 시스템 브라우저로.
 * - 파일 선택(도면/방 사진 업로드) 지원, 뒤로가기는 웹 히스토리 우선.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
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

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
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
                    startActivity(Intent(Intent.ACTION_VIEW, url))   // 쇼핑 링크 등은 브라우저로
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
                fileChooser.launch(params.createIntent())
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState == null) web.loadUrl(BuildConfig.APP_URL)
        else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }
}
