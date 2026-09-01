package com.infelogroup.mysewa

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.firebase.messaging.RemoteMessage

/**
 * Runs ahead of FlutterFire's C2DM receiver so a sounding notification is
 * posted in every process state (foreground, background, and killed).
 * Does not abort the broadcast — Flutter still receives the message.
 */
class MySewaFcmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val extras = intent?.extras ?: return
        try {
            PushNotifier.show(context, RemoteMessage(extras))
        } catch (_: Exception) {
            // Never crash the FCM delivery path.
        }
    }
}
