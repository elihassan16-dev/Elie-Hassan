package com.gpflips.app;

// 📱 "Text from my phone" inside the Goldstone app (Elie 10/18/26): opens the
// phone's texting app with the number + message filled in. Android doesn't
// report whether it was sent, so this answers "opened".

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TextCompose")
public class TextComposePlugin extends Plugin {

    @PluginMethod
    public void canSend(PluginCall call) {
        JSObject r = new JSObject();
        r.put("value", true);
        call.resolve(r);
    }

    @PluginMethod
    public void compose(PluginCall call) {
        StringBuilder to = new StringBuilder();
        JSArray list = call.getArray("to");
        try {
            if (list != null) {
                for (int i = 0; i < list.length(); i++) {
                    if (to.length() > 0) to.append(';');
                    to.append(list.getString(i));
                }
            }
        } catch (Exception ignored) { }
        Intent it = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + to));
        it.putExtra("sms_body", call.getString("body", ""));
        try {
            getActivity().startActivity(it);
            JSObject r = new JSObject();
            r.put("result", "opened");
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No texting app found on this phone.");
        }
    }
}
