package in.schools24.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private View noInternetOverlay;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppPermissionsPlugin.class);
        registerPlugin(DriverTrackingBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // WebView security hardening
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings settings = getBridge().getWebView().getSettings();
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                settings.setSafeBrowsingEnabled(true);
            }
        }

        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);

        setupNoInternetOverlay();
        setupConnectivityMonitoring();
    }

    // ── Overlay setup ──────────────────────────────────────────────────────────

    private void setupNoInternetOverlay() {
        ViewGroup contentFrame = (ViewGroup) findViewById(android.R.id.content);
        if (contentFrame == null) return;

        noInternetOverlay = LayoutInflater.from(this)
                .inflate(R.layout.overlay_no_internet, contentFrame, false);
        noInternetOverlay.setVisibility(View.GONE);

        Button retryBtn = noInternetOverlay.findViewById(R.id.btnRetry);
        retryBtn.setOnClickListener(v -> {
            if (isNetworkAvailable()) {
                hideNoInternetOverlay();
                reloadWebView();
            }
            // If still offline the overlay stays — user sees it hasn't changed
        });

        contentFrame.addView(noInternetOverlay);
    }

    private void showNoInternetOverlay() {
        if (noInternetOverlay != null) {
            noInternetOverlay.setVisibility(View.VISIBLE);
            noInternetOverlay.bringToFront();
        }
    }

    private void hideNoInternetOverlay() {
        if (noInternetOverlay != null) {
            noInternetOverlay.setVisibility(View.GONE);
        }
    }

    // ── Connectivity monitoring ────────────────────────────────────────────────

    private void setupConnectivityMonitoring() {
        // Immediate check at launch
        if (!isNetworkAvailable()) {
            showNoInternetOverlay();
        }

        // Live monitoring: show/hide as network comes and goes
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                mainHandler.post(() -> {
                    hideNoInternetOverlay();
                    reloadWebView();
                });
            }

            @Override
            public void onLost(Network network) {
                mainHandler.post(() -> {
                    // Only show if truly offline (no remaining active network)
                    if (!isNetworkAvailable()) {
                        showNoInternetOverlay();
                    }
                });
            }
        };

        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
        connectivityManager.registerNetworkCallback(request, networkCallback);
    }

    private boolean isNetworkAvailable() {
        if (connectivityManager == null) return false;
        Network active = connectivityManager.getActiveNetwork();
        if (active == null) return false;
        NetworkCapabilities caps = connectivityManager.getNetworkCapabilities(active);
        return caps != null && (
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        );
    }

    private void reloadWebView() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().reload();
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    @Override
    public void onResume() {
        super.onResume();
        // Re-check when app comes to foreground (e.g. user toggled airplane mode)
        if (!isNetworkAvailable()) {
            showNoInternetOverlay();
        } else {
            hideNoInternetOverlay();
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) { }
        }
    }

    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            String currentUrl = getBridge().getWebView().getUrl();
            if (currentUrl != null && currentUrl.contains("/login")) {
                moveTaskToBack(true);
                return;
            }
        }
        super.onBackPressed();
    }
}
