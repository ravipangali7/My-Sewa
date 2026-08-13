import Flutter
import UIKit
import UserNotifications
import WebKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    application.registerForRemoteNotifications()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    let channel = FlutterMethodChannel(
      name: "com.mysewa.app/session_lifecycle",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "prepareFreshInstallSession":
        Self.prepareFreshInstallSession(result: result)
      case "clearWebResourceCache":
        Self.clearWebResourceCache(result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  /// Uses an Application Support marker (removed with uninstall / data wipe).
  /// When missing, clears WKWebView website data so auth tokens cannot survive.
  private static func prepareFreshInstallSession(result: @escaping FlutterResult) {
    let fileManager = FileManager.default
    guard
      let supportUrl = fileManager.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
      ).first
    else {
      result(
        FlutterError(
          code: "session_prep_failed",
          message: "Application Support directory unavailable",
          details: nil
        )
      )
      return
    }

    let markerDir = supportUrl.appendingPathComponent("mysewa", isDirectory: true)
    let markerUrl = markerDir.appendingPathComponent("install_session_v1")

    if fileManager.fileExists(atPath: markerUrl.path) {
      result(false)
      return
    }

    let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
    let epoch = Date(timeIntervalSince1970: 0)
    WKWebsiteDataStore.default().removeData(
      ofTypes: dataTypes,
      modifiedSince: epoch
    ) {
      do {
        try fileManager.createDirectory(
          at: markerDir,
          withIntermediateDirectories: true
        )
        try "\(Int(Date().timeIntervalSince1970 * 1000))".write(
          to: markerUrl,
          atomically: true,
          encoding: .utf8
        )
        result(true)
      } catch {
        result(
          FlutterError(
            code: "session_prep_failed",
            message: error.localizedDescription,
            details: nil
          )
        )
      }
    }
  }

  /// Clears HTTP / disk / service-worker caches without removing login storage.
  private static func clearWebResourceCache(result: @escaping FlutterResult) {
    var types: Set<String> = [
      WKWebsiteDataTypeDiskCache,
      WKWebsiteDataTypeMemoryCache,
      WKWebsiteDataTypeOfflineWebApplicationCache,
    ]
    types.insert(WKWebsiteDataTypeFetchCache)
    types.insert(WKWebsiteDataTypeServiceWorkerRegistrations)

    let epoch = Date(timeIntervalSince1970: 0)
    WKWebsiteDataStore.default().removeData(
      ofTypes: types,
      modifiedSince: epoch
    ) {
      result(nil)
    }
  }
}
