package in.schools24.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.text.TextUtils;

import androidx.core.content.ContextCompat;

public class DriverTrackingBootReceiver extends BroadcastReceiver {

    private static final String PREFS_NAME = "schools24_driver_tracking";
    private static final String PREF_ENABLED = "enabled";
    private static final String PREF_API_BASE_URL = "api_base_url";
    private static final String PREF_WS_BASE_URL = "ws_base_url";
    private static final String PREF_ACCESS_TOKEN = "access_token";
    private static final String PREF_REFRESH_TOKEN = "refresh_token";

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(PREF_ENABLED, false)) {
            return;
        }

        String apiBaseUrl = prefs.getString(PREF_API_BASE_URL, "");
        String wsBaseUrl = prefs.getString(PREF_WS_BASE_URL, "");
        String accessToken = prefs.getString(PREF_ACCESS_TOKEN, "");
        String refreshToken = prefs.getString(PREF_REFRESH_TOKEN, "");
        if (TextUtils.isEmpty(apiBaseUrl) || TextUtils.isEmpty(wsBaseUrl) || TextUtils.isEmpty(accessToken)) {
            return;
        }

        ContextCompat.startForegroundService(
                context,
                DriverTrackingService.buildStartIntent(context, apiBaseUrl, wsBaseUrl, accessToken, refreshToken)
        );
    }
}
