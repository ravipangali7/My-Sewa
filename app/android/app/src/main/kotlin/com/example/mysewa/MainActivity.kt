package com.example.mysewa

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.core.content.FileProvider
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

        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            UPDATE_CHANNEL,
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "installApk" -> {
                    val path = call.argument<String>("path")
                    if (path.isNullOrBlank()) {
                        result.error("invalid_path", "APK path is required", null)
                        return@setMethodCallHandler
                    }
                    try {
                        result.success(installApk(path))
                    } catch (error: Exception) {
                        result.error("install_failed", error.message, null)
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

    /**
     * Opens the system package installer for [path].
     * On Android 8+, prompts the user to allow unknown-app installs first
     * when that permission is missing.
     *
     * @return true when the installer intent was launched
     */
    private fun installApk(path: String): Boolean {
        val file = File(path)
        if (!file.exists() || !file.isFile) {
            throw IllegalArgumentException("APK file not found")
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            val settingsIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:$packageName"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(settingsIntent)
            return false
        }

        val uri = FileProvider.getUriForFile(
            this,
            "$packageName.fileprovider",
            file,
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
        return true
    }

    companion object {
        private const val SESSION_CHANNEL = "com.mysewa.app/session_lifecycle"
        private const val UPDATE_CHANNEL = "com.mysewa.app/app_update"
        private const val MARKER_NAME = "install_session_v1"
    }
}
