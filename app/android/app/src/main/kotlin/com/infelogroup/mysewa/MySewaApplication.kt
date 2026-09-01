package com.infelogroup.mysewa

import android.app.Application

class MySewaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationChannels.ensureAll(this)
    }
}
