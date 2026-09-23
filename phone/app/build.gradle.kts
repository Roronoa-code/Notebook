plugins {
    id("com.android.application")
}

android {
    namespace = "com.mani.notebook"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.mani.notebook"
        minSdk = 28
        targetSdk = 37
        versionCode = 20
        versionName = "0.8"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Google's QR scanner (runs inside Google Play services; no camera permission needed).
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}
