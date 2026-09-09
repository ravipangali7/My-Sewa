package com.infelogroup.mysewa

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterFragmentActivity() {
    private var cameraPermissionResult: MethodChannel.Result? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NotificationChannels.ensureAll(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        NotificationChannels.ensureAll(this)

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
            DOWNLOADS_CHANNEL,
        ).setMethodCallHandler { call, result ->
            if (call.method != "saveToDownloads") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            try {
                val filename = call.argument<String>("filename") ?: "mysewa-file"
                val mime = call.argument<String>("mime") ?: "application/octet-stream"
                val bytes = readChannelBytes(call.argument("bytes"))
                    ?: throw IllegalArgumentException("File bytes are missing.")
                result.success(saveToPublicDownloads(filename, mime, bytes))
            } catch (error: Exception) {
                result.error("save_failed", error.message, null)
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

    @Suppress("UNCHECKED_CAST")
    private fun readChannelBytes(raw: Any?): ByteArray? {
        return when (raw) {
            is ByteArray -> raw
            is List<*> -> {
                val out = ByteArray(raw.size)
                for (i in raw.indices) {
                    val item = raw[i] ?: return null
                    out[i] = (item as Number).toByte()
                }
                out
            }
            else -> null
        }
    }

    private fun saveToPublicDownloads(filename: String, mime: String, bytes: ByteArray): String {
        val safeName = filename.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "mysewa-file" }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                put(MediaStore.Downloads.IS_PENDING, 1)
                put(
                    MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/MySewa",
                )
            }
            val uri = contentResolver.insert(
                MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                values,
            ) ?: throw IllegalStateException("Could not create a Downloads entry.")
            contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(bytes)
                stream.flush()
            } ?: throw IllegalStateException("Could not write the downloaded file.")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            contentResolver.update(uri, values, null, null)
            return "Downloads/MySewa/$safeName"
        }

        val dir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "MySewa",
        )
        if (!dir.exists() && !dir.mkdirs()) {
            throw IllegalStateException("Could not create the Downloads folder.")
        }
        val file = uniqueFile(dir, safeName)
        file.writeBytes(bytes)
        MediaScannerConnection.scanFile(this, arrayOf(file.absolutePath), arrayOf(mime), null)
        return file.absolutePath
    }

    private fun uniqueFile(dir: File, name: String): File {
        val candidate = File(dir, name)
        if (!candidate.exists()) return candidate
        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var index = 1
        while (File(dir, "$base ($index)$ext").exists()) {
            index += 1
        }
        return File(dir, "$base ($index)$ext")
    }

    companion object {
        private const val SESSION_CHANNEL = "com.mysewa.app/session_lifecycle"
        private const val UPDATE_CHANNEL = "com.mysewa.app/app_update"
        private const val DOWNLOADS_CHANNEL = "com.mysewa.app/downloads"
        private const val MARKER_NAME = "install_session_v1"
        private const val CAMERA_REQ = 48101
    }
}
