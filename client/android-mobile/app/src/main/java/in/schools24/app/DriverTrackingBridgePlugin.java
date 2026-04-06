package in.schools24.app;

import android.content.Context;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DriverTrackingNative")
public class DriverTrackingBridgePlugin extends Plugin {

    @PluginMethod
    public void startService(PluginCall call) {
        String apiBaseUrl = call.getString("apiBaseUrl", "");
        String wsBaseUrl = call.getString("wsBaseUrl", "");
        String accessToken = call.getString("accessToken", "");
        String refreshToken = call.getString("refreshToken", "");

        if (apiBaseUrl.isEmpty() || wsBaseUrl.isEmpty() || accessToken.isEmpty()) {
            call.reject("apiBaseUrl, wsBaseUrl, and accessToken are required");
            return;
        }

        Context context = getContext();
        ContextCompat.startForegroundService(
                context,
                DriverTrackingService.buildStartIntent(context, apiBaseUrl, wsBaseUrl, accessToken, refreshToken)
        );
        JSObject result = DriverTrackingService.buildStatusPayload(context);
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Context context = getContext();
        context.startService(DriverTrackingService.buildStopIntent(context));
        JSObject result = DriverTrackingService.buildStatusPayload(context);
        result.put("stopped", true);
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(DriverTrackingService.buildStatusPayload(getContext()));
    }
}
