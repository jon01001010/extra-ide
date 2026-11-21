# Pane

A small browser for pages written in Tiny's UI language. Pages are plain text; the engine lays them out,
paints them on a canvas, and follows links between them.

* Browser: `pane.html` (one file, offline, phone-friendly). It inlines `pane.js` and the sample pages in
  `pages/`; after editing either, rebuild it with `node tools/build-pane-html.js` (`--check` verifies it is current).
* Engine: `pane.js`, one dependency-free file (~1100 lines). `<script src="pane.js">` defines `window.Pane`;
  in Node, `require('./pane.js')` gives the parser, the expression evaluator and layout (no canvas needed).
* Tests: `node tests/run-pane.js` (engine, Node only; `--update` rewrites the stored layouts) and
  `NODE_PATH=… node tests/run-pane-page.js` (browser, Playwright).

The grammar and the look of every widget come from the UI mode of `tiny-v3-8.html`. This is phase 1 of a
longer plan: pages you can read and move between. Scripting beyond the statements below, a permission
model for pages, styled text runs and a real text field are not here yet.

---

## 1. Page format

One statement per line. Indentation is free. `end` closes a container; containers left open at the end of
the file are closed. `rem` starts a comment line. A line the engine does not know is skipped and counted in
the status line.

```
title Hello
align center
col
  w 100%
  maxw 640
  pad 20
  gap 12
  fnt 24
  txt Hello
  fnt 14
  txt This paragraph wraps to the width of the column.
  row
    gap 10
    btn Count 1
    txt Clicked {n} times
  end
  lnk Another page other.pane
end
set n 0
if tap 1=1 do set n n+1
```

### Containers

| word | does |
|---|---|
| `col` | children stacked top to bottom, each at its natural height |
| `row` | children side by side, sharing the width |
| `box [size]` | a column with a fixed size along its parent's direction: a width in a row, a height in a column |
| `scl [size]` | a column that scrolls when its content is taller than it is |
| `grid N` | N equal columns; each row is as tall as its tallest cell |
| `lst` | a numbered list |
| `tbl` | a table: each child is a `txt` line with `|` between cells; the first row is the header |
| `tab A, B, C` | tabs; each child is one panel, in order |
| `acc Title` | a header that opens and closes its body |
| `dlg Title` | a dialog over the page; open at the start, closed with its cross |

A size is a number of pixels or a percentage of the parent (`box 120`, `box 25%`).

### Properties

A property line sets the container it is written in. Colour and font size are handed to children **as they
are when the child is written**, so order matters: `fnt 20`, `txt Big`, `fnt 14`, `txt Small`.
`pad`, `gap`, `bg` and the layout properties belong to the container itself; the last value written wins.
Written before any container, a property sets the page (for example `align center`).

| word | does |
|---|---|
| `pad N`, `gap N` | space inside the edge, space between children |
| `bg r g b`, `bge r g b a` | background (a: 0–255) |
| `fg r g b`, `brd r g b` | text colour, 1 px border |
| `fnt N`, `font Name` | font size in pixels, font family (loaded from Google Fonts) |
| `w S`, `h S` | fixed width, fixed height |
| `minw S`, `maxw S`, `minh S`, `maxh S` | limits |
| `grow N` | share of the spare space along the parent's direction (rows: default 1; columns: default 0) |
| `align start|center|end|stretch` | children across the container's direction (default `stretch`) |
| `just start|center|end|between` | children along it; in a row this also keeps children at their natural width |

### Elements

| word | shows |
|---|---|
| `txt text` | text, wrapped to its width |
| `lnk text address` | a link; the last word is the address |
| `btn label [id]` | a button; `tap id` is 1 while its click is handled |
| `inp id` | a one-line text field |
| `tog id`, `chk id label` | a switch, a checkbox |
| `sel id A, B, C` | a choice; a click steps to the next option |
| `sld min max id` | a slider |
| `prg value max` | a progress bar; value is a number or a variable name |
| `rat id max` | star rating, kept in the variable `ratID` |
| `img address`, `avt address` | an image at its own shape, a round avatar |
| `bdg text`, `ico name`, `div`, `spn` | a badge, an emoji icon, a dividing line, a spinner |
| `tmr id ms` | invisible; adds 1 to the variable `tmrID` every `ms` milliseconds and runs the `if` lines |

