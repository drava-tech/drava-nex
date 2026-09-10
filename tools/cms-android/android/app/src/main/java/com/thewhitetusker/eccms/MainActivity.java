package com.thewhitetusker.eccms;

import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Capacitor 8 ships no native back handling at all — it forwards the
        // press to the JS App plugin's `backButton` listener, and that bridge
        // is never injected here because server.url points at a remote origin.
        // Without this, Back quits the app from any page in the CMS.
        //
        // Registered on the OnBackPressedDispatcher rather than by overriding
        // onBackPressed(): this app targets SDK 36, where predictive back is on
        // by default and onBackPressed() is no longer called.
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        WebView webView = getBridge().getWebView();
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            // Nothing left in history — hand the press back to
                            // the system so it closes the app as usual.
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    }
                }
            );
    }
}
