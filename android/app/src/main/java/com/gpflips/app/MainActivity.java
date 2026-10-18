package com.gpflips.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Goldstone's own native plugins (not from npm) — register before the bridge starts.
        registerPlugin(TextComposePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
