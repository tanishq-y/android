package com.flit.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private static final String JS_INTERFACE_NAME = "FlitNativeAndroid";
	private static final String BRIDGE_BOOTSTRAP_SCRIPT =
		"(function(){" +
		"if(!window.FlitNativeAndroid){return;}" +
		"window.FlitNativeApp={" +
		"__nativeReady:true," +
		"openPlatformLogin:function(platformId,loginUrl){" +
		"var raw=window.FlitNativeAndroid.openPlatformLogin(String(platformId||''),String(loginUrl||''));" +
		"try{return JSON.parse(raw);}catch(e){return {error:'invalid_native_response',raw:raw};}" +
		"}," +
		"exportPlatformSession:function(platformId){" +
		"return window.FlitNativeAndroid.exportPlatformSession(String(platformId||''));" +
		"}," +
		"startDeviceSearch:function(payload){" +
		"var raw=window.FlitNativeAndroid.startDeviceSearch(JSON.stringify(payload||{}));" +
		"try{return JSON.parse(raw);}catch(e){return {error:'invalid_native_response',raw:raw};}" +
		"}," +
		"getDeviceSearchStatus:function(jobId){" +
		"var raw=window.FlitNativeAndroid.getDeviceSearchStatus(String(jobId||''));" +
		"try{return JSON.parse(raw);}catch(e){return {error:'invalid_native_response',raw:raw};}" +
		"}," +
		"cancelDeviceSearch:function(jobId){" +
		"var raw=window.FlitNativeAndroid.cancelDeviceSearch(String(jobId||''));" +
		"try{return JSON.parse(raw);}catch(e){return {error:'invalid_native_response',raw:raw};}" +
		"}" +
		"};" +
		"})();";

	private boolean nativeInterfaceAttached = false;

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		installNativeBridge();
	}

	@Override
	public void onResume() {
		super.onResume();
		installNativeBridge();
	}

	private void installNativeBridge() {
		if (bridge == null) {
			return;
		}

		WebView webView = bridge.getWebView();
		if (webView == null) {
			return;
		}

		if (!nativeInterfaceAttached) {
			webView.addJavascriptInterface(new FlitNativeBridgeInterface(this), JS_INTERFACE_NAME);
			nativeInterfaceAttached = true;
		}

		// Allow secure WebView origin to call LAN HTTP backend during phone development.
		WebSettings settings = webView.getSettings();
		if (settings != null) {
			settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
		}

		webView.evaluateJavascript(BRIDGE_BOOTSTRAP_SCRIPT, null);
	}
}
