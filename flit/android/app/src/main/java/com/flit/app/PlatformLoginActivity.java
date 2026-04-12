package com.flit.app;

import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

public class PlatformLoginActivity extends AppCompatActivity {
    public static final String EXTRA_PLATFORM_ID = "platformId";
    public static final String EXTRA_LOGIN_URL = "loginUrl";
    private static final String PREFS_NAME = "flit_native_bridge";
    private static final String PREF_LAST_URL_PREFIX = "last_url_";

    private WebView webView;
    private String platformId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        platformId = normalisePlatformId(getIntent().getStringExtra(EXTRA_PLATFORM_ID));
        String loginUrl = getIntent().getStringExtra(EXTRA_LOGIN_URL);
        if (TextUtils.isEmpty(loginUrl)) {
            finish();
            return;
        }

        webView = new WebView(this);
        configureWebView(webView);
        setContentView(webView);
        webView.loadUrl(loginUrl);
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(view, true);
        }

        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView webView, String url) {
                super.onPageFinished(webView, url);

                persistLastVisitedUrl(url);
                CookieManager.getInstance().flush();
            }
        });
        view.setWebChromeClient(new WebChromeClient());
    }

    private void persistLastVisitedUrl(String url) {
        if (TextUtils.isEmpty(platformId) || TextUtils.isEmpty(url)) {
            return;
        }

        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return;
        }

        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putString(PREF_LAST_URL_PREFIX + platformId, url)
            .apply();
    }

    private String normalisePlatformId(String raw) {
        return raw == null ? "" : raw.trim().toLowerCase();
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        CookieManager.getInstance().flush();

        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
