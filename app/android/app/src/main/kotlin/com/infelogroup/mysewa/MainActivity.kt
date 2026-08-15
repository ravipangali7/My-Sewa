package com.infelogroup.mysewa

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    private var cameraPermissionResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        ensureDefaultNotificationChannel()

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
                "clearWebResourceCache" -> {
                    try {
                        clearWebResourceCache()
                        result.success(null)
                    } catch (error: Exception) {
                        result.error(
                            "cache_clear_failed",
                            error.message,
                            null,
                        )
                    }
                }
                "requestCameraPermission" -> requestCameraPermission(result)
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
                        result.error("invalid_path", "APK path is missing.", null)
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

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CAMERA_REQ) return
        val granted = grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        cameraPermissionResult?.success(granted)
        cameraPermissionResult = null
    }

    private fun requestCameraPermission(result: MethodChannel.Result) {
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            result.success(true)
            return
        }
        cameraPermissionResult?.success(false)
        cameraPermissionResult = result
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.CAMERA),
            CAMERA_REQ,
        )
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
     * Wipes HTTP / disk / service-worker caches so the embedded site always
     * loads the latest CSS/JS/HTML. Leaves cookies + localStorage intact.
     */
    private fun clearWebResourceCache() {
        try {
            WebView(applicationContext).apply {
                settings.cacheMode = WebSettings.LOAD_NO_CACHE
                clearCache(true)
                destroy()
            }
        } catch (_: Exception) {
            // WebView may be unavailable in some environments — fall through
            // to directory cleanup below.
        }

        val dataDir = applicationContext.dataDir
        val cacheRoots = listOf(
            File(cacheDir, "WebView"),
            File(cacheDir, "org.chromium.android_webview"),
            File(dataDir, "app_webview/Default/Cache"),
            File(dataDir, "app_webview/Default/Code Cache"),
            File(dataDir, "app_webview/Default/GPUCache"),
            File(dataDir, "app_webview/Default/Service Worker"),
            File(dataDir, "app_webview/Default/HTTP Cache"),
        )
        for (root in cacheRoots) {
            deleteRecursivelyQuiet(root)
        }
    }

    private fun deleteRecursivelyQuiet(file: File) {
        if (!file.exists()) return
        try {
            file.deleteRecursively()
        } catch (_: Exception) {
            // Best-effort cleanup; ignore locked / in-use files.
        }
    }

    private fun installApk(path: String): Boolean {
        val file = File(path)
        if (!file.exists()) {
            throw IllegalArgumentException("APK file was not found.")
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$packageName"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
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
        val resolvers = packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        for (resolve in resolvers) {
            grantUriPermission(
                resolve.activityInfo.packageName,
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        startActivity(intent)
        return true
    }

    private fun ensureDefaultNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(DEFAULT_CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            DEFAULT_CHANNEL_ID,
            "MySewa",
            NotificationManager.IMPORTANCE_HIGH,
        )
        channel.description = "App push notifications"
        channel.enableVibration(true)
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val SESSION_CHANNEL = "com.mysewa.app/session_lifecycle"
        private const val UPDATE_CHANNEL = "com.mysewa.app/app_update"
        private const val MARKER_NAME = "install_session_v1"
        private const val DEFAULT_CHANNEL_ID = "mysewa_default"
        private const val CAMERA_REQ = 48101
    }
}
