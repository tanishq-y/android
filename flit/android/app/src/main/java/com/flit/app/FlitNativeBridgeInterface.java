package com.flit.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.text.TextUtils;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class FlitNativeBridgeInterface {
    private static final String PREFS_NAME = "flit_native_bridge";
    private static final String PREF_LAST_URL_PREFIX = "last_url_";
    private static final String PREF_CAPTURED_HEADERS_PREFIX = "captured_headers_";
    private static final String DEVICE_SEARCH_MODE = "device_bridge_v1";
    private static final long SEARCH_JOB_RETENTION_MS = 10 * 60 * 1000L;
    private static final long PLATFORM_STEP_DELAY_MS = 120L;
    private static final int PLATFORM_TIMEOUT_MS = 12000;
    private static final String DEFAULT_USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
    private static final Pattern PRICE_PATTERN = Pattern.compile("(\\d+(?:\\.\\d+)?)");
    private static final Pattern UNIT_PATTERN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*(ml|l\\b|g\\b|kg|gm|litre|liter|ltr)", Pattern.CASE_INSENSITIVE);
    private static final Pattern JWT_LIKE_PATTERN = Pattern.compile("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$");
    private static final Pattern UUID_LIKE_PATTERN = Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$");
    private static final Pattern PLACEHOLDER_TOKEN_PATTERN = Pattern.compile("^(tok|sid|xsrf|dev|test|dummy|sample|token|session|auth)[_-].*", Pattern.CASE_INSENSITIVE);
    private static final String[] DEFAULT_SEARCH_PLATFORMS = new String[] {
        "blinkit",
        "zepto",
        "instamart"
    };

    private final Activity activity;
    private final ExecutorService searchExecutor;
    private final Map<String, DeviceSearchJob> searchJobs;

    public FlitNativeBridgeInterface(Activity activity) {
        this.activity = activity;
        this.searchExecutor = Executors.newSingleThreadExecutor();
        this.searchJobs = new ConcurrentHashMap<>();
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
            String normalizedPlatform = safePlatformId(platformId);
            String cookieHeader = findCookieHeaderForPlatform(normalizedPlatform);
            if (TextUtils.isEmpty(cookieHeader)) {
                return errorPayload("no_session_cookie");
            }

            Map<String, String> cookies = parseCookieHeader(cookieHeader);
            JSONObject headers = readCapturedHeadersForPlatform(normalizedPlatform);
            headers.put("Cookie", cookieHeader);
            hydrateHeadersFromCookies(normalizedPlatform, headers, cookies);

            JSONObject extra = new JSONObject();
            String storeId = cookies.get("store_id");
            if (!TextUtils.isEmpty(storeId)) {
                extra.put("store_id", storeId);
            }

            JSONObject session = new JSONObject();
            session.put("cookies", toJsonObject(cookies));
            session.put("headers", headers);
            session.put("extra", extra);

            JSONObject payload = new JSONObject();
            payload.put("cookieHeader", cookieHeader);
            payload.put("session", session);
            payload.put("expiresAt", JSONObject.NULL);
            return payload.toString();
        } catch (Exception ex) {
            return errorPayload(ex.getMessage());
        }
    }

    private void hydrateHeadersFromCookies(String platformId, JSONObject headers, Map<String, String> cookies) {
        if (headers == null || cookies == null || cookies.isEmpty()) {
            return;
        }

        String rawAccessToken = firstCookieValue(cookies,
            "accessToken",
            "gr_1_accessToken",
            "auth_token",
            "token"
        );
        String authorization = toBearerToken(rawAccessToken);

        putHeaderIfMissing(headers, "Authorization", authorization);
        putHeaderIfMissing(headers, "x-access-token", rawAccessToken);
        putHeaderIfMissing(headers, "x-device-id", firstCookieValue(cookies,
            "device_id",
            "gr_1_deviceId",
            "gr_1_device_id",
            "_device_id",
            "deviceId"
        ));
        putHeaderIfMissing(headers, "x-session-id", firstCookieValue(cookies,
            "session_id",
            "gr_1_session_id",
            "gr_1_sessionId",
            "_session_tid",
            "session_count"
        ));
        putHeaderIfMissing(headers, "x-unique-browser-id", firstCookieValue(cookies,
            "unique_browser_id",
            "gr_1_unique_browser_id",
            "gr_1_uniqueBrowserId",
            "_swuid"
        ));

        if ("zepto".equals(platformId)) {
            putHeaderIfMissing(headers, "platform", "WEB");
            putHeaderIfMissing(headers, "app-version", "1.0.0");
            putHeaderIfMissing(headers, "X-WITHOUT-BEARER", "true");
        }
    }

    private void putHeaderIfMissing(JSONObject headers, String headerName, String value) {
        if (headers == null || TextUtils.isEmpty(headerName) || TextUtils.isEmpty(value)) {
            return;
        }

        if (!TextUtils.isEmpty(getHeaderValueIgnoreCase(headers, headerName))) {
            return;
        }

        try {
            headers.put(headerName, value);
        } catch (JSONException ignored) {
            // Ignore malformed writes while hydrating derived headers.
        }
    }

    private String getHeaderValueIgnoreCase(JSONObject headers, String headerName) {
        if (headers == null || TextUtils.isEmpty(headerName)) {
            return "";
        }

        java.util.Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!headerName.equalsIgnoreCase(key)) {
                continue;
            }

            String value = String.valueOf(headers.opt(key)).trim();
            if (!TextUtils.isEmpty(value) && !"null".equalsIgnoreCase(value)) {
                return value;
            }
        }

        return "";
    }

    private String getFirstHeaderValueIgnoreCase(JSONObject headers, String... headerNames) {
        if (headerNames == null || headerNames.length == 0) {
            return "";
        }

        for (String name : headerNames) {
            String value = getHeaderValueIgnoreCase(headers, name);
            if (!TextUtils.isEmpty(value)) {
                return value;
            }
        }

        return "";
    }

    private void putMapHeaderIfMissing(Map<String, String> headers, String headerName, String value) {
        if (headers == null || TextUtils.isEmpty(headerName) || TextUtils.isEmpty(value)) {
            return;
        }

        String existing = String.valueOf(headers.get(headerName) == null ? "" : headers.get(headerName)).trim();
        if (!TextUtils.isEmpty(existing)) {
            return;
        }

        headers.put(headerName, value);
    }

    private void applyCapturedHeaderIfMissing(
        Map<String, String> headers,
        JSONObject capturedHeaders,
        String targetHeaderName,
        String... sourceHeaderNames
    ) {
        String value = getFirstHeaderValueIgnoreCase(capturedHeaders, sourceHeaderNames);
        putMapHeaderIfMissing(headers, targetHeaderName, value);
    }

    private void mergeBlinkitCapturedHeaders(Map<String, String> headers, JSONObject capturedHeaders) {
        if (headers == null || capturedHeaders == null) {
            return;
        }

        java.util.Iterator<String> keys = capturedHeaders.keys();
        while (keys.hasNext()) {
            String headerName = keys.next();
            if (!isBlinkitForwardableCapturedHeader(headerName)) {
                continue;
            }

            String value = String.valueOf(capturedHeaders.opt(headerName)).trim();
            if (TextUtils.isEmpty(value)) {
                continue;
            }

            putMapHeaderIfMissing(headers, headerName, value);
        }
    }

    private boolean isBlinkitForwardableCapturedHeader(String headerName) {
        String normalized = String.valueOf(headerName == null ? "" : headerName).trim().toLowerCase();
        if (TextUtils.isEmpty(normalized)) {
            return false;
        }

        if (
            "cookie".equals(normalized)
                || "host".equals(normalized)
                || "connection".equals(normalized)
                || "content-length".equals(normalized)
        ) {
            return false;
        }

        if (
            normalized.startsWith("x-")
                || normalized.startsWith("sec-ch-")
                || normalized.startsWith("sec-fetch-")
        ) {
            return true;
        }

        switch (normalized) {
            case "authorization":
            case "accept":
            case "accept-language":
            case "user-agent":
            case "origin":
            case "referer":
            case "dnt":
            case "priority":
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

    private String firstCookieValue(Map<String, String> cookies, String... candidateKeys) {
        if (cookies == null || cookies.isEmpty() || candidateKeys == null || candidateKeys.length == 0) {
            return "";
        }

        for (String candidate : candidateKeys) {
            if (TextUtils.isEmpty(candidate)) {
                continue;
            }

            for (Map.Entry<String, String> entry : cookies.entrySet()) {
                String key = String.valueOf(entry.getKey() == null ? "" : entry.getKey()).trim();
                if (!candidate.equalsIgnoreCase(key)) {
                    continue;
                }

                String value = String.valueOf(entry.getValue() == null ? "" : entry.getValue()).trim();
                if (!TextUtils.isEmpty(value)) {
                    return value;
                }
            }
        }

        return "";
    }

    private String toBearerToken(String token) {
        String value = String.valueOf(token == null ? "" : token).trim();
        if (TextUtils.isEmpty(value)) {
            return "";
        }

        if (value.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return value;
        }

        return "Bearer " + value;
    }

    @JavascriptInterface
    public String startDeviceSearch(String requestJson) {
        try {
            cleanupExpiredSearchJobs();

            JSONObject request = TextUtils.isEmpty(requestJson)
                ? new JSONObject()
                : new JSONObject(requestJson);

            String query = request.optString("query", "").trim();
            if (TextUtils.isEmpty(query)) {
                return searchErrorPayload("missing_query");
            }

            Double lat = readOptionalDouble(request, "lat");
            Double lon = readOptionalDouble(request, "lon");
            List<String> platforms = parseRequestedPlatforms(request);

            String jobId = UUID.randomUUID().toString();
            DeviceSearchJob job = new DeviceSearchJob(jobId, query, lat, lon, platforms);
            searchJobs.put(jobId, job);

            searchExecutor.execute(() -> runDeviceSearchJob(job));

            JSONObject payload = buildSearchJobPayload(job);
            payload.put("ok", true);
            payload.put("message", "device_search_started");
            return payload.toString();
        } catch (Exception ex) {
            return searchErrorPayload(ex.getMessage());
        }
    }

    @JavascriptInterface
    public String getDeviceSearchStatus(String jobId) {
        try {
            cleanupExpiredSearchJobs();

            String safeJobId = String.valueOf(jobId == null ? "" : jobId).trim();
            if (TextUtils.isEmpty(safeJobId)) {
                return searchErrorPayload("missing_job_id");
            }

            DeviceSearchJob job = searchJobs.get(safeJobId);
            if (job == null) {
                return searchErrorPayload("job_not_found");
            }

            JSONObject payload = buildSearchJobPayload(job);
            payload.put("ok", true);
            return payload.toString();
        } catch (Exception ex) {
            return searchErrorPayload(ex.getMessage());
        }
    }

    @JavascriptInterface
    public String cancelDeviceSearch(String jobId) {
        try {
            String safeJobId = String.valueOf(jobId == null ? "" : jobId).trim();
            if (TextUtils.isEmpty(safeJobId)) {
                return searchErrorPayload("missing_job_id");
            }

            DeviceSearchJob job = searchJobs.get(safeJobId);
            if (job == null) {
                return searchErrorPayload("job_not_found");
            }

            job.cancelled = true;
            job.status = "cancelled";

            JSONObject payload = buildSearchJobPayload(job);
            payload.put("ok", true);
            payload.put("message", "device_search_cancelled");
            return payload.toString();
        } catch (Exception ex) {
            return searchErrorPayload(ex.getMessage());
        }
    }

    private String findCookieHeaderForPlatform(String platformId) {
        CookieManager cookieManager = CookieManager.getInstance();
        Map<String, CookieCandidate> mergedCookies = new LinkedHashMap<>();

        for (String candidateUrl : candidateUrlsForPlatform(platformId)) {
            String cookies = cookieManager.getCookie(candidateUrl);
            if (TextUtils.isEmpty(cookies) || !cookies.contains("=")) {
                continue;
            }

            int sourcePriority = cookieSourcePriority(platformId, candidateUrl);

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
                    String normalizedKey = key.toLowerCase();
                    int qualityScore = scoreCookieValueQuality(key, value);
                    CookieCandidate candidate = new CookieCandidate(key, value, qualityScore, sourcePriority);
                    CookieCandidate existing = mergedCookies.get(normalizedKey);

                    if (shouldReplaceCookieCandidate(existing, candidate)) {
                        mergedCookies.put(normalizedKey, candidate);
                    }
                }
            }
        }

        if (mergedCookies.isEmpty()) {
            return null;
        }

        StringBuilder builder = new StringBuilder();
        for (CookieCandidate entry : mergedCookies.values()) {
            if (builder.length() > 0) {
                builder.append("; ");
            }
            builder.append(entry.key).append("=").append(entry.value);
        }

        return builder.toString();
    }

    private boolean shouldReplaceCookieCandidate(CookieCandidate existing, CookieCandidate candidate) {
        if (candidate == null) {
            return false;
        }

        if (existing == null) {
            return true;
        }

        if (candidate.qualityScore > existing.qualityScore) {
            return true;
        }

        if (candidate.qualityScore < existing.qualityScore) {
            return false;
        }

        if (candidate.sourcePriority > existing.sourcePriority) {
            return true;
        }

        if (candidate.sourcePriority < existing.sourcePriority) {
            return false;
        }

        return candidate.value.length() > existing.value.length();
    }

    private int cookieSourcePriority(String platformId, String candidateUrl) {
        String safePlatform = safePlatformId(platformId);
        String url = String.valueOf(candidateUrl == null ? "" : candidateUrl).toLowerCase();

        if (TextUtils.isEmpty(url)) {
            return 0;
        }

        switch (safePlatform) {
            case "zepto":
                if (url.contains("api.zeptonow.com")) return 60;
                if (url.contains("zeptonow.com")) return 50;
                if (url.contains("zepto.com")) return 20;
                return 10;
            case "blinkit":
                if (url.contains("blinkit.com")) return 50;
                return 10;
            case "instamart":
                if (url.contains("swiggy.com")) return 50;
                return 10;
            case "bigbasket":
                if (url.contains("bigbasket.com")) return 50;
                return 10;
            case "jiomart":
                if (url.contains("jiomart.com")) return 50;
                return 10;
            default:
                return 10;
        }
    }

    private int scoreCookieValueQuality(String cookieName, String cookieValue) {
        String key = String.valueOf(cookieName == null ? "" : cookieName).trim().toLowerCase();
        String value = String.valueOf(cookieValue == null ? "" : cookieValue).trim();

        if (TextUtils.isEmpty(value)) {
            return -100;
        }

        if ("null".equalsIgnoreCase(value) || "undefined".equalsIgnoreCase(value)) {
            return -100;
        }

        int score = Math.min(60, value.length());

        if (looksLikeJwt(value)) {
            score += 80;
        }

        if (looksLikeUuid(value)) {
            score += 20;
        }

        if (isLikelyPlaceholderCookieValue(value)) {
            score -= 90;
        }

        if (isAuthCookieKey(key)) {
            score += 20;
            if (value.length() < 16) {
                score -= 40;
            }
        }

        return score;
    }

    private boolean isAuthCookieKey(String key) {
        if (TextUtils.isEmpty(key)) {
            return false;
        }

        return key.contains("token")
            || key.contains("auth")
            || key.contains("session")
            || key.contains("xsrf")
            || key.contains("csrf")
            || key.contains("device")
            || key.contains("unique_browser");
    }

    private boolean isLikelyPlaceholderCookieValue(String value) {
        String probe = String.valueOf(value == null ? "" : value).trim();
        if (TextUtils.isEmpty(probe)) {
            return true;
        }

        return PLACEHOLDER_TOKEN_PATTERN.matcher(probe).matches();
    }

    private boolean looksLikeJwt(String value) {
        String probe = String.valueOf(value == null ? "" : value).trim();
        if (probe.length() < 40) {
            return false;
        }

        return JWT_LIKE_PATTERN.matcher(probe).matches();
    }

    private boolean looksLikeUuid(String value) {
        String probe = String.valueOf(value == null ? "" : value).trim();
        return UUID_LIKE_PATTERN.matcher(probe).matches();
    }

    private JSONObject readCapturedHeadersForPlatform(String platformId) {
        JSONObject out = new JSONObject();
        if (TextUtils.isEmpty(platformId)) {
            return out;
        }

        SharedPreferences prefs = activity.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE);
        String raw = prefs.getString(PREF_CAPTURED_HEADERS_PREFIX + platformId, "{}");

        try {
            JSONObject parsed = new JSONObject(raw);
            java.util.Iterator<String> keys = parsed.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = String.valueOf(parsed.opt(key)).trim();
                if (TextUtils.isEmpty(value)) {
                    continue;
                }

                String canonical = toCanonicalHeaderName(key);
                if (TextUtils.isEmpty(canonical)) {
                    continue;
                }

                out.put(canonical, value);
            }
        } catch (JSONException ignored) {
            return new JSONObject();
        }

        return out;
    }

    private String toCanonicalHeaderName(String rawName) {
        if (TextUtils.isEmpty(rawName)) {
            return "";
        }

        String normalized = rawName.trim().toLowerCase();
        if (
            normalized.startsWith("x-")
                || normalized.startsWith("sec-ch-")
                || normalized.startsWith("sec-fetch-")
        ) {
            return normalized;
        }

        switch (normalized) {
            case "authorization":
                return "Authorization";
            case "x-device-id":
                return "x-device-id";
            case "x-session-id":
                return "x-session-id";
            case "x-unique-browser-id":
                return "x-unique-browser-id";
            case "x-xsrf-token":
                return "x-xsrf-token";
            case "x-csrf-token":
                return "x-csrf-token";
            case "x-without-bearer":
                return "X-WITHOUT-BEARER";
            case "platform":
                return "platform";
            case "app-version":
                return "app-version";
            case "cookie":
                return "Cookie";
            case "user-agent":
                return "User-Agent";
            case "accept":
                return "Accept";
            case "accept-language":
                return "Accept-Language";
            case "origin":
                return "Origin";
            case "referer":
                return "Referer";
            case "priority":
                return "priority";
            case "dnt":
                return "DNT";
            case "cache-control":
                return "Cache-Control";
            case "pragma":
                return "Pragma";
            case "app_client":
                return "app_client";
            case "web_app_version":
                return "web_app_version";
            case "lat":
                return "lat";
            case "lon":
                return "lon";
            default:
                return "";
        }
    }

    private JSONObject toJsonObject(Map<String, String> values) {
        JSONObject out = new JSONObject();
        if (values == null || values.isEmpty()) {
            return out;
        }

        for (Map.Entry<String, String> entry : values.entrySet()) {
            String key = entry.getKey();
            String value = entry.getValue();

            if (TextUtils.isEmpty(key) || value == null) {
                continue;
            }

            try {
                out.put(key, value);
            } catch (JSONException ignored) {
                // Ignore malformed keys while building structured payload.
            }
        }

        return out;
    }

    private void runDeviceSearchJob(DeviceSearchJob job) {
        job.status = "running";

        for (String platform : job.platforms) {
            if (job.cancelled) {
                job.status = "cancelled";
                return;
            }

            String cookieHeader = findCookieHeaderForPlatform(platform);
            if (TextUtils.isEmpty(cookieHeader)) {
                updatePlatformStatus(job, platform, "error: reconnect_required");
            } else {
                try {
                    JSONObject capturedHeaders = readCapturedHeadersForPlatform(platform);
                    PlatformSearchOutcome outcome = searchPlatformOnDevice(
                        platform,
                        job.query,
                        job.lat,
                        job.lon,
                        cookieHeader,
                        capturedHeaders
                    );

                    if (outcome.error == null) {
                        synchronized (job.results) {
                            job.results.addAll(outcome.products);
                        }

                        if (outcome.products.isEmpty()) {
                            updatePlatformStatus(job, platform, "ok:no_results");
                        } else {
                            updatePlatformStatus(job, platform, "ok");
                        }
                    } else {
                        updatePlatformStatus(job, platform, "error: " + outcome.error);
                    }
                } catch (Exception ex) {
                    String message = ex.getMessage();
                    if (TextUtils.isEmpty(message)) {
                        message = "adapter_failed";
                    }
                    updatePlatformStatus(job, platform, "error: " + message);
                }
            }

            job.resolved += 1;

            try {
                Thread.sleep(PLATFORM_STEP_DELAY_MS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                job.error = "search_interrupted";
                job.status = "error";
                return;
            }
        }

        if (job.cancelled) {
            job.status = "cancelled";
            return;
        }

        job.status = "completed";
    }

    private void updatePlatformStatus(DeviceSearchJob job, String platform, String status) {
        synchronized (job.platformStatus) {
            job.platformStatus.put(platform, status);
        }
    }

    private JSONObject buildSearchJobPayload(DeviceSearchJob job) throws JSONException {
        JSONObject payload = new JSONObject();
        payload.put("mode", DEVICE_SEARCH_MODE);
        payload.put("jobId", job.jobId);
        payload.put("status", job.status);
        payload.put("query", job.query);
        payload.put("resolved", job.resolved);
        payload.put("totalPlatforms", job.totalPlatforms);
        payload.put("createdAt", job.createdAt);
        payload.put("updatedAt", System.currentTimeMillis());

        if (job.lat != null) {
            payload.put("lat", job.lat);
        } else {
            payload.put("lat", JSONObject.NULL);
        }

        if (job.lon != null) {
            payload.put("lon", job.lon);
        } else {
            payload.put("lon", JSONObject.NULL);
        }

        JSONArray platformList = new JSONArray();
        for (String platform : job.platforms) {
            platformList.put(platform);
        }
        payload.put("platforms", platformList);

        JSONObject statusPayload = new JSONObject();
        synchronized (job.platformStatus) {
            for (Map.Entry<String, String> entry : job.platformStatus.entrySet()) {
                statusPayload.put(entry.getKey(), entry.getValue());
            }
        }
        payload.put("platformStatus", statusPayload);

        JSONArray resultList = new JSONArray();
        synchronized (job.results) {
            for (JSONObject item : job.results) {
                if (item != null) {
                    resultList.put(item);
                }
            }
        }
        payload.put("results", resultList);
        payload.put("fallbackUsed", false);

        if (!TextUtils.isEmpty(job.error)) {
            payload.put("error", job.error);
        }

        return payload;
    }

    private String searchErrorPayload(String message) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("ok", false);
            payload.put("mode", DEVICE_SEARCH_MODE);
            payload.put("error", message == null ? "native_search_error" : message);
            return payload.toString();
        } catch (JSONException ignored) {
            return "{\"ok\":false,\"mode\":\"device_bridge_v1\",\"error\":\"native_search_error\"}";
        }
    }

    private PlatformSearchOutcome searchPlatformOnDevice(
        String platform,
        String query,
        Double lat,
        Double lon,
        String cookieHeader,
        JSONObject capturedHeaders
    ) {
        switch (platform) {
            case "blinkit":
                return searchBlinkitOnDevice(query, lat, lon, cookieHeader, capturedHeaders);
            case "zepto":
                return searchZeptoOnDevice(query, cookieHeader, capturedHeaders);
            case "instamart":
                return searchInstamartOnDevice(query, cookieHeader, capturedHeaders);
            case "bigbasket":
            case "jiomart":
                return PlatformSearchOutcome.error("adapter_not_implemented");
            default:
                return PlatformSearchOutcome.error("unsupported_platform");
        }
    }

    private PlatformSearchOutcome searchBlinkitOnDevice(
        String query,
        Double lat,
        Double lon,
        String cookieHeader,
        JSONObject capturedHeaders
    ) {
        try {
            Map<String, String> cookieMap = parseCookieHeader(cookieHeader);
            String layoutUrl = "https://blinkit.com/v1/layout/search?q="
                + encodeQueryParam(query)
                + "&search_type=type_to_search";
            String searchUrl = "https://blinkit.com/v1/search?query="
                + encodeQueryParam(query)
                + "&search_type=type_to_search";

            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Accept", "application/json, text/plain, */*");
            headers.put("Content-Type", "application/json");

            if (!TextUtils.isEmpty(cookieHeader)) {
                headers.put("Cookie", cookieHeader);
            }

            applyCapturedHeaderIfMissing(headers, capturedHeaders, "Authorization", "authorization");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-access-token", "x-access-token");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-device-id", "x-device-id");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-session-id", "x-session-id");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-unique-browser-id", "x-unique-browser-id");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-xsrf-token", "x-xsrf-token");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-csrf-token", "x-csrf-token");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "app_client", "app_client");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "web_app_version", "web_app_version");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "lat", "lat");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "lon", "lon");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "User-Agent", "user-agent", "User-Agent");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "Accept-Language", "accept-language", "Accept-Language");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "Origin", "origin", "Origin");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "Referer", "referer", "Referer");
            mergeBlinkitCapturedHeaders(headers, capturedHeaders);

            putMapHeaderIfMissing(headers, "lat", String.valueOf(lat != null ? lat : 28.4595));
            putMapHeaderIfMissing(headers, "lon", String.valueOf(lon != null ? lon : 77.0266));
            putMapHeaderIfMissing(headers, "app_client", "consumer_web");
            putMapHeaderIfMissing(headers, "web_app_version", "2.0.0");
            putMapHeaderIfMissing(headers, "User-Agent", DEFAULT_USER_AGENT);
            putMapHeaderIfMissing(headers, "Origin", "https://blinkit.com");
            putMapHeaderIfMissing(headers, "Referer", "https://blinkit.com/s/?q=" + encodeQueryParam(query));

            String accessToken = firstCookieValue(
                cookieMap,
                "gr_1_accessToken",
                "accessToken",
                "auth_token",
                "token"
            );
            if (!TextUtils.isEmpty(accessToken)) {
                putMapHeaderIfMissing(headers, "Authorization", toBearerToken(accessToken));
                putMapHeaderIfMissing(headers, "x-access-token", accessToken);
            }

            String deviceId = firstCookieValue(
                cookieMap,
                "gr_1_deviceId",
                "gr_1_device_id",
                "device_id",
                "_device_id"
            );
            if (!TextUtils.isEmpty(deviceId)) {
                putMapHeaderIfMissing(headers, "x-device-id", deviceId);
            }

            String sessionId = firstCookieValue(
                cookieMap,
                "gr_1_session_id",
                "gr_1_sessionId",
                "session_id"
            );
            if (!TextUtils.isEmpty(sessionId)) {
                putMapHeaderIfMissing(headers, "x-session-id", sessionId);
            }

            String browserId = firstCookieValue(
                cookieMap,
                "gr_1_unique_browser_id",
                "gr_1_uniqueBrowserId",
                "unique_browser_id"
            );
            if (!TextUtils.isEmpty(browserId)) {
                putMapHeaderIfMissing(headers, "x-unique-browser-id", browserId);
            }

            List<HttpResult> responses = new ArrayList<>();
            boolean sawSuccessfulResponse = false;

            HttpResult primary = executeHttpRequest(layoutUrl, "POST", headers, "{}", PLATFORM_TIMEOUT_MS);
            responses.add(primary);

            List<JSONObject> primaryProducts = extractBlinkitProductsFromPayload(primary.body);
            if (!primaryProducts.isEmpty()) {
                return PlatformSearchOutcome.success(primaryProducts);
            }

            if (primary.statusCode >= 200 && primary.statusCode < 300) {
                sawSuccessfulResponse = true;
            }

            if (
                primary.statusCode == 401
                    || primary.statusCode == 403
                    || primary.statusCode == 202
                    || primary.statusCode >= 500
            ) {
                Map<String, String> getHeaders = new LinkedHashMap<>(headers);
                getHeaders.remove("Content-Type");

                HttpResult fallbackSearch = executeHttpRequest(searchUrl, "GET", getHeaders, null, PLATFORM_TIMEOUT_MS);
                responses.add(fallbackSearch);

                List<JSONObject> fallbackSearchProducts = extractBlinkitProductsFromPayload(fallbackSearch.body);
                if (!fallbackSearchProducts.isEmpty()) {
                    return PlatformSearchOutcome.success(fallbackSearchProducts);
                }

                if (fallbackSearch.statusCode >= 200 && fallbackSearch.statusCode < 300) {
                    sawSuccessfulResponse = true;
                }

                HttpResult fallbackLayout = executeHttpRequest(layoutUrl, "GET", getHeaders, null, PLATFORM_TIMEOUT_MS);
                responses.add(fallbackLayout);

                List<JSONObject> fallbackLayoutProducts = extractBlinkitProductsFromPayload(fallbackLayout.body);
                if (!fallbackLayoutProducts.isEmpty()) {
                    return PlatformSearchOutcome.success(fallbackLayoutProducts);
                }

                if (fallbackLayout.statusCode >= 200 && fallbackLayout.statusCode < 300) {
                    sawSuccessfulResponse = true;
                }
            }

            boolean sawSessionInvalid = false;
            boolean sawWafChallenge = false;
            String fallbackError = null;

            for (HttpResult response : responses) {
                if (response == null) {
                    continue;
                }

                if (response.statusCode == 401) {
                    sawSessionInvalid = true;
                    continue;
                }

                if (response.statusCode == 403) {
                    if (isLikelyWafChallengeResponse(response)) {
                        sawWafChallenge = true;
                    } else {
                        sawSessionInvalid = true;
                    }
                    continue;
                }

                if (response.statusCode == 202 && "challenge".equalsIgnoreCase(String.valueOf(response.wafAction))) {
                    sawWafChallenge = true;
                    continue;
                }

                if (response.statusCode < 200 || response.statusCode >= 300) {
                    fallbackError = "HTTP " + response.statusCode;
                }
            }

            if (sawWafChallenge) {
                return PlatformSearchOutcome.error("waf_challenge");
            }

            if (sawSessionInvalid) {
                return PlatformSearchOutcome.error("session_invalid");
            }

            if (sawSuccessfulResponse) {
                return PlatformSearchOutcome.success(Collections.emptyList());
            }

            if (!TextUtils.isEmpty(fallbackError)) {
                return PlatformSearchOutcome.error(fallbackError);
            }

            return PlatformSearchOutcome.error("invalid_json_response");
        } catch (Exception ex) {
            return PlatformSearchOutcome.error(errorMessage(ex));
        }
    }

    private List<JSONObject> extractBlinkitProductsFromPayload(String rawPayload) {
        JSONObject data = safeJsonObject(rawPayload);
        if (data == null) {
            return Collections.emptyList();
        }

        List<JSONObject> products = new ArrayList<>();

        JSONArray snippets = getNestedArray(data, "response", "snippets");
        if (snippets != null) {
            for (int index = 0; index < snippets.length(); index += 1) {
                JSONObject snippet = snippets.optJSONObject(index);
                if (snippet == null) {
                    continue;
                }

                JSONObject raw = snippet.optJSONObject("data");
                JSONObject normalized = normaliseBlinkitProduct(raw);
                if (normalized != null) {
                    products.add(normalized);
                }
            }
        }

        JSONArray oldObjects = getNestedArray(data, "objects");
        if (oldObjects != null && oldObjects.length() > 0) {
            JSONObject first = oldObjects.optJSONObject(0);
            JSONArray oldItems = getNestedArray(first, "data", "objects");

            if (oldItems != null) {
                for (int index = 0; index < oldItems.length(); index += 1) {
                    JSONObject raw = oldItems.optJSONObject(index);
                    JSONObject normalized = normaliseBlinkitProduct(raw);
                    if (normalized != null) {
                        products.add(normalized);
                    }
                }
            }
        }

        List<Object> stack = new ArrayList<>();
        stack.add(data);

        int walked = 0;
        while (!stack.isEmpty() && walked < 9000) {
            Object node = stack.remove(stack.size() - 1);
            walked += 1;

            if (node instanceof JSONObject) {
                JSONObject object = (JSONObject) node;

                JSONObject normalized = normaliseBlinkitProduct(object);
                if (normalized != null) {
                    products.add(normalized);
                }

                JSONArray names = object.names();
                if (names == null) {
                    continue;
                }

                for (int index = 0; index < names.length(); index += 1) {
                    String key = names.optString(index, "");
                    if (TextUtils.isEmpty(key)) {
                        continue;
                    }

                    Object value = object.opt(key);
                    if (value instanceof JSONObject || value instanceof JSONArray) {
                        stack.add(value);
                    }
                }
                continue;
            }

            if (node instanceof JSONArray) {
                JSONArray array = (JSONArray) node;
                for (int index = 0; index < array.length(); index += 1) {
                    Object value = array.opt(index);
                    if (value instanceof JSONObject || value instanceof JSONArray) {
                        stack.add(value);
                    }
                }
            }
        }

        return dedupeProductsById(products);
    }

    private PlatformSearchOutcome searchZeptoOnDevice(String query, String cookieHeader, JSONObject capturedHeaders) {
        try {
            Map<String, String> cookieMap = parseCookieHeader(cookieHeader);
            String[] endpoints = new String[] {
                "https://bff-gateway.zeptonow.com/user-search-service/api/v3/search",
                "https://bff-gateway.zepto.com/user-search-service/api/v3/search"
            };

            String intentId = firstCookieValue(cookieMap, "intentId", "intent_id");
            String userSessionId = getFirstHeaderValueIgnoreCase(capturedHeaders, "x-session-id");
            if (TextUtils.isEmpty(userSessionId)) {
                userSessionId = firstCookieValue(
                    cookieMap,
                    "session_id",
                    "_session_tid",
                    "session_count"
                );
            }

            List<ZeptoRequestVariant> variants = new ArrayList<>();
            variants.add(new ZeptoRequestVariant("AUTOSUGGEST", 0, true, false, false, null));
            variants.add(new ZeptoRequestVariant("TYPED", 0, true, true, false, intentId));
            variants.add(new ZeptoRequestVariant("SHOW_ALL_RESULTS", 0, true, true, false, intentId));
            variants.add(new ZeptoRequestVariant("AUTOSUGGEST", 0, false, true, true, intentId));
            variants.add(new ZeptoRequestVariant("TYPED", 0, false, true, true, intentId));
            variants.add(new ZeptoRequestVariant("SHOW_ALL_RESULTS", 0, false, true, true, intentId));

            String lastError = null;

            for (String endpoint : endpoints) {
                for (ZeptoRequestVariant variant : variants) {
                    Map<String, String> headers = new LinkedHashMap<>();
                    headers.put("Accept", "application/json, text/plain, */*");
                    headers.put("Content-Type", "application/json");
                    headers.put("platform", "WEB");
                    headers.put("app-version", "1.0.0");
                    headers.put("User-Agent", DEFAULT_USER_AGENT);

                    if (!TextUtils.isEmpty(cookieHeader)) {
                        headers.put("Cookie", cookieHeader);
                    }

                    applyCapturedHeaderIfMissing(headers, capturedHeaders, "Authorization", "authorization");
                    applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-access-token", "x-access-token");
                    applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-device-id", "x-device-id");
                    applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-session-id", "x-session-id");
                    applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-unique-browser-id", "x-unique-browser-id");
                    applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-xsrf-token", "x-xsrf-token");
                    applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-csrf-token", "x-csrf-token");
                    applyCapturedHeaderIfMissing(headers, capturedHeaders, "platform", "platform");
                    applyCapturedHeaderIfMissing(headers, capturedHeaders, "app-version", "app-version");

                    String accessToken = firstCookieValue(cookieMap, "accessToken", "auth_token", "token");
                    if (variant.includeAuth && !TextUtils.isEmpty(accessToken)) {
                        putMapHeaderIfMissing(headers, "Authorization", toBearerToken(accessToken));
                        putMapHeaderIfMissing(headers, "x-access-token", accessToken);
                    }

                    if (!variant.includeAuth) {
                        headers.remove("Authorization");
                        headers.remove("x-access-token");
                    }

                    if (variant.withoutBearer) {
                        headers.put("X-WITHOUT-BEARER", "true");
                    }

                    String xsrf = cookieMap.containsKey("XSRF-TOKEN")
                        ? cookieMap.get("XSRF-TOKEN")
                        : cookieMap.get("xsrfToken");
                    if (!TextUtils.isEmpty(xsrf)) {
                        putMapHeaderIfMissing(headers, "x-xsrf-token", xsrf);
                        putMapHeaderIfMissing(headers, "x-csrf-token", xsrf);
                    }

                    if (!TextUtils.isEmpty(cookieMap.get("device_id"))) {
                        putMapHeaderIfMissing(headers, "x-device-id", cookieMap.get("device_id"));
                    }
                    if (!TextUtils.isEmpty(cookieMap.get("session_id"))) {
                        putMapHeaderIfMissing(headers, "x-session-id", cookieMap.get("session_id"));
                    }
                    if (!TextUtils.isEmpty(cookieMap.get("unique_browser_id"))) {
                        putMapHeaderIfMissing(headers, "x-unique-browser-id", cookieMap.get("unique_browser_id"));
                    }

                    JSONObject payload = new JSONObject();
                    payload.put("query", query);
                    payload.put("pageNumber", variant.pageNumber);
                    payload.put("mode", variant.mode);

                    if (!TextUtils.isEmpty(variant.intentId)) {
                        payload.put("intentId", variant.intentId);
                    }

                    if (variant.includeUserSession && !TextUtils.isEmpty(userSessionId)) {
                        payload.put("userSessionId", userSessionId);
                    }

                    HttpResult response = executeHttpRequest(
                        endpoint,
                        "POST",
                        headers,
                        payload.toString(),
                        PLATFORM_TIMEOUT_MS
                    );

                    if (response.statusCode == 401) {
                        lastError = "session_invalid";
                        continue;
                    }

                    if (response.statusCode == 403) {
                        lastError = isLikelyWafChallengeResponse(response) ? "waf_challenge" : "session_invalid";
                        continue;
                    }

                    if (response.statusCode == 400 && looksLikeInvalidZeptoTokenResponse(response.body)) {
                        lastError = "session_invalid";
                        continue;
                    }

                    if (response.statusCode == 400 && String.valueOf(response.body).toLowerCase().contains("invalid request")) {
                        if (lastError == null) {
                            lastError = "invalid_request";
                        }
                        continue;
                    }

                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        lastError = "HTTP " + response.statusCode;
                        continue;
                    }

                    JSONObject data = safeJsonObject(response.body);
                    if (data == null) {
                        lastError = "invalid_json_response";
                        continue;
                    }

                    JSONArray layout = data.optJSONArray("layout");
                    if (layout == null) {
                        lastError = "missing_layout";
                        continue;
                    }

                    List<JSONObject> products = new ArrayList<>();
                    for (int index = 0; index < layout.length(); index += 1) {
                        JSONObject widget = layout.optJSONObject(index);
                        if (!isZeptoProductGrid(widget)) {
                            continue;
                        }

                        JSONArray items = getNestedArray(widget, "data", "resolver", "data", "items");
                        if (items == null) {
                            items = getNestedArray(widget, "data", "items");
                        }
                        if (items == null) {
                            continue;
                        }

                        for (int itemIndex = 0; itemIndex < items.length(); itemIndex += 1) {
                            JSONObject item = items.optJSONObject(itemIndex);
                            JSONObject normalized = normaliseZeptoApiItem(item);
                            if (normalized != null) {
                                products.add(normalized);
                            }
                        }
                    }

                    if (!products.isEmpty()) {
                        return PlatformSearchOutcome.success(products);
                    }
                }
            }

            HtmlSearchFallbackResult htmlFallback = searchZeptoViaHtmlOnDevice(query, cookieHeader);
            if (!htmlFallback.matchedProducts.isEmpty()) {
                return PlatformSearchOutcome.success(htmlFallback.matchedProducts);
            }

            if (!htmlFallback.genericProducts.isEmpty()) {
                return PlatformSearchOutcome.success(htmlFallback.genericProducts);
            }

            if (lastError == null) {
                return PlatformSearchOutcome.success(Collections.emptyList());
            }

            return PlatformSearchOutcome.error(lastError);
        } catch (Exception ex) {
            return PlatformSearchOutcome.error(errorMessage(ex));
        }
    }

    private HtmlSearchFallbackResult searchZeptoViaHtmlOnDevice(String query, String cookieHeader) {
        try {
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Accept", "text/html");
            headers.put("User-Agent", DEFAULT_USER_AGENT);

            if (!TextUtils.isEmpty(cookieHeader)) {
                headers.put("Cookie", cookieHeader);
            }

            String[] urls = new String[] {
                "https://www.zeptonow.com/search?query=" + encodeQueryParam(query),
                "https://www.zeptonow.com/search?q=" + encodeQueryParam(query),
                "https://www.zepto.com/search?query=" + encodeQueryParam(query)
            };

            List<JSONObject> merged = new ArrayList<>();
            for (String url : urls) {
                HttpResult response = executeHttpRequest(url, "GET", headers, null, PLATFORM_TIMEOUT_MS);
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    continue;
                }

                List<JSONObject> products = extractZeptoProductsFromHtmlPayload(response.body);
                if (!products.isEmpty()) {
                    merged.addAll(products);
                }
            }

            List<JSONObject> deduped = dedupeProductsById(merged);
            if (deduped.isEmpty()) {
                return HtmlSearchFallbackResult.empty();
            }

            List<String> queryTerms = extractSearchTerms(query);
            if (queryTerms.isEmpty()) {
                return new HtmlSearchFallbackResult(deduped, deduped);
            }

            List<ScoredProduct> ranked = new ArrayList<>();
            for (JSONObject product : deduped) {
                int score = scoreSearchMatch(product, queryTerms);
                if (score > 0) {
                    ranked.add(new ScoredProduct(product, score));
                }
            }

            ranked.sort((left, right) -> Integer.compare(right.score, left.score));

            if (!ranked.isEmpty()) {
                List<JSONObject> matched = new ArrayList<>();
                for (ScoredProduct entry : ranked) {
                    matched.add(entry.product);
                }

                return new HtmlSearchFallbackResult(matched, deduped);
            }

            return new HtmlSearchFallbackResult(Collections.emptyList(), deduped);
        } catch (Exception ignored) {
            return HtmlSearchFallbackResult.empty();
        }
    }

    private List<JSONObject> extractZeptoProductsFromHtmlPayload(String html) {
        String rawHtml = String.valueOf(html == null ? "" : html);
        if (TextUtils.isEmpty(rawHtml)) {
            return Collections.emptyList();
        }

        String normalized = rawHtml.replace("\\\"", "\"");
        List<JSONObject> merged = new ArrayList<>();

        String[] campaigns = new String[] {
            "\"campaignName\":\"PRODUCT_GRID_01_WEB\"",
            "\"campaignName\":\"PRODUCT_GRID\"",
            "\"widget_name\":\"PRODUCT_GRID_01_WEB\"",
            "\"widget_id\":\"PRE_SEARCH_PRODUCT_GRID\""
        };

        for (String marker : campaigns) {
            int from = 0;
            while (true) {
                int markerIdx = normalized.indexOf(marker, from);
                if (markerIdx < 0) {
                    break;
                }

                int itemsKeyIdx = normalized.indexOf("\"items\":[", markerIdx);
                if (itemsKeyIdx > -1) {
                    String itemsRaw = extractJsonArrayFromIndex(normalized, itemsKeyIdx + "\"items\":".length());
                    JSONArray parsedItems = safeJsonArray(itemsRaw);
                    if (parsedItems != null) {
                        for (int index = 0; index < parsedItems.length(); index += 1) {
                            JSONObject item = parsedItems.optJSONObject(index);
                            JSONObject product = normaliseZeptoHtmlItem(item);
                            if (product != null) {
                                merged.add(product);
                            }
                        }
                    }
                }

                from = markerIdx + marker.length();
            }
        }

        if (!merged.isEmpty()) {
            return dedupeProductsById(merged);
        }

        JSONObject nextData = extractNextDataObject(rawHtml);
        if (nextData == null) {
            return Collections.emptyList();
        }

        List<JSONObject> extracted = extractZeptoProductsFromNextData(nextData);
        return dedupeProductsById(extracted);
    }

    private JSONObject extractNextDataObject(String html) {
        String marker = "<script id=\"__NEXT_DATA__\" type=\"application/json\">";
        int start = html.indexOf(marker);
        if (start < 0) {
            return null;
        }

        int payloadStart = start + marker.length();
        int end = html.indexOf("</script>", payloadStart);
        if (end < 0) {
            return null;
        }

        String raw = html.substring(payloadStart, end);
        return safeJsonObject(raw);
    }

    private List<JSONObject> extractZeptoProductsFromNextData(Object root) {
        List<JSONObject> out = new ArrayList<>();
        List<Object> stack = new ArrayList<>();
        stack.add(root);

        int walked = 0;
        while (!stack.isEmpty() && walked < 12000) {
            Object node = stack.remove(stack.size() - 1);
            walked += 1;

            if (node instanceof JSONObject) {
                JSONObject object = (JSONObject) node;
                JSONObject product = normaliseZeptoApiItem(object);
                if (product != null) {
                    out.add(product);
                }

                JSONArray names = object.names();
                if (names == null) {
                    continue;
                }

                for (int index = 0; index < names.length(); index += 1) {
                    String key = names.optString(index, "");
                    if (TextUtils.isEmpty(key)) {
                        continue;
                    }

                    Object value = object.opt(key);
                    if (value instanceof JSONObject || value instanceof JSONArray) {
                        stack.add(value);
                    }
                }
                continue;
            }

            if (node instanceof JSONArray) {
                JSONArray array = (JSONArray) node;
                for (int index = 0; index < array.length(); index += 1) {
                    Object value = array.opt(index);
                    if (value instanceof JSONObject || value instanceof JSONArray) {
                        stack.add(value);
                    }
                }
            }
        }

        return out;
    }

    private List<JSONObject> dedupeProductsById(List<JSONObject> products) {
        Map<String, JSONObject> deduped = new LinkedHashMap<>();

        if (products == null || products.isEmpty()) {
            return Collections.emptyList();
        }

        for (JSONObject product : products) {
            if (product == null) {
                continue;
            }

            String id = product.optString("id", "").trim();
            if (TextUtils.isEmpty(id)) {
                continue;
            }

            deduped.put(id, product);
        }

        return new ArrayList<>(deduped.values());
    }

    private List<String> extractSearchTerms(String query) {
        String[] parts = String.valueOf(query == null ? "" : query)
            .toLowerCase()
            .split("[^a-z0-9]+");

        Set<String> deduped = new LinkedHashSet<>();
        for (String part : parts) {
            String term = String.valueOf(part == null ? "" : part).trim();
            if (term.length() >= 2) {
                deduped.add(term);
            }
        }

        return new ArrayList<>(deduped);
    }

    private int scoreSearchMatch(JSONObject product, List<String> queryTerms) {
        if (product == null || queryTerms == null || queryTerms.isEmpty()) {
            return 0;
        }

        String name = product.optString("name", "");
        String brand = product.optString("brand", "");
        String haystack = (name + " " + brand).toLowerCase();
        if (TextUtils.isEmpty(haystack.trim())) {
            return 0;
        }

        int score = 0;
        for (String term : queryTerms) {
            if (haystack.contains(term)) {
                score += term.length();
            }
        }

        if (queryTerms.size() > 1) {
            String joined = TextUtils.join(" ", queryTerms);
            if (!TextUtils.isEmpty(joined) && haystack.contains(joined)) {
                score += 5;
            }
        }

        return score;
    }

    private boolean isLikelyWafChallengeResponse(HttpResult response) {
        if (response == null) {
            return false;
        }

        String contentType = String.valueOf(response.contentType == null ? "" : response.contentType).toLowerCase();
        String wafAction = String.valueOf(response.wafAction == null ? "" : response.wafAction).toLowerCase();
        String probe = String.valueOf(response.body == null ? "" : response.body).toLowerCase();

        if ("challenge".equals(wafAction) || "captcha".equals(wafAction)) {
            return true;
        }

        if (contentType.contains("text/html")) {
            if (TextUtils.isEmpty(probe)) {
                return true;
            }

            if (
                probe.contains("attention required")
                    || probe.contains("cloudflare")
                    || probe.contains("captcha")
                    || probe.contains("cf-chl")
                    || probe.contains("access denied")
                    || probe.contains("request blocked")
            ) {
                return true;
            }
        }

        return response.statusCode == 403 && (
            probe.contains("cloudflare") || probe.contains("cf-chl") || probe.contains("captcha")
        );
    }

    private boolean looksLikeInvalidZeptoTokenResponse(String bodyText) {
        String probe = String.valueOf(bodyText == null ? "" : bodyText).toLowerCase();
        if (TextUtils.isEmpty(probe)) {
            return false;
        }

        return probe.contains("invalid or corrupted token")
            || (probe.contains("invalid") && probe.contains("token"));
    }

    private boolean isAuthLikeZeptoError(String error) {
        String probe = String.valueOf(error == null ? "" : error).trim();
        if (TextUtils.isEmpty(probe)) {
            return false;
        }

        return "session_invalid".equals(probe)
            || "invalid_request".equals(probe)
            || "waf_challenge".equals(probe)
            || "HTTP 401".equals(probe)
            || "HTTP 403".equals(probe);
    }

    private JSONArray safeJsonArray(String raw) {
        if (TextUtils.isEmpty(raw)) {
            return null;
        }

        try {
            return new JSONArray(raw);
        } catch (JSONException ignored) {
            return null;
        }
    }

    private String extractJsonArrayFromIndex(String text, int arrayStartIndex) {
        if (text == null || text.isEmpty() || arrayStartIndex < 0 || arrayStartIndex >= text.length()) {
            return null;
        }

        int start = arrayStartIndex;
        while (start < text.length() && text.charAt(start) != '[') {
            start += 1;
        }

        if (start >= text.length()) {
            return null;
        }

        boolean inString = false;
        boolean escaped = false;
        int depth = 0;

        for (int index = start; index < text.length(); index += 1) {
            char ch = text.charAt(index);

            if (escaped) {
                escaped = false;
                continue;
            }

            if (ch == '\\') {
                escaped = true;
                continue;
            }

            if (ch == '"') {
                inString = !inString;
                continue;
            }

            if (inString) {
                continue;
            }

            if (ch == '[') {
                depth += 1;
            } else if (ch == ']') {
                depth -= 1;
                if (depth == 0) {
                    return text.substring(start, index + 1);
                }
            }
        }

        return null;
    }

    private JSONObject normaliseZeptoHtmlItem(JSONObject item) {
        if (item == null) {
            return null;
        }

        return normaliseZeptoApiItem(item);
    }

    private PlatformSearchOutcome searchInstamartOnDevice(String query, String cookieHeader, JSONObject capturedHeaders) {
        try {
            String url = "https://www.swiggy.com/api/instamart/search/v2?offset=0&ageConsent=false";

            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Accept", "application/json");
            headers.put("Content-Type", "application/json");
            headers.put("User-Agent", DEFAULT_USER_AGENT);

            if (!TextUtils.isEmpty(cookieHeader)) {
                headers.put("Cookie", cookieHeader);
            }

            applyCapturedHeaderIfMissing(headers, capturedHeaders, "Authorization", "authorization");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-device-id", "x-device-id");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-session-id", "x-session-id");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-unique-browser-id", "x-unique-browser-id");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-xsrf-token", "x-xsrf-token");
            applyCapturedHeaderIfMissing(headers, capturedHeaders, "x-csrf-token", "x-csrf-token");

            JSONObject body = new JSONObject();
            body.put("facets", new JSONArray());
            body.put("sortAttribute", "");
            body.put("query", query);
            body.put("search_results_offset", "0");
            body.put("page_type", "INSTAMART_SEARCH_PAGE");
            body.put("is_pre_search_tag", false);

            HttpResult response = executeHttpRequest(
                url,
                "POST",
                headers,
                body.toString(),
                PLATFORM_TIMEOUT_MS
            );

            if (response.statusCode == 202 && "challenge".equalsIgnoreCase(response.wafAction)) {
                return PlatformSearchOutcome.error("waf_challenge");
            }

            if (response.statusCode == 401 || response.statusCode == 403) {
                return PlatformSearchOutcome.error("session_invalid");
            }

            if (response.statusCode < 200 || response.statusCode >= 300) {
                return PlatformSearchOutcome.error("HTTP " + response.statusCode);
            }

            JSONObject data = safeJsonObject(response.body);
            if (data == null) {
                return PlatformSearchOutcome.error("invalid_json_response");
            }

            JSONArray cards = getNestedArray(data, "data", "cards");
            List<JSONObject> products = new ArrayList<>();

            if (cards != null) {
                for (int cardIndex = 0; cardIndex < cards.length(); cardIndex += 1) {
                    JSONObject card = cards.optJSONObject(cardIndex);
                    JSONArray items = getNestedArray(card, "gridElements", "infoWithStyle", "info");
                    if (items == null) {
                        continue;
                    }

                    for (int itemIndex = 0; itemIndex < items.length(); itemIndex += 1) {
                        JSONObject item = items.optJSONObject(itemIndex);
                        JSONObject normalized = normaliseInstamartItem(item);
                        if (normalized != null) {
                            products.add(normalized);
                        }
                    }
                }
            }

            return PlatformSearchOutcome.success(products);
        } catch (Exception ex) {
            return PlatformSearchOutcome.error(errorMessage(ex));
        }
    }

    private HttpResult executeHttpRequest(
        String rawUrl,
        String method,
        Map<String, String> headers,
        String body,
        int timeoutMs
    ) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(rawUrl).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(timeoutMs);
        connection.setReadTimeout(timeoutMs);
        connection.setDoInput(true);

        if (headers != null) {
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if (!TextUtils.isEmpty(entry.getKey()) && !TextUtils.isEmpty(entry.getValue())) {
                    connection.setRequestProperty(entry.getKey(), entry.getValue());
                }
            }
        }

        if (!TextUtils.isEmpty(body)) {
            connection.setDoOutput(true);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }

        int statusCode = connection.getResponseCode();
        String contentType = connection.getHeaderField("content-type");
        String wafAction = connection.getHeaderField("x-amzn-waf-action");

        InputStream stream;
        if (statusCode >= 200 && statusCode < 400) {
            stream = connection.getInputStream();
        } else {
            stream = connection.getErrorStream();
        }

        String responseBody = readStream(stream);
        connection.disconnect();

        return new HttpResult(statusCode, contentType, wafAction, responseBody);
    }

    private String readStream(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }

        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }

        return builder.toString();
    }

    private JSONObject normaliseBlinkitProduct(JSONObject raw) {
        if (raw == null) {
            return null;
        }

        String productId = raw.optString("product_id", raw.optString("id", "")).trim();
        String name = readTextValue(raw.opt("name"));
        if (TextUtils.isEmpty(productId) || TextUtils.isEmpty(name)) {
            return null;
        }

        double price = parsePrice(readTextValue(raw.opt("normal_price")));
        if (price <= 0) {
            price = parsePrice(readTextValue(raw.opt("price")));
        }
        if (price <= 0) {
            price = raw.optDouble("sp", 0);
        }

        if (price <= 0) {
            return null;
        }

        double mrp = parsePrice(readTextValue(raw.opt("mrp")));
        if (mrp <= 0) {
            mrp = parsePrice(readTextValue(raw.opt("normal_price")));
        }
        if (mrp <= 0) {
            mrp = price;
        }

        String quantity = readNestedText(raw, "variant", "text");
        if (TextUtils.isEmpty(quantity)) {
            quantity = raw.optString("unit", "");
        }
        if (TextUtils.isEmpty(quantity)) {
            quantity = raw.optString("weight_unit", "");
        }

        String brand = readTextValue(raw.opt("brand"));
        String image = readNestedText(raw, "image", "url");
        if (TextUtils.isEmpty(image)) {
            JSONArray images = raw.optJSONArray("images");
            if (images != null && images.length() > 0) {
                JSONObject firstImage = images.optJSONObject(0);
                if (firstImage != null) {
                    image = firstImage.optString("url", firstImage.optString("path", null));
                }
            }
        }
        if (TextUtils.isEmpty(image)) {
            image = raw.optString("image_url", null);
        }

        String deliveryEta = readNestedText(raw, "eta_tag", "title", "text");
        if (TextUtils.isEmpty(deliveryEta)) {
            deliveryEta = "10 mins";
        }

        boolean inStock = raw.optBoolean("in_stock", true) && raw.optBoolean("is_in_stock", true);

        return buildProductPayload(
            "blinkit",
            productId,
            name,
            brand,
            image,
            price,
            mrp,
            quantity,
            deliveryEta,
            0,
            inStock,
            "https://blinkit.com/prn/" + productId,
            "#0C831F"
        );
    }

    private JSONObject normaliseZeptoApiItem(JSONObject item) {
        if (item == null) {
            return null;
        }

        JSONObject productResponse = item.optJSONObject("productResponse");
        if (productResponse == null) {
            productResponse = item.optJSONObject("cardData");
        }

        JSONObject product = productResponse != null ? productResponse.optJSONObject("product") : null;
        if (product == null) {
            product = item.optJSONObject("product");
        }

        JSONObject variant = productResponse != null ? productResponse.optJSONObject("productVariant") : null;
        if (variant == null && product != null) {
            variant = product.optJSONObject("productVariant");
        }

        String productId = "";
        if (product != null) {
            productId = product.optString("id", "").trim();
        }
        if (TextUtils.isEmpty(productId) && productResponse != null) {
            productId = productResponse.optString("id", "").trim();
        }
        if (TextUtils.isEmpty(productId)) {
            productId = item.optString("id", "").trim();
        }

        String name = product != null
            ? product.optString("name", productResponse != null ? productResponse.optString("name", "") : "")
            : (productResponse != null ? productResponse.optString("name", "") : "");

        if (TextUtils.isEmpty(productId) || TextUtils.isEmpty(name)) {
            return null;
        }

        double price = toRupees(productResponse != null ? productResponse.optDouble("discountedSellingPrice", productResponse.optDouble("sellingPrice", 0)) : 0);
        if (price <= 0) {
            return null;
        }

        double mrp = toRupees(
            productResponse != null
                ? productResponse.optDouble("mrp", product != null ? product.optDouble("mrp", price) : price)
                : price
        );
        if (mrp <= 0) {
            mrp = price;
        }

        String brand = "";
        if (product != null) {
            JSONObject brandObj = product.optJSONObject("brand");
            brand = brandObj != null ? brandObj.optString("name", "") : "";
        }
        if (TextUtils.isEmpty(brand) && productResponse != null) {
            brand = productResponse.optString("brandName", "");
        }

        String imagePath = null;
        if (product != null) {
            imagePath = firstImagePath(product.optJSONArray("images"));
        }
        if (TextUtils.isEmpty(imagePath) && variant != null) {
            imagePath = firstImagePath(variant.optJSONArray("images"));
        }
        imagePath = normaliseImageUrl(imagePath, "https://cdn.zeptonow.com");

        String quantity = "";
        if (variant != null) {
            quantity = variant.optString("formattedPacksize", variant.optString("packSize", ""));
        }
        if (TextUtils.isEmpty(quantity) && productResponse != null) {
            quantity = productResponse.optString("quantity", "");
        }

        String availabilityStatus = productResponse != null ? productResponse.optString("availabilityStatus", "") : "";
        boolean inStock = "AVAILABLE".equalsIgnoreCase(availabilityStatus)
            || !(productResponse != null && productResponse.optBoolean("outOfStock", false));

        String eta = "10 mins";
        if (productResponse != null && productResponse.has("etaInMins") && !productResponse.isNull("etaInMins")) {
            int etaMins = productResponse.optInt("etaInMins", 10);
            eta = etaMins + " mins";
        }

        return buildProductPayload(
            "zepto",
            productId,
            name,
            brand,
            imagePath,
            price,
            mrp,
            quantity,
            eta,
            0,
            inStock,
            "https://www.zeptonow.com/pn/" + productId,
            "#8025FB"
        );
    }

    private JSONObject normaliseInstamartItem(JSONObject item) {
        if (item == null) {
            return null;
        }

        String productId = item.optString("id", item.optString("productId", "")).trim();
        String name = item.optString("displayName", item.optString("name", "")).trim();
        if (TextUtils.isEmpty(productId) || TextUtils.isEmpty(name)) {
            return null;
        }

        double price = getNestedDouble(item, "price", "offerPrice", "units");
        if (price <= 0) {
            price = getNestedDouble(item, "price", "mrp", "units");
        }
        if (price <= 0) {
            return null;
        }

        double mrp = getNestedDouble(item, "price", "mrp", "units");
        if (mrp <= 0) {
            mrp = price;
        }

        JSONArray imageIds = item.optJSONArray("imageIds");
        String imageId = imageIds != null && imageIds.length() > 0 ? imageIds.optString(0, "") : "";
        String image = TextUtils.isEmpty(imageId)
            ? null
            : "https://media-assets.swiggy.com/swiggy/image/upload/" + imageId;

        String quantity = item.optString("quantityDescription", item.optString("quantity", ""));
        boolean inStock = true;
        JSONObject inventory = item.optJSONObject("inventory");
        if (inventory != null && inventory.has("inStock") && !inventory.isNull("inStock")) {
            inStock = inventory.optBoolean("inStock", true);
        }

        return buildProductPayload(
            "instamart",
            productId,
            name,
            item.optString("brand", ""),
            image,
            price,
            mrp,
            quantity,
            "20-30 mins",
            0,
            inStock,
            "https://www.swiggy.com/instamart/item/" + productId,
            "#FC8019"
        );
    }

    private JSONObject buildProductPayload(
        String platform,
        String productId,
        String name,
        String brand,
        String image,
        double price,
        double mrp,
        String quantity,
        String deliveryEta,
        double deliveryFee,
        boolean inStock,
        String deepLink,
        String platformColor
    ) {
        try {
            JSONObject product = new JSONObject();
            product.put("id", platform + ":" + productId);
            product.put("platform", platform);
            product.put("name", name);
            product.put("brand", TextUtils.isEmpty(brand) ? "" : brand);
            product.put("image", TextUtils.isEmpty(image) ? JSONObject.NULL : image);
            product.put("price", price);
            product.put("mrp", mrp);
            product.put("discount", mrp > price ? Math.round(((mrp - price) / mrp) * 100) : JSONObject.NULL);
            product.put("quantity", TextUtils.isEmpty(quantity) ? "" : quantity);
            product.put("unit", TextUtils.isEmpty(quantity) ? "" : quantity);

            Double unitPrice = computeUnitPrice(price, quantity);
            product.put("unitPrice", unitPrice == null ? JSONObject.NULL : unitPrice);

            product.put("deliveryEta", TextUtils.isEmpty(deliveryEta) ? "999" : deliveryEta);
            product.put("deliveryFee", deliveryFee);
            product.put("inStock", inStock);
            product.put("deepLink", TextUtils.isEmpty(deepLink) ? JSONObject.NULL : deepLink);
            product.put("platformColor", platformColor);
            return product;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private Map<String, String> parseCookieHeader(String cookieHeader) {
        Map<String, String> out = new LinkedHashMap<>();
        if (TextUtils.isEmpty(cookieHeader)) {
            return out;
        }

        String[] parts = cookieHeader.split(";");
        for (String part : parts) {
            String trimmed = part == null ? "" : part.trim();
            int separator = trimmed.indexOf('=');
            if (separator <= 0) {
                continue;
            }

            String key = trimmed.substring(0, separator).trim();
            String value = trimmed.substring(separator + 1).trim();
            if (!TextUtils.isEmpty(key)) {
                out.put(key, value);
            }
        }

        return out;
    }

    private String firstImagePath(JSONArray images) {
        if (images == null || images.length() == 0) {
            return null;
        }

        JSONObject firstImage = images.optJSONObject(0);
        if (firstImage == null) {
            return null;
        }

        String value = firstImage.optString("path", "");
        if (TextUtils.isEmpty(value)) {
            value = firstImage.optString("url", "");
        }

        return TextUtils.isEmpty(value) ? null : value;
    }

    private String normaliseImageUrl(String imagePath, String origin) {
        if (TextUtils.isEmpty(imagePath)) {
            return null;
        }

        if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
            return imagePath;
        }

        if (imagePath.startsWith("//")) {
            return "https:" + imagePath;
        }

        if (imagePath.startsWith("/")) {
            return origin + imagePath;
        }

        return origin + "/" + imagePath;
    }

    private JSONObject safeJsonObject(String raw) {
        try {
            return new JSONObject(raw == null ? "{}" : raw);
        } catch (JSONException ignored) {
            return null;
        }
    }

    private JSONArray getNestedArray(JSONObject root, String... keys) {
        if (root == null || keys == null || keys.length == 0) {
            return null;
        }

        JSONObject cursor = root;
        for (int index = 0; index < keys.length - 1; index += 1) {
            if (cursor == null) {
                return null;
            }
            cursor = cursor.optJSONObject(keys[index]);
        }

        if (cursor == null) {
            return null;
        }

        return cursor.optJSONArray(keys[keys.length - 1]);
    }

    private String readNestedText(JSONObject root, String... keys) {
        if (root == null || keys == null || keys.length == 0) {
            return "";
        }

        Object cursor = root;
        for (String key : keys) {
            if (!(cursor instanceof JSONObject)) {
                return "";
            }
            cursor = ((JSONObject) cursor).opt(key);
            if (cursor == null || cursor == JSONObject.NULL) {
                return "";
            }
        }

        return readTextValue(cursor);
    }

    private double getNestedDouble(JSONObject root, String... keys) {
        if (root == null || keys == null || keys.length == 0) {
            return 0;
        }

        Object cursor = root;
        for (String key : keys) {
            if (!(cursor instanceof JSONObject)) {
                return 0;
            }
            cursor = ((JSONObject) cursor).opt(key);
            if (cursor == null || cursor == JSONObject.NULL) {
                return 0;
            }
        }

        if (cursor instanceof Number) {
            return ((Number) cursor).doubleValue();
        }

        return parsePrice(String.valueOf(cursor));
    }

    private boolean isZeptoProductGrid(JSONObject widget) {
        if (widget == null) {
            return false;
        }

        String widgetId = widget.optString("widgetId", "");
        String type = widget.optString("type", "");
        String campaignName = widget.optString("campaignName", "");

        return "PRODUCT_GRID".equalsIgnoreCase(widgetId)
            || "PRODUCT_GRID".equalsIgnoreCase(type)
            || campaignName.toUpperCase().contains("PRODUCT_GRID");
    }

    private String readTextValue(Object value) {
        if (value == null || value == JSONObject.NULL) {
            return "";
        }

        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            String text = object.optString("text", "");
            if (!TextUtils.isEmpty(text)) {
                return text;
            }

            text = object.optString("value", "");
            if (!TextUtils.isEmpty(text)) {
                return text;
            }

            text = object.optString("name", "");
            if (!TextUtils.isEmpty(text)) {
                return text;
            }

            return object.toString();
        }

        return String.valueOf(value);
    }

    private double parsePrice(Object value) {
        if (value == null || value == JSONObject.NULL) {
            return 0;
        }

        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }

        String text = readTextValue(value).replace(",", "");
        Matcher matcher = PRICE_PATTERN.matcher(text);
        if (!matcher.find()) {
            return 0;
        }

        try {
            return Double.parseDouble(matcher.group(1));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private Double computeUnitPrice(double price, String quantity) {
        if (price <= 0 || TextUtils.isEmpty(quantity)) {
            return null;
        }

        Matcher matcher = UNIT_PATTERN.matcher(quantity.toLowerCase());
        if (!matcher.find()) {
            return null;
        }

        double value;
        try {
            value = Double.parseDouble(matcher.group(1));
        } catch (NumberFormatException ignored) {
            return null;
        }

        String unit = matcher.group(2);
        if ("kg".equals(unit) || "l".equals(unit) || "litre".equals(unit) || "liter".equals(unit) || "ltr".equals(unit)) {
            value = value * 1000;
        }

        if (value <= 0) {
            return null;
        }

        return price / value;
    }

    private double toRupees(double value) {
        if (!Double.isFinite(value) || value <= 0) {
            return 0;
        }

        if (Math.floor(value) == value && value >= 1000) {
            return value / 100.0;
        }

        return value;
    }

    private String encodeQueryParam(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return value == null ? "" : value;
        }
    }

    private String errorMessage(Exception ex) {
        if (ex == null || TextUtils.isEmpty(ex.getMessage())) {
            return "adapter_failed";
        }

        return ex.getMessage();
    }

    private Double readOptionalDouble(JSONObject object, String key) {
        if (object == null || TextUtils.isEmpty(key)) {
            return null;
        }

        if (!object.has(key) || object.isNull(key)) {
            return null;
        }

        double value = object.optDouble(key, Double.NaN);
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            return null;
        }

        return value;
    }

    private List<String> parseRequestedPlatforms(JSONObject request) {
        Set<String> deduped = new LinkedHashSet<>();

        JSONArray requested = request == null ? null : request.optJSONArray("platforms");
        if (requested != null) {
            for (int index = 0; index < requested.length(); index += 1) {
                String platform = safePlatformId(requested.optString(index, ""));
                if (isSupportedSearchPlatform(platform)) {
                    deduped.add(platform);
                }
            }
        }

        if (deduped.isEmpty()) {
            Collections.addAll(deduped, DEFAULT_SEARCH_PLATFORMS);
        }

        return new ArrayList<>(deduped);
    }

    private boolean isSupportedSearchPlatform(String platformId) {
        switch (platformId) {
            case "blinkit":
            case "zepto":
            case "instamart":
            case "bigbasket":
            case "jiomart":
                return true;
            default:
                return false;
        }
    }

    private void cleanupExpiredSearchJobs() {
        long now = System.currentTimeMillis();

        for (Map.Entry<String, DeviceSearchJob> entry : searchJobs.entrySet()) {
            DeviceSearchJob job = entry.getValue();
            long age = now - job.createdAt;

            if (!"running".equals(job.status) && age > SEARCH_JOB_RETENTION_MS) {
                searchJobs.remove(entry.getKey());
            }
        }
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

    private static class CookieCandidate {
        final String key;
        final String value;
        final int qualityScore;
        final int sourcePriority;

        CookieCandidate(String key, String value, int qualityScore, int sourcePriority) {
            this.key = key == null ? "" : key;
            this.value = value == null ? "" : value;
            this.qualityScore = qualityScore;
            this.sourcePriority = sourcePriority;
        }
    }

    private static class ZeptoRequestVariant {
        final String mode;
        final int pageNumber;
        final boolean includeAuth;
        final boolean includeUserSession;
        final boolean withoutBearer;
        final String intentId;

        ZeptoRequestVariant(
            String mode,
            int pageNumber,
            boolean includeAuth,
            boolean includeUserSession,
            boolean withoutBearer,
            String intentId
        ) {
            this.mode = mode == null ? "AUTOSUGGEST" : mode;
            this.pageNumber = pageNumber;
            this.includeAuth = includeAuth;
            this.includeUserSession = includeUserSession;
            this.withoutBearer = withoutBearer;
            this.intentId = TextUtils.isEmpty(intentId) ? null : intentId;
        }
    }

    private static class HtmlSearchFallbackResult {
        final List<JSONObject> matchedProducts;
        final List<JSONObject> genericProducts;

        HtmlSearchFallbackResult(List<JSONObject> matchedProducts, List<JSONObject> genericProducts) {
            this.matchedProducts = matchedProducts == null ? Collections.emptyList() : matchedProducts;
            this.genericProducts = genericProducts == null ? Collections.emptyList() : genericProducts;
        }

        static HtmlSearchFallbackResult empty() {
            return new HtmlSearchFallbackResult(Collections.emptyList(), Collections.emptyList());
        }
    }

    private static class ScoredProduct {
        final JSONObject product;
        final int score;

        ScoredProduct(JSONObject product, int score) {
            this.product = product;
            this.score = score;
        }
    }

    private static class HttpResult {
        final int statusCode;
        final String contentType;
        final String wafAction;
        final String body;

        HttpResult(int statusCode, String contentType, String wafAction, String body) {
            this.statusCode = statusCode;
            this.contentType = contentType;
            this.wafAction = wafAction;
            this.body = body == null ? "" : body;
        }
    }

    private static class PlatformSearchOutcome {
        final List<JSONObject> products;
        final String error;

        PlatformSearchOutcome(List<JSONObject> products, String error) {
            this.products = products == null ? Collections.emptyList() : products;
            this.error = error;
        }

        static PlatformSearchOutcome success(List<JSONObject> products) {
            return new PlatformSearchOutcome(products, null);
        }

        static PlatformSearchOutcome error(String error) {
            return new PlatformSearchOutcome(Collections.emptyList(), error);
        }
    }

    private static class DeviceSearchJob {
        final String jobId;
        final String query;
        final Double lat;
        final Double lon;
        final List<String> platforms;
        final int totalPlatforms;
        final Map<String, String> platformStatus;
        final List<JSONObject> results;
        final long createdAt;
        volatile int resolved;
        volatile String status;
        volatile String error;
        volatile boolean cancelled;

        DeviceSearchJob(String jobId, String query, Double lat, Double lon, List<String> platforms) {
            this.jobId = jobId;
            this.query = query;
            this.lat = lat;
            this.lon = lon;
            this.platforms = new ArrayList<>(platforms);
            this.totalPlatforms = this.platforms.size();
            this.platformStatus = Collections.synchronizedMap(new LinkedHashMap<>());
            this.results = Collections.synchronizedList(new ArrayList<>());
            this.createdAt = System.currentTimeMillis();
            this.resolved = 0;
            this.status = "queued";
            this.error = null;
            this.cancelled = false;

            for (String platform : this.platforms) {
                this.platformStatus.put(platform, "pending");
            }
        }
    }
}
