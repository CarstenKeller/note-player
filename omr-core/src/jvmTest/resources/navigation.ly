\version "2.24.0"
\header { title = "D.S.-Test" tagline = ##f }
\paper { indent = 0 line-width = 170\mm ragged-last = ##t }
\score {
  \new PianoStaff <<
    \new Staff \relative c'' {
      \time 4/4
      c1 | d1 | \break
      \mark \markup { \musicglyph "scripts.segno" }
      e1 | f1
      \textEndMark \markup { "To Coda" \musicglyph "scripts.coda" } | g1 | a1
      \textEndMark \markup { \bold "D.S. al Coda" } \bar "||" \break
      \mark \markup { \musicglyph "scripts.coda" " Coda" }
      b1 | c1 \bar "|."
    }
    \new Staff \relative c { \clef bass c1 | d | e | f | g | a | b | c }
  >>
  \layout { }
}
