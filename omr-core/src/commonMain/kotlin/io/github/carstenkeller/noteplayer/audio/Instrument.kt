package io.github.carstenkeller.noteplayer.audio

/** Sounds the user can choose from. */
enum class Instrument(val label: String) {
    /** Recorded piano samples (default). */
    GRAND_PIANO("Flügel"),
    ELECTRIC_PIANO("E-Piano"),
    ORGAN("Orgel"),
    HARP("Harfe"),
    /** Recorded acoustic guitar (the web app's guitar mode; samples are decoded by the platform). */
    GUITAR("Gitarre"),
}
