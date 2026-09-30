plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "de.damian.zweitesgehirn"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.damian.zweitesgehirn"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.$buildNumber"
        // nur für moderne 64-Bit-Handys (z. B. Galaxy S26) -> viel kleinere Datei
        ndk { abiFilters += listOf("arm64-v8a") }
    }

    // Immer derselbe Schlüssel, damit sich neue Versionen einfach drüber installieren lassen.
    // Der Schlüssel liegt NICHT im Repository, sondern als verschlüsseltes GitHub-Secret
    // (ZG_KEYSTORE / ZG_KEYSTORE_PASSWORD) und wird nur beim Bauen kurz hergestellt.
    val keyFile = rootProject.file("zg.keystore")
    val keyPass = System.getenv("ZG_KEYSTORE_PASSWORD") ?: ""
    val hasKey = keyFile.exists() && keyPass.isNotEmpty()
    signingConfigs {
        create("zg") {
            storeFile = keyFile
            storePassword = keyPass
            keyAlias = "zg"
            keyPassword = keyPass
        }
    }
    buildTypes {
        getByName("debug") {
            if (hasKey) signingConfig = signingConfigs.getByName("zg")
        }
        getByName("release") {
            isMinifyEnabled = false
            if (hasKey) signingConfig = signingConfigs.getByName("zg")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
    implementation("com.google.android.gms:play-services-auth:21.2.0")
    // Orts-Erinnerungen (Geofencing) und aktueller Standort
    implementation("com.google.android.gms:play-services-location:21.3.0")
    // Smartwatch (Galaxy Watch / Wear OS): Nachrichten zwischen Uhr und Handy
    implementation("com.google.android.gms:play-services-wearable:18.2.0")
    // Android Auto (Jarvis-Bildschirm im Auto)
    implementation("androidx.car.app:app:1.4.0")
    // Handy-KI: Gemma 4 direkt auf dem Handy (LiteRT-LM, Nachfolger von MediaPipe LLM Inference)
    implementation("com.google.ai.edge.litertlm:litertlm-android:0.17.1")
}
// Build-Auslöser: 2
