package com.infelogroup.mysewa

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.provider.Settings

/**
 * Creates high-importance sounding channels as soon as the process starts
 * (including when FCM wakes a killed app). Channel importance cannot be
 * raised after the first create, so a dedicated messages channel is used.
 */
object NotificationChannels {
    const val ALERT_CHANNEL_ID = "mysewa_alerts"
    const val MESSAGE_CHANNEL_ID = "mysewa_messages"

    fun ensureAll(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            ?: Settings.System.DEFAULT_NOTIFICATION_URI
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        ensureChannel(
            manager,
            MESSAGE_CHANNEL_ID,
            "MySewa messages",
            "Support chat and important alerts",
            sound,
            attrs,
        )
        ensureChannel(
            manager,
            ALERT_CHANNEL_ID,
            "MySewa alerts",
            "Transaction and chat notifications",
            sound,
            attrs,
        )
    }

    private fun ensureChannel(
        manager: NotificationManager,
        id: String,
        name: String,
        description: String,
        sound: android.net.Uri,
        attrs: AudioAttributes,
    ) {
        val existing = manager.getNotificationChannel(id)
        if (existing != null && existing.importance < NotificationManager.IMPORTANCE_HIGH) {
            manager.deleteNotificationChannel(id)
        }
        val channel = manager.getNotificationChannel(id) ?: NotificationChannel(
            id,
            name,
            NotificationManager.IMPORTANCE_HIGH,
        )
        channel.description = description
        channel.enableVibration(true)
        channel.vibrationPattern = longArrayOf(0, 250, 200, 250)
        channel.enableLights(true)
        channel.setShowBadge(true)
        channel.setSound(sound, attrs)
        channel.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        manager.createNotificationChannel(channel)
    }
}
