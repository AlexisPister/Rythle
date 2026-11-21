This file describe the requirement of this application. I want to build a SvelteKit Typescript project similar to Worlde, but for rythm play, a bit like the Rythm Paradise game. 
Every day a rythm is generated and shown to the user, that they have to play at a given bpm.


## How it works

The rythms are display with sheet notation a bit similar to drums music sheets.
The rythm is played once first to the user. Then a count down appear with "your turn" displayed, where the user need to touch any key when the note is played.


## Parameters

- BPM: 80-120
- N_BARS: 4
- NB_ATTEMPTS: 3


## Design

Every thing should appear without needing to scroll, even when settings are displayed.
Share button: copy paste the results. Can be done at any number of attempts.

- SIZE_TITLE: 52px
- HEIGHT_SHEET: 25% of vertical screen
