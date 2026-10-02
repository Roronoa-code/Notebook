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
        versionCode = 81
        versionName = "0.23.3"
        // Only the processor types phones and the emulator use, to keep the picture model's runtime small.
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }

    // The phone's picture model (PhoneVision) is read in place from the app, so it must stay uncompressed.
    androidResources { noCompress += "onnx" }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// The picture model is the PC's (CLIP ViT-L/14, its 8-bit form) from Notebook Tools (NOTEBOOK_TOOLS, else
// D:/Notebook Tools), copied in at build time so the 300 MB file never sits in the project. Without it the app
// builds and works as before (For you just doesn't look at the pictures).
val notebookTools = System.getenv("NOTEBOOK_TOOLS") ?: "D:/Notebook Tools"
val pictureModel = file("$notebookTools/models/Xenova/clip-vit-large-patch14/onnx/vision_model_quantized.onnx")
val modelAssets = layout.buildDirectory.dir("modelAssets").get().asFile
val copyPictureModel by tasks.registering(Copy::class) {
    from(pictureModel) { rename { "clip-vision.onnx" } }
    into(File(modelAssets, "models"))
}
android.sourceSets["main"].assets.srcDir(modelAssets)
tasks.named("preBuild") { dependsOn(copyPictureModel) }

dependencies {
    // Google's QR scanner (runs inside Google Play services; no camera permission needed).
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    // Runs the picture model on the phone, offline.
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.30.0")
}
