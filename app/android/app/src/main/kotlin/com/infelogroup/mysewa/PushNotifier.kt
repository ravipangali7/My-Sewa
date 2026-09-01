package com.infelogroup.mysewa

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.RemoteMessage

/**
 * Posts a heads-up notification with sound. Used from the native FCM
 * receiver so alerts appear even when Dart/Flutter is paused or killed.
 */
object PushNotifier {
    fun show(context: Context, message: RemoteMessage) {
        NotificationChannels.ensureAll(context)

        val data = message.data
        val title = (
            message.notification?.title
                ?: data["title"]
                ?: ""
            ).trim()
        val body = (
            message.notification?.body
                ?: data["body"]
                ?: ""
            ).trim()
        if (title.isEmpty() && body.isEmpty()) return

        val id = notificationId(data["message_id"] ?: message.messageId)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent(context, MainActivity::class.java)
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        launch.putExtra("event", data["event"] ?: "")
        launch.putExtra("thread_id", data["thread_id"] ?: "")

        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_IMMUTABLE
            } else {
                0
            }
        val pending = PendingIntent.getActivity(context, id, launch, pendingFlags)
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val builder = NotificationCompat.Builder(context, NotificationChannels.MESSAGE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(if (title.isEmpty()) "MySewa" else title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setSound(sound)
            .setVibrate(longArrayOf(0, 250, 200, 250))
            .setContentIntent(pending)
            .setTicker(body.ifEmpty { title })

        try {
            NotificationManagerCompat.from(context).notify("mysewa", id, builder.build())
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted yet — nothing else we can do here.
        }
    }

    private fun notificationId(raw: String?): Int {
        val parsed = raw?.toIntOrNull()
        if (parsed != null && parsed > 0) return parsed and 0x7fffffff
        val hashed = (raw ?: System.currentTimeMillis().toString()).hashCode() and 0x7fffffff
        return if (hashed == 0) (System.currentTimeMillis() % 100000).toInt() else hashed
    }
}
