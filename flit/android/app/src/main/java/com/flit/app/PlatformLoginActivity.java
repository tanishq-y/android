package com.flit.app;

import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;
import java.util.Map;

public class PlatformLoginActivity extends AppCompatActivity {
    public static final String EXTRA_PLATFORM_ID = "platformId";
    public static final String EXTRA_LOGIN_URL = "loginUrl";
    private static final String PREFS_NAME = "flit_native_bridge";
    private static final String PREF_LAST_URL_PREFIX = "last_url_";
    private static final String PREF_CAPTURED_HEADERS_PREFIX = "captured_headers_";

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

        clearCapturedHeaders();

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

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request != null) {
                    captureRequestHeaders(request.getUrl(), request.getRequestHeaders());
                }

                return super.shouldInterceptRequest(view, request);
            }
        });
        view.setWebChromeClient(new WebChromeClient());
    }

    private void captureRequestHeaders(Uri requestUri, Map<String, String> requestHeaders) {
        if (TextUtils.isEmpty(platformId) || requestUri == null || requestHeaders == null || requestHeaders.isEmpty()) {
            return;
        }

        if (!isRelevantHost(requestUri)) {
            return;
        }

        JSONObject captured = readCapturedHeaders();
        boolean changed = false;

        for (Map.Entry<String, String> entry : requestHeaders.entrySet()) {
            String name = normaliseHeaderName(entry.getKey());
            if (!shouldCaptureHeader(name)) {
                continue;
            }

            String value = String.valueOf(entry.getValue() == null ? "" : entry.getValue()).trim();
            if (TextUtils.isEmpty(value)) {
                continue;
            }

            String current = captured.optString(name, "");
            if (!value.equals(current)) {
                try {
                    captured.put(name, value);
                    changed = true;
                } catch (JSONException ignored) {
                    // Ignore malformed header capture payload writes.
                }
            }
        }

        if (changed) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString(PREF_CAPTURED_HEADERS_PREFIX + platformId, captured.toString())
                .apply();
        }
    }

    private JSONObject readCapturedHeaders() {
        String raw = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString(PREF_CAPTURED_HEADERS_PREFIX + platformId, "{}");

        try {
            return new JSONObject(raw);
        } catch (JSONException ignored) {
            return new JSONObject();
        }
    }

    private void clearCapturedHeaders() {
        if (TextUtils.isEmpty(platformId)) {
            return;
        }

        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .remove(PREF_CAPTURED_HEADERS_PREFIX + platformId)
            .apply();
    }

    private boolean shouldCaptureHeader(String headerName) {
        if (TextUtils.isEmpty(headerName)) {
            return false;
        }

        if (
            headerName.startsWith("x-")
                || headerName.startsWith("sec-ch-")
                || headerName.startsWith("sec-fetch-")
        ) {
            return true;
        }

        switch (headerName) {
            case "authorization":
            case "x-device-id":
            case "x-session-id":
            case "x-unique-browser-id":
            case "x-xsrf-token":
            case "x-csrf-token":
            case "x-without-bearer":
            case "platform":
            case "app-version":
            case "cookie":
            case "user-agent":
            case "accept":
            case "accept-language":
            case "origin":
            case "referer":
            case "priority":
            case "dnt":
            case "cache-control":
            case "pragma":
            case "app_client":
            case "web_app_version":
            case "lat":
            case "lon":
                return true;
            default:
                return false;
        }
    }

    private String normaliseHeaderName(String rawName) {
        if (rawName == null) {
            return "";
        }

        return rawName.trim().toLowerCase(Locale.US);
    }

    private boolean isRelevantHost(Uri uri) {
        String host = uri.getHost();
        if (TextUtils.isEmpty(host)) {
            return false;
        }

        String normalizedHost = host.toLowerCase(Locale.US);
        switch (platformId) {
            case "blinkit":
                return normalizedHost.contains("blinkit");
            case "zepto":
                return normalizedHost.contains("zepto");
            case "instamart":
                return normalizedHost.contains("swiggy");
            case "bigbasket":
                return normalizedHost.contains("bigbasket");
            case "jiomart":
                return normalizedHost.contains("jiomart");
            default:
                return false;
        }
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
