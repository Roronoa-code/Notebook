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
        versionCode = 1
        versionName = "0.1-preview"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
