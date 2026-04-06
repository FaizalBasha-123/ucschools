package in.schools24.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class DriverTrackingService extends Service implements LocationListener {

    public static final String ACTION_START = "in.schools24.app.action.START_DRIVER_TRACKING";
    public static final String ACTION_STOP = "in.schools24.app.action.STOP_DRIVER_TRACKING";
    public static final String EXTRA_API_BASE_URL = "api_base_url";
    public static final String EXTRA_WS_BASE_URL = "ws_base_url";
    public static final String EXTRA_ACCESS_TOKEN = "access_token";
    public static final String EXTRA_REFRESH_TOKEN = "refresh_token";

    private static final String PREFS_NAME = "schools24_driver_tracking";
    private static final String PREF_ENABLED = "enabled";
    private static final String PREF_API_BASE_URL = "api_base_url";
    private static final String PREF_WS_BASE_URL = "ws_base_url";
    private static final String PREF_ACCESS_TOKEN = "access_token";
    private static final String PREF_REFRESH_TOKEN = "refresh_token";
    private static final String PREF_STATUS_MESSAGE = "status_message";
    private static final String PREF_STATUS_ALLOWED = "status_allowed";
    private static final String PREF_STATUS_WS_CONNECTED = "status_ws_connected";
    private static final String PREF_STATUS_GPS_ACTIVE = "status_gps_active";
    private static final String PREF_STATUS_LAST_PING_AT = "status_last_ping_at";
    private static final String PREF_STATUS_LAST_LAT = "status_last_lat";
    private static final String PREF_STATUS_LAST_LNG = "status_last_lng";

    private static final String CHANNEL_ID = "schools24_driver_tracking";
    private static final int NOTIFICATION_ID = 2401;
    private static final long SESSION_POLL_INTERVAL_SEC = 15;
    private static final long HEARTBEAT_INTERVAL_SEC = 5;
    private static final long HEARTBEAT_STALE_MS = 120_000;
    private static final float MIN_DISTANCE_METERS = 0f;
    private static final long MIN_LOCATION_INTERVAL_MS = 5_000L;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final Object stateLock = new Object();

    private SharedPreferences prefs;
    private ScheduledExecutorService executor;
    private OkHttpClient httpClient;
    private LocationManager locationManager;
    private WebSocket webSocket;

    private String apiBaseUrl = "";
    private String wsBaseUrl = "";
    private String accessToken = "";
    private String refreshToken = "";

    private boolean sessionTrackingAllowed = false;
    private boolean websocketConnected = false;
    private boolean gpsUpdatesActive = false;
    private long lastPingAt = 0L;
    private double lastLatitude = Double.NaN;
    private double lastLongitude = Double.NaN;
    private long lastGpsFixAt = 0L;
    private boolean stopRequested = false;

    public static Intent buildStartIntent(Context context, String apiBaseUrl, String wsBaseUrl, String accessToken, String refreshToken) {
        Intent intent = new Intent(context, DriverTrackingService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_API_BASE_URL, apiBaseUrl);
        intent.putExtra(EXTRA_WS_BASE_URL, wsBaseUrl);
        intent.putExtra(EXTRA_ACCESS_TOKEN, accessToken);
        intent.putExtra(EXTRA_REFRESH_TOKEN, refreshToken);
        return intent;
    }

    public static Intent buildStopIntent(Context context) {
        Intent intent = new Intent(context, DriverTrackingService.class);
        intent.setAction(ACTION_STOP);
        return intent;
    }

    public static JSObject buildStatusPayload(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        JSObject status = new JSObject();
        status.put("serviceEnabled", prefs.getBoolean(PREF_ENABLED, false));
        status.put("trackingAllowed", prefs.getBoolean(PREF_STATUS_ALLOWED, false));
        status.put("websocketConnected", prefs.getBoolean(PREF_STATUS_WS_CONNECTED, false));
        status.put("gpsActive", prefs.getBoolean(PREF_STATUS_GPS_ACTIVE, false));
        status.put("lastPingAt", prefs.getLong(PREF_STATUS_LAST_PING_AT, 0L));
        if (prefs.contains(PREF_STATUS_LAST_LAT)) {
            status.put("lastLatitude", Double.longBitsToDouble(prefs.getLong(PREF_STATUS_LAST_LAT, 0L)));
        }
        if (prefs.contains(PREF_STATUS_LAST_LNG)) {
            status.put("lastLongitude", Double.longBitsToDouble(prefs.getLong(PREF_STATUS_LAST_LNG, 0L)));
        }
        status.put("message", prefs.getString(PREF_STATUS_MESSAGE, "Driver service offline"));
        return status;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        executor = Executors.newSingleThreadScheduledExecutor();
        httpClient = new OkHttpClient.Builder()
                .retryOnConnectionFailure(true)
                .build();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification("Schools24 is preparing driver connectivity."));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopRequested = true;
            disableService("Driver background service stopped.");
            stopSelf();
            return START_NOT_STICKY;
        }
        stopRequested = false;

        if (intent != null) {
            String nextApiBaseUrl = trimTrailingSlash(intent.getStringExtra(EXTRA_API_BASE_URL));
            String nextWsBaseUrl = trimTrailingSlash(intent.getStringExtra(EXTRA_WS_BASE_URL));
            String nextAccessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN);
            String nextRefreshToken = intent.getStringExtra(EXTRA_REFRESH_TOKEN);
            if (!TextUtils.isEmpty(nextApiBaseUrl)) apiBaseUrl = nextApiBaseUrl;
            if (!TextUtils.isEmpty(nextWsBaseUrl)) wsBaseUrl = nextWsBaseUrl;
            if (!TextUtils.isEmpty(nextAccessToken)) accessToken = nextAccessToken;
            if (nextRefreshToken != null) refreshToken = nextRefreshToken;
        }

        if (TextUtils.isEmpty(apiBaseUrl)) apiBaseUrl = prefs.getString(PREF_API_BASE_URL, "");
        if (TextUtils.isEmpty(wsBaseUrl)) wsBaseUrl = prefs.getString(PREF_WS_BASE_URL, "");
        if (TextUtils.isEmpty(accessToken)) accessToken = prefs.getString(PREF_ACCESS_TOKEN, "");
        if (TextUtils.isEmpty(refreshToken)) refreshToken = prefs.getString(PREF_REFRESH_TOKEN, "");

        prefs.edit()
                .putBoolean(PREF_ENABLED, true)
                .putString(PREF_API_BASE_URL, apiBaseUrl)
                .putString(PREF_WS_BASE_URL, wsBaseUrl)
                .putString(PREF_ACCESS_TOKEN, accessToken)
                .putString(PREF_REFRESH_TOKEN, refreshToken)
                .apply();

        updateStatus("Driver service is online and waiting for school tracking windows.", false, websocketConnected, gpsUpdatesActive);
        scheduleLoops();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        tearDownTracking();
        if (!stopRequested && prefs != null && prefs.getBoolean(PREF_ENABLED, false)) {
            scheduleSelfRestart("Service restarted automatically to keep driver tracking reliable.");
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (!stopRequested && prefs != null && prefs.getBoolean(PREF_ENABLED, false)) {
            scheduleSelfRestart("Service restarted after app task removal.");
        }
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void scheduleLoops() {
        if (executor == null || executor.isShutdown()) return;
        executor.shutdownNow();
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::pollSessionStateSafely, 0, SESSION_POLL_INTERVAL_SEC, TimeUnit.SECONDS);
        executor.scheduleWithFixedDelay(this::sendHeartbeatSafely, HEARTBEAT_INTERVAL_SEC, HEARTBEAT_INTERVAL_SEC, TimeUnit.SECONDS);
    }

    private void pollSessionStateSafely() {
        try {
            pollSessionState();
        } catch (Exception ex) {
            updateStatus("Driver service is waiting for the backend to respond.", sessionTrackingAllowed, websocketConnected, gpsUpdatesActive);
        }
    }

    private void sendHeartbeatSafely() {
        try {
            sendHeartbeat();
        } catch (Exception ignored) {
        }
    }

    private void pollSessionState() throws IOException, JSONException {
        if (TextUtils.isEmpty(apiBaseUrl) || TextUtils.isEmpty(accessToken)) {
            updateStatus("Driver service is waiting for driver authentication.", false, false, false);
            return;
        }

        JSONObject session = authorizedGetJson(apiBaseUrl + "/transport/session-status");
        boolean trackingAllowed = session.optBoolean("tracking_allowed", false);
        synchronized (stateLock) {
            sessionTrackingAllowed = trackingAllowed;
        }

        if (!trackingAllowed) {
            pauseLiveTracking("Schools24 is connected. GPS stays off until the school enables tracking.");
            return;
        }

        if (!hasLocationPermission()) {
            pauseLiveTracking("Location permission is required before live tracking can start.");
            return;
        }

        if (!isLocationEnabled()) {
            pauseLiveTracking("Turn on device location services so driver tracking can go live.");
            return;
        }

        ensureWebSocketConnected();
        ensureLocationUpdates();
        updateStatus("Tracking is live. Android is keeping the driver connection active.", true, websocketConnected, gpsUpdatesActive);
    }

    private void ensureWebSocketConnected() throws IOException, JSONException {
        synchronized (stateLock) {
            if (webSocket != null && websocketConnected) {
                return;
            }
        }

        JSONObject ticketPayload = authorizedGetJson(apiBaseUrl + "/auth/ws-ticket?scope=driver_tracking");
        String ticket = ticketPayload.optString("ticket", "");
        if (TextUtils.isEmpty(ticket) || TextUtils.isEmpty(wsBaseUrl)) {
            throw new IOException("driver ws ticket unavailable");
        }

        Request request = new Request.Builder()
                .url(trimTrailingSlash(wsBaseUrl) + "/api/v1/transport/driver/ws?ticket=" + ticket)
                .build();

        synchronized (stateLock) {
            if (webSocket != null) {
                webSocket.cancel();
            }
            websocketConnected = false;
            webSocket = httpClient.newWebSocket(request, new WebSocketListener() {
                @Override
                public void onOpen(WebSocket webSocket, Response response) {
                    synchronized (stateLock) {
                        websocketConnected = true;
                    }
                    updateStatus("Tracking socket is connected.", sessionTrackingAllowed, true, gpsUpdatesActive);
                }

                @Override
                public void onClosed(WebSocket webSocket, int code, String reason) {
                    synchronized (stateLock) {
                        websocketConnected = false;
                    }
                    updateStatus("Tracking socket closed. Android will reconnect automatically.", sessionTrackingAllowed, false, gpsUpdatesActive);
                }

                @Override
                public void onFailure(WebSocket webSocket, Throwable t, @Nullable Response response) {
                    synchronized (stateLock) {
                        websocketConnected = false;
                    }
                    updateStatus("Tracking socket dropped. Android will retry quietly.", sessionTrackingAllowed, false, gpsUpdatesActive);
                }
            });
        }
    }

    private void ensureLocationUpdates() {
        if (gpsUpdatesActive || locationManager == null || !hasLocationPermission()) {
            return;
        }

        boolean registered = false;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        MIN_LOCATION_INTERVAL_MS,
                        MIN_DISTANCE_METERS,
                        this,
                        Looper.getMainLooper()
                );
                registered = true;
            }
        } catch (SecurityException ignored) {
        }

        try {
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        MIN_LOCATION_INTERVAL_MS,
                        MIN_DISTANCE_METERS,
                        this,
                        Looper.getMainLooper()
                );
                registered = true;
            }
        } catch (SecurityException ignored) {
        }

        gpsUpdatesActive = registered;
        updateStatus(
                registered
                        ? "Location updates are active in Android foreground service."
                        : "No location provider is currently available for driver tracking.",
                sessionTrackingAllowed,
                websocketConnected,
                gpsUpdatesActive
        );
    }

    private void pauseLiveTracking(String message) {
        stopLocationUpdates();
        closeSocket();
        updateStatus(message, false, false, false);
    }

    private void stopLocationUpdates() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (SecurityException ignored) {
            }
        }
        gpsUpdatesActive = false;
    }

    private void closeSocket() {
        synchronized (stateLock) {
            if (webSocket != null) {
                try {
                    webSocket.close(1000, "paused");
                } catch (Exception ignored) {
                }
                webSocket = null;
            }
            websocketConnected = false;
        }
    }

    private void tearDownTracking() {
        stopLocationUpdates();
        closeSocket();
    }

    private void disableService(String message) {
        prefs.edit()
                .putBoolean(PREF_ENABLED, false)
                .putBoolean(PREF_STATUS_ALLOWED, false)
                .putBoolean(PREF_STATUS_WS_CONNECTED, false)
                .putBoolean(PREF_STATUS_GPS_ACTIVE, false)
                .putLong(PREF_STATUS_LAST_PING_AT, 0L)
                .putString(PREF_STATUS_MESSAGE, message)
                .apply();
        tearDownTracking();
    }

    private void scheduleSelfRestart(String statusMessage) {
        updateStatus(statusMessage, sessionTrackingAllowed, websocketConnected, gpsUpdatesActive);
        AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        Intent restartIntent = buildStartIntent(this, apiBaseUrl, wsBaseUrl, accessToken, refreshToken);
        PendingIntent pendingIntent = PendingIntent.getService(
                this,
                2402,
                restartIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        long triggerAt = System.currentTimeMillis() + 2000L;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
        }
    }

    private void sendHeartbeat() {
        if (!sessionTrackingAllowed || !websocketConnected) return;
        if (Double.isNaN(lastLatitude) || Double.isNaN(lastLongitude)) return;
        if (System.currentTimeMillis() - lastGpsFixAt > HEARTBEAT_STALE_MS) return;
        sendLocationPayload(lastLatitude, lastLongitude);
    }

    private void sendLocationPayload(double lat, double lng) {
        WebSocket socket;
        synchronized (stateLock) {
            socket = webSocket;
        }
        if (socket == null || !websocketConnected) return;

        JSONObject payload = new JSONObject();
        try {
            payload.put("lat", lat);
            payload.put("lng", lng);
        } catch (JSONException ignored) {
        }
        socket.send(payload.toString());
        lastPingAt = System.currentTimeMillis();
        persistLastLocation(lat, lng, lastPingAt);
        updateStatus("Live location is flowing from Android to the backend.", sessionTrackingAllowed, websocketConnected, gpsUpdatesActive);
    }

    private JSONObject authorizedGetJson(String url) throws IOException, JSONException {
        Response response = executeAuthorizedRequest(new Request.Builder().url(url).get().build(), false);
        if (response.body() == null) {
            throw new IOException("empty response body");
        }
        String body = response.body().string();
        response.close();
        return new JSONObject(body);
    }

    private Response executeAuthorizedRequest(Request request, boolean retryingAfterRefresh) throws IOException {
        Request authed = request.newBuilder()
                .header("Authorization", "Bearer " + accessToken)
                .build();
        Response response = httpClient.newCall(authed).execute();
        if (response.code() == 401 && !retryingAfterRefresh && refreshAccessToken()) {
            response.close();
            return executeAuthorizedRequest(request, true);
        }
        if (!response.isSuccessful()) {
            String body = response.body() != null ? response.body().string() : "";
            response.close();
            throw new IOException("request failed: " + request.url() + " status=" + body);
        }
        return response;
    }

    private boolean refreshAccessToken() {
        if (TextUtils.isEmpty(refreshToken) || TextUtils.isEmpty(apiBaseUrl)) {
            return false;
        }
        JSONObject body = new JSONObject();
        try {
            body.put("refresh_token", refreshToken);
        } catch (JSONException ignored) {
        }
        Request request = new Request.Builder()
                .url(apiBaseUrl + "/auth/refresh")
                .post(RequestBody.create(body.toString(), JSON))
                .header("Content-Type", "application/json")
                .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) return false;
            JSONObject payload = new JSONObject(response.body().string());
            String nextAccessToken = payload.optString("access_token", "");
            if (TextUtils.isEmpty(nextAccessToken)) return false;
            accessToken = nextAccessToken;
            String nextRefreshToken = payload.optString("refresh_token", "");
            if (!TextUtils.isEmpty(nextRefreshToken)) {
                refreshToken = nextRefreshToken;
            }
            prefs.edit()
                    .putString(PREF_ACCESS_TOKEN, accessToken)
                    .putString(PREF_REFRESH_TOKEN, refreshToken)
                    .apply();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isLocationEnabled() {
        if (locationManager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return locationManager.isLocationEnabled();
        }
        try {
            return Settings.Secure.getInt(getContentResolver(), Settings.Secure.LOCATION_MODE) != Settings.Secure.LOCATION_MODE_OFF;
        } catch (Settings.SettingNotFoundException ignored) {
            return false;
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        lastLatitude = location.getLatitude();
        lastLongitude = location.getLongitude();
        lastGpsFixAt = System.currentTimeMillis();
        if (sessionTrackingAllowed) {
            sendLocationPayload(lastLatitude, lastLongitude);
        } else {
            persistLastLocation(lastLatitude, lastLongitude, lastPingAt);
        }
    }

    @Override
    public void onProviderEnabled(String provider) {
        updateStatus("Location provider became available for driver tracking.", sessionTrackingAllowed, websocketConnected, gpsUpdatesActive);
    }

    @Override
    public void onProviderDisabled(String provider) {
        updateStatus("A location provider was turned off on this device.", sessionTrackingAllowed, websocketConnected, gpsUpdatesActive);
    }

    private void persistLastLocation(double lat, double lng, long pingAt) {
        prefs.edit()
                .putLong(PREF_STATUS_LAST_LAT, Double.doubleToRawLongBits(lat))
                .putLong(PREF_STATUS_LAST_LNG, Double.doubleToRawLongBits(lng))
                .putLong(PREF_STATUS_LAST_PING_AT, pingAt)
                .apply();
    }

    private void updateStatus(String message, boolean trackingAllowed, boolean wsConnected, boolean gpsActive) {
        prefs.edit()
                .putString(PREF_STATUS_MESSAGE, message)
                .putBoolean(PREF_STATUS_ALLOWED, trackingAllowed)
                .putBoolean(PREF_STATUS_WS_CONNECTED, wsConnected)
                .putBoolean(PREF_STATUS_GPS_ACTIVE, gpsActive)
                .putLong(PREF_STATUS_LAST_PING_AT, lastPingAt)
                .apply();
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(message));
        }
    }

    private Notification buildNotification(String message) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Schools24 Driver Service")
                .setContentText(message)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Driver Tracking Service",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps Schools24 driver connectivity active when the screen is off.");
        manager.createNotificationChannel(channel);
    }

    private String trimTrailingSlash(String value) {
        if (value == null) return "";
        return value.replaceAll("/+$", "");
    }
}
