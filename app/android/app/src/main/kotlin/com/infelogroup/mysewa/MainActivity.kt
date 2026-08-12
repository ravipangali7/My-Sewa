package com.infelogroup.mysewa

import android.webkit.CookieManager
import android.webkit.WebStorage
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            SESSION_CHANNEL,
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "prepareFreshInstallSession" -> {
                    try {
                        result.success(prepareFreshInstallSession())
                    } catch (error: Exception) {
                        result.error(
                            "session_prep_failed",
                            error.message,
                            null,
                        )
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    /**
     * Detects a fresh install / clear-data launch using a marker in the
     * no-backup directory (not restored by Auto Backup). When the marker is
     * missing, wipe WebView cookies + HTML5 storage so a restored
     * `mysewa_token` cannot keep the user logged in.
     *
     * @return true when WebView auth storage was cleared
     */
    private fun prepareFreshInstallSession(): Boolean {
        val marker = File(applicationContext.noBackupFilesDir, MARKER_NAME)
        if (marker.exists()) {
            return false
        }

        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteAllData()

        marker.parentFile?.mkdirs()
        marker.writeText(System.currentTimeMillis().toString())
        return true
    }

    companion object {
        private const val SESSION_CHANNEL = "com.mysewa.app/session_lifecycle"
        private const val MARKER_NAME = "install_session_v1"
    }
}
