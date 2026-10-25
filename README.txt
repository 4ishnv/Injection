Injection - neon music player

Run: put all files in one folder, then open index.html in Chrome or Edge.
(Or in VS Code: right-click index.html > Open with Live Server.)

Files
  index.html  page structure (buttons, playlist panel, canvas)
  style.css   colours (top :root block), lyric styling, playlist panel
  app.js      audio, lyrics sync, orb drawing, playlist, controls

Easy things to change
  Colours        style.css  -> :root { --blue, --ice, --bg }
  Lyric timing   app.js     -> LRC_OFFSET (seconds)
  Orb size       app.js     -> draw(): base = Math.min(w, h) * .27
  Number of rings app.js    -> draw(): the loop  for (let k = 0; k < 8; k++)
  Orb reaction   app.js     -> draw(): v * .38 (higher = more movement)
  Lyric text size style.css -> .line { font-size: ... }