### Text

A text that is exactly a variable's name shows the variable. `{expression}` inside a text is replaced by its
value: `txt Hello, {str 1}`, `txt Total: {price*qty}`. Layout follows the text, so a value that grows longer
wraps and moves what is below it.

### Statements

```
set name expression                       run once, when the page opens
if condition do action : action : …       run on every button click and timer tick (then works like do)
```

Actions: `set name expression`, `go address` (open a page), `web address name` (GET an address; the answer
goes to `name` as a number, `name_txt` as text and `name_status` as the HTTP status), `snd address` (play a sound).

Expressions: numbers, `"strings"`, variables (case-insensitive; unknown is 0), `( )`, `* /`, `+ -`
(`+` joins when either side is a string), `= <> < > <= >=`, `not`, `and`, `or`. Division by zero is 0.
Widget values: `val N` (a text field as a number, or its text when it is not a number), `str N` (its text),
`tap N`, `chk N`, `tog N`, `sel N`, `sld N`, `rat N`.

---

## 2. Layout rules

* The page is a column as wide as the window. It scrolls when it is taller than the window.
* Text is broken into lines during layout, so its box is as tall as its lines. A word wider than the line is
  broken between characters.
* A row first gives fixed-size children their size, then shares the rest by `grow`. No child gets less than
  its longest word; a child with `minw` or `maxw` keeps to it and the others share what is left. The row is
  as tall as its tallest child.
* Layout runs again when the window is resized and after anything that can change sizes (a click, a key, a
  timer tick, an image or font arriving). Scrolling only repaints. Only what is on screen is painted.
* Everything is in CSS pixels; the canvas backing store follows the device pixel ratio.

## 3. The browser

* **Addresses**: `pane:name` is a built-in page; `http:` and `https:` are fetched (without cookies) and must
  be plain text, up to 2 MB. A bare word typed in the address bar is a built-in page; something with a dot
  is a site. Other kinds of address, such as `javascript:`, are refused.
* **Links** are read against the address of the page they are on. From a built-in page, a bare word is
  another built-in page.
* **History**: back, forward and reload. Each entry remembers how far it was scrolled.
* **Errors** (an answer that is not 200, an HTML page, no answer) are shown as a page, with the answer code.
* Fetching another site is subject to that site allowing it (CORS), as for any web page.
* The page text is also kept in a hidden text-only copy for screen readers, built with text nodes only.

## 4. Embedding

```js
const view = Pane.createView(canvas, {
  onNavigate: address => …,        // links and `go`
  onTitle: title => …,
  resolve: ref => absoluteUrlOrNull, // for img, avt, snd and web
  mirror: element,                 // optional: receives the text-only copy
});
view.load(source);                 // drops the previous page's state, timers and requests
view.destroy();
```

Without a canvas (Node, tests): `Pane.parse(source)` → page; `Pane.layout(page, width, height, { measure, state })`
with `measure(text, px, family, bold) → width`; `Pane.dump(page)` → one line per placed node.

## 5. Differences from Tiny's UI mode

* Columns stack at natural height (Tiny shared the height equally); use `grow` to fill.
* Rows never overflow: shares respect each child's longest word, and text wraps.
* Statements have a real expression parser: precedence, parentheses, strings, `not`, `tog N`, `str N`.
  `web` keeps the whole answer and the status; `:` inside `://` does not split actions.
* `lnk` opens the page in the browser instead of a new window; `go` does the same from a statement.
* `dlg` sits over the window and takes all clicks while open.
* New: `title`, `w h minw maxw minh maxh grow align just`, percentages, `{expression}` in text.
* Not carried over: Tiny's canvas and GPU modes, the debug panel, export.
