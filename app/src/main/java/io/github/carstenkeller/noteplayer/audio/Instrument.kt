package io.github.carstenkeller.noteplayer.audio

/** Sounds the user can choose from. */
enum class Instrument(val label: String) {
    /** Recorded piano samples (default). */
    GRAND_PIANO("Flügel"),
    ELECTRIC_PIANO("E-Piano"),
    ORGAN("Orgel"),
    HARP("Harfe"),
}
