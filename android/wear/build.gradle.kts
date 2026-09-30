plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    // Gleiche App-ID wie die Handy-App: nur dann dürfen Uhr und Handy miteinander reden (Wear OS Data Layer)
    namespace = "de.damian.zweitesgehirn.wear"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.damian.zweitesgehirn"
        minSdk = 30
        targetSdk = 34
        versionCode = buildNumber
        versionName = "1.$buildNumber"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }

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
        getByName("debug") { if (hasKey) signingConfig = signingConfigs.getByName("zg") }
        getByName("release") { isMinifyEnabled = false; if (hasKey) signingConfig = signingConfigs.getByName("zg") }
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
    implementation("com.google.android.gms:play-services-wearable:18.2.0")
    implementation("androidx.wear:wear-input:1.1.0")
    implementation("androidx.wear.tiles:tiles:1.4.1")
    implementation("androidx.wear.protolayout:protolayout:1.2.1")
    implementation("com.google.guava:guava:33.3.1-android")
}
