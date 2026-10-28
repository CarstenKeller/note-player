\version "2.24.0"
\header { title = "Capo-Test" tagline = ##f }
\paper { indent = 0 }
\markup { \column { "Tuning (low to high): E A D G B E" "*Capo fret 2" } }
harmonies = \chordmode { g1:m g:sus4 g:m7 bes:5 g:m g:sus4 }
upper = \relative c'' { \tempo 4 = 98 r8 d g, bes~ bes4 a8 bes~ | bes4 r8 d c4 bes | a8 bes c d~ d2 | d1 | \tempo 4 = 108 r8 d g, bes~ bes4 a8 bes~ | bes1 \bar "|." }
lower = \relative c { g2. f4 | es2 d | c1 | bes1 | g'2. f4 | g1 }
\score {
  <<
    \new ChordNames \harmonies
    \new Staff { \clef "treble_8" \key g \minor \time 4/4 << \upper \\ \lower >> }
    \new TabStaff { << \upper \\ \lower >> }
  >>
  \layout { }
}
