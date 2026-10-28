\version "2.24.0"
\header { title = "Testlied Gitarre" tagline = ##f }
\paper { indent = 0 }
harmonies = \chordmode { c1 a:m f g:7 c e:m d:m g }
melody = \relative c' { \time 4/4 \key c \major
  e4 g c g | a2 e4 c | f4 a c a | g2 b,2 |
  c4 e g e | e8 g b g e2 | d4 f a f | g1 \bar "|." }
\score {
  <<
    \new ChordNames \harmonies
    \new Staff { \clef "treble_8" \melody }
    \new TabStaff { \melody }
  >>
  \layout { }
}
