package com.flit.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.text.TextUtils;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class FlitNativeBridgeInterface {
    private static final String PREFS_NAME = "flit_native_bridge";
    private static final String PREF_LAST_URL_PREFIX = "last_url_";

    private final Activity activity;

    public FlitNativeBridgeInterface(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String openPlatformLogin(final String platformId, final String loginUrl) {
        if (TextUtils.isEmpty(loginUrl)) {
            return errorPayload("missing_login_url");
        }

        try {
            activity.runOnUiThread(() -> {
                Intent intent = new Intent(activity, PlatformLoginActivity.class);
                intent.putExtra(PlatformLoginActivity.EXTRA_PLATFORM_ID, safePlatformId(platformId));
                intent.putExtra(PlatformLoginActivity.EXTRA_LOGIN_URL, loginUrl);
                activity.startActivity(intent);
            });

            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("mode", "native");
            return payload.toString();
        } catch (JSONException ignored) {
            return "{\"ok\":true,\"mode\":\"native\"}";
        } catch (Exception ex) {
            return errorPayload(ex.getMessage());
        }
    }

    @JavascriptInterface
    public String exportPlatformSession(String platformId) {
        try {
            String cookieHeader = findCookieHeaderForPlatform(safePlatformId(platformId));
            if (TextUtils.isEmpty(cookieHeader)) {
                return errorPayload("no_session_cookie");
            }

            JSONObject payload = new JSONObject();
            payload.put("cookieHeader", cookieHeader);
            payload.put("expiresAt", JSONObject.NULL);
            return payload.toString();
        } catch (Exception ex) {
            return errorPayload(ex.getMessage());
        }
    }

    private String findCookieHeaderForPlatform(String platformId) {
        CookieManager cookieManager = CookieManager.getInstance();
        Map<String, String> mergedCookies = new LinkedHashMap<>();

        for (String candidateUrl : candidateUrlsForPlatform(platformId)) {
            String cookies = cookieManager.getCookie(candidateUrl);
            if (TextUtils.isEmpty(cookies) || !cookies.contains("=")) {
                continue;
            }

            String[] pairs = cookies.split(";");
            for (String pair : pairs) {
                String trimmed = pair.trim();
                if (TextUtils.isEmpty(trimmed)) {
                    continue;
                }

                int separator = trimmed.indexOf('=');
                if (separator <= 0) {
                    continue;
                }

                String key = trimmed.substring(0, separator).trim();
                String value = trimmed.substring(separator + 1).trim();
                if (!TextUtils.isEmpty(key) && value != null) {
                    mergedCookies.put(key, value);
                }
            }
        }

        if (mergedCookies.isEmpty()) {
            return null;
        }

        StringBuilder builder = new StringBuilder();
        for (Map.Entry<String, String> entry : mergedCookies.entrySet()) {
            if (builder.length() > 0) {
                builder.append("; ");
            }
            builder.append(entry.getKey()).append("=").append(entry.getValue());
        }

        return builder.toString();
    }

    private List<String> candidateUrlsForPlatform(String platformId) {
        List<String> urls = new ArrayList<>();
        Set<String> deduped = new LinkedHashSet<>();

        String lastVisitedUrl = getLastVisitedUrl(platformId);
        if (!TextUtils.isEmpty(lastVisitedUrl)) {
            deduped.add(lastVisitedUrl);
        }

        switch (platformId) {
            case "blinkit":
                deduped.add("https://blinkit.com");
                deduped.add("https://www.blinkit.com");
                deduped.add("https://blinkit.com/account");
                deduped.add("https://blinkit.com/login");
                break;
            case "zepto":
                deduped.add("https://www.zeptonow.com");
                deduped.add("https://zeptonow.com");
                deduped.add("https://api.zeptonow.com");
                deduped.add("https://www.zepto.com");
                break;
            case "instamart":
                deduped.add("https://www.swiggy.com");
                deduped.add("https://instamart.swiggy.com");
                deduped.add("https://api.swiggy.com");
                break;
            case "bigbasket":
                deduped.add("https://www.bigbasket.com");
                break;
            case "jiomart":
                deduped.add("https://www.jiomart.com");
                break;
            default:
                deduped.add("https://www.swiggy.com");
                deduped.add("https://www.zeptonow.com");
                deduped.add("https://blinkit.com");
                break;
        }

        urls.addAll(deduped);

        return urls;
    }

    private String getLastVisitedUrl(String platformId) {
        if (TextUtils.isEmpty(platformId)) {
            return null;
        }

        SharedPreferences prefs = activity.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE);
        String value = prefs.getString(PREF_LAST_URL_PREFIX + platformId, null);

        if (TextUtils.isEmpty(value)) {
            return null;
        }

        return value;
    }

    private String safePlatformId(String raw) {
        return raw == null ? "" : raw.trim().toLowerCase();
    }

    private String errorPayload(String message) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("error", message == null ? "native_error" : message);
            return payload.toString();
        } catch (JSONException ignored) {
            return "{\"error\":\"native_error\"}";
        }
    }
}
