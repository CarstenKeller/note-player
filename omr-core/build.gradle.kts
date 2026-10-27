plugins {
    kotlin("multiplatform")
}

kotlin {
    // the Android app uses the JVM variant
    jvm {
        testRuns["test"].executionTask.configure {
            useJUnitPlatform()
            systemProperty("java.awt.headless", "true")
        }
    }
    // the web app runs the recognition in the browser (in a web worker)
    js(IR) {
        moduleName = "omr-core"
        browser()
        useEsModules()
        binaries.library()
        generateTypeScriptDefinitions()
    }

    sourceSets {
        jvmTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile>().configureEach {
    compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
}

tasks.withType<JavaCompile>().configureEach {
    sourceCompatibility = "17"
    targetCompatibility = "17"
}
