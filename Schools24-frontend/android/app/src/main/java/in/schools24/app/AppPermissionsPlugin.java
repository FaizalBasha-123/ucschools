package in.schools24.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "AppPermissions",
    permissions = {
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        )
    }
)
public class AppPermissionsPlugin extends Plugin {

    @PluginMethod
    public void checkStartupPermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("backgroundLocation", getBackgroundLocationState());
        // Backward-compatible field for older web bundles; no runtime SMS prompt.
        result.put("sms", "granted");
        call.resolve(result);
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject result = new JSObject();
            result.put("backgroundLocation", "granted");
            call.resolve(result);
            return;
        }

        if (getPermissionState("backgroundLocation") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("backgroundLocation", "granted");
            call.resolve(result);
            return;
        }

        requestPermissionForAlias("backgroundLocation", call, "backgroundLocationPermsCallback");
    }

    @PluginMethod
    public void requestSmsPermissions(PluginCall call) {
        // Intentionally no-op to avoid asking users for SMS access.
        JSObject result = new JSObject();
        result.put("sms", "granted");
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", getContext().getPackageName(), null);
            intent.setData(uri);
            launchIntent(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Unable to open app settings", ex);
        }
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            launchIntent(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Unable to open location settings", ex);
        }
    }

    @PluginMethod
    public void promptEnableLocationServices(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ shows an in-app panel (like Google Maps) to toggle GPS.
                intent = new Intent("android.settings.panel.action.LOCATION");
            } else {
                // Older Android: open the location source settings page directly.
                intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            }
            launchIntent(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Unable to prompt for location services", ex);
        }
    }

    /**
     * Launches an intent using the Activity context when available (preferred —
     * no FLAG_ACTIVITY_NEW_TASK required), falling back to Application context
     * with FLAG_ACTIVITY_NEW_TASK for headless/detached situations.
     */
    private void launchIntent(Intent intent) {
        android.app.Activity activity = getActivity();
        if (activity != null) {
            activity.startActivity(intent);
        } else {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
    }

    @PermissionCallback
    private void backgroundLocationPermsCallback(PluginCall call) {
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("backgroundLocation", getBackgroundLocationState());
        call.resolve(result);
    }

    private String getBackgroundLocationState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return "granted";
        }
        return getPermissionState("backgroundLocation").toString().toLowerCase();
    }
}
