\version "2.24.0"
\header { tagline = ##f }
\paper { indent = 0 line-width = 160\mm }
\score {
  \new Staff \relative c'' {
    \key g \major \time 4/4
    << { r8 d4 d8 d4 d4 } \\ { g,1 } >> |
    \ottava #1 b'8 c d d d4 d | \ottava #0
    <d,, e>2 g'2 |
    \clef bass c,,2 e2 \bar "|."
  }
  \layout { }
}
