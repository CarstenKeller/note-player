package io.github.carstenkeller.noteplayer.omr

/** An environment variable (debug settings); null where there is none, e.g. in the browser. */
internal expect fun envVar(name: String): String?
