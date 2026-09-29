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

    // Immer derselbe Schlüssel, damit sich neue Versionen einfach drüber installieren lassen
    signingConfigs {
        create("zg") {
            storeFile = rootProject.file("zg.keystore")
            storePassword = "zweitesgehirn"
            keyAlias = "zg"
            keyPassword = "zweitesgehirn"
        }
    }
    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("zg")
        }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("zg")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
    implementation("com.google.android.gms:play-services-auth:21.2.0")
}
