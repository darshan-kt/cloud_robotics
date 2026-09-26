# exercises.pdf — how it is built

`exercises.pdf` is generated, not hand-edited. Everything — the text, all
thirteen diagrams, and the print stylesheet — lives in `build.py`.

To change it:

```bash
cd secure_robotstore/docs/exercises-assets

python3 build.py          # writes exercises.html here, next to fonts.css

google-chrome --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=25000 \
  --print-to-pdf=../exercises.pdf exercises.html
```

`../exercises-print.html` is a copy of that HTML with the stylesheet path
rewritten so it also opens correctly from the `docs/` folder in a browser. It
is a convenience, not a build input.

## Two things that will bite you

**Fonts must be local and static.** `fonts/` holds static IBM Plex Sans and
Mono (woff2, latin subset). They are committed on purpose. Chrome will not
embed the *variable* build of IBM Plex Sans into a PDF, so linking Google
Fonts silently produces a document set in Liberation Sans that looks fine on
screen and wrong on paper. Check any new build with:

```bash
python3 -c "import re; d=open('../exercises.pdf','rb').read(); \
  print(sorted(set(re.findall(rb'/BaseFont\s*/[A-Z]+\+([A-Za-z0-9\-]+)', d))))"
```

IBMPlexSans and IBMPlexMono must appear. DejaVu and Liberation may also
appear — those are fallbacks for arrows and dashes Plex's latin subset does
not carry, which is expected.

**Chrome needs a moment.** `--virtual-time-budget=25000` gives the fonts and
layout time to settle before the page is captured. Drop it and you can get a
half-rendered first page.

## Keeping it in step with the rest of the docs

The same twelve exercises exist as `../exercises.md`, and the run
instructions they depend on live in `../../README.md`. If you change a
command in one, change it in all three. They are currently written for the
no-Docker setup: broker on `localhost:1883`, Postgres on `5432`, Redis on
`6379`.
