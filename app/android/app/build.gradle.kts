import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services")
}

// Load keystore properties (android/key.properties)
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
check(keystorePropertiesFile.exists()) {
    "Missing ${keystorePropertiesFile.absolutePath}. Release builds must use the production keystore."
}
keystoreProperties.load(FileInputStream(keystorePropertiesFile))

fun resolveKeystoreFile(rawPath: String): File {
    val candidates = listOf(
        file(rawPath),
        rootProject.file(rawPath),
        rootProject.file("app/$rawPath"),
    )
    return candidates.firstOrNull { it.isFile }
        ?: error(
            "Keystore not found for storeFile='$rawPath'. Checked: " +
                candidates.joinToString { it.absolutePath },
        )
}

val releaseStoreFile = resolveKeystoreFile(
    keystoreProperties.getProperty("storeFile")
        ?: error("key.properties is missing storeFile"),
)
val releaseStorePassword = keystoreProperties.getProperty("storePassword")
    ?: error("key.properties is missing storePassword")
val releaseKeyAlias = keystoreProperties.getProperty("keyAlias")
    ?: error("key.properties is missing keyAlias")
val releaseKeyPassword = keystoreProperties.getProperty("keyPassword")
    ?: error("key.properties is missing keyPassword")

// Optional APK Signature Scheme v3 lineage (debug → release) so devices that
// originally installed a debug-signed MySewa can update without uninstalling.
val signingLineageFile = rootProject.file("signing/mysewa-debug-to-release.lineage")
val debugKeystoreFile = File(System.getProperty("user.home"), ".android/debug.keystore")

android {
    namespace = "com.infelogroup.mysewa"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.infelogroup.mysewa"

        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion

        // Keep in sync with pubspec.yaml (and AppConstant.appVersion / Settings.app_version).
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            storeFile = releaseStoreFile
            storePassword = releaseStorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
            enableV4Signing = true
        }
    }

    buildTypes {
        release {
            // NEVER fall back to debug signing — that causes
            // "App not installed as package conflicts with an existing package"
            // when updating over a differently-signed install.
            signingConfig = signingConfigs.getByName("release")
            isDebuggable = false
            isMinifyEnabled = false
            isShrinkResources = false
            ndk {
                // Do not embed full DWARF in the APK (keeps size ~50MB, not ~500MB).
                debugSymbolLevel = "NONE"
            }
        }
        debug {
            applicationIdSuffix = ""
            isDebuggable = true
            // Keep debug installs on the same applicationId for development,
            // but they cannot be updated by release APKs without the v3 lineage.
        }
    }

    // Strip debug symbols normally. keepDebugSymbols was making the APK ~500MB.
    // Corrupted libflutter.so strip failures come from OOM-interrupted builds —
    // always `flutter clean` (or delete build/) after a daemon crash.
    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(
            org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
        )
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    implementation("androidx.core:core-ktx:1.15.0")
}

fun findApksigner(): File {
    val fromSdk = System.getenv("ANDROID_HOME")?.let { home ->
        File(home, "build-tools").listFiles()
            ?.sortedByDescending { it.name }
            ?.map { File(it, if (System.getProperty("os.name").lowercase().contains("windows")) "apksigner.bat" else "apksigner") }
            ?.firstOrNull { it.isFile }
    }
    if (fromSdk != null) return fromSdk

    val local = File(System.getProperty("user.home"), "AppData/Local/Android/Sdk/build-tools")
    val fromLocal = local.listFiles()
        ?.sortedByDescending { it.name }
        ?.map { File(it, "apksigner.bat") }
        ?.firstOrNull { it.isFile }
    if (fromLocal != null) return fromLocal

    error("apksigner not found. Install Android SDK build-tools.")
}

/**
 * Re-sign the release APK with the production keystore + debug→release lineage.
 * This lets phones that still have a debug-signed MySewa install the update
 * in-place (preserving data) instead of failing with a package conflict.
 */
tasks.register("resignReleaseWithLineage") {
    group = "build"
    description = "Re-sign release APK with production key + v3 signing lineage"
    doLast {
        if (!signingLineageFile.isFile) {
            logger.warn(
                "Signing lineage missing at ${signingLineageFile.absolutePath}; " +
                    "skipping lineage resign (release keystore signature only).",
            )
            return@doLast
        }

        val buildDirFile = layout.buildDirectory.get().asFile
        val candidates = listOf(
            File(buildDirFile, "outputs/apk/release/app-release.apk"),
            File(buildDirFile, "outputs/flutter-apk/app-release.apk"),
            rootProject.file("../build/app/outputs/flutter-apk/app-release.apk"),
            rootProject.file("../build/app/outputs/apk/release/app-release.apk"),
        )
        val existing = candidates.filter { it.isFile }
        check(existing.isNotEmpty()) {
            "Release APK not found. Run assembleRelease / flutter build apk first."
        }

        val apksigner = findApksigner()
        for (apk in existing) {
            val signedTmp = File(apk.parentFile, "app-release-lineage-signed.apk")
            if (signedTmp.exists()) signedTmp.delete()

            check(debugKeystoreFile.isFile) {
                "Debug keystore required for lineage resign not found: ${debugKeystoreFile.absolutePath}"
            }
            logger.lifecycle(
                "Re-signing ${apk.absolutePath} with production key + debug→release lineage…",
            )
            val process = ProcessBuilder(
                apksigner.absolutePath,
                "sign",
                // Oldest signer first (debug) so v1/v2 schemes keep working on older installs.
                "--ks", debugKeystoreFile.absolutePath,
                "--ks-key-alias", "androiddebugkey",
                "--ks-pass", "pass:android",
                "--key-pass", "pass:android",
                "--next-signer",
                "--ks", releaseStoreFile.absolutePath,
                "--ks-key-alias", releaseKeyAlias,
                "--ks-pass", "pass:$releaseStorePassword",
                "--key-pass", "pass:$releaseKeyPassword",
                "--lineage", signingLineageFile.absolutePath,
                "--v1-signing-enabled", "true",
                "--v2-signing-enabled", "true",
                "--v3-signing-enabled", "true",
                "--out", signedTmp.absolutePath,
                apk.absolutePath,
            )
                .redirectErrorStream(true)
                .start()
            val output = process.inputStream.bufferedReader().readText()
            val code = process.waitFor()
            check(code == 0) {
                "apksigner lineage resign failed ($code): $output"
            }
            check(signedTmp.isFile) { "apksigner did not produce ${signedTmp.absolutePath}" }
            signedTmp.copyTo(apk, overwrite = true)
            signedTmp.delete()
            logger.lifecycle("Resigned: ${apk.absolutePath}")
        }
    }
}
