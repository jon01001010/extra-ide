# Pane

A small browser for pages written in Tiny's UI language. Pages are plain text; the engine lays them out,
paints them on a canvas, and follows links between them.

* Browser: `pane.html` (one file, offline, phone-friendly). It inlines `pane.js` and the sample pages in
  `pages/`; after editing either, rebuild it with `node tools/build-pane-html.js` (`--check` verifies it is current).
* Engine: `pane.js`, one file (~1900 lines). `<script src="pane.js">` defines `window.Pane`;
  in Node, `require('./pane.js')` gives the parser, the expression evaluator, layout and the script runtime
  (no canvas needed). Page scripts run in `mote.js`, which `pane.html` also inlines
  (`node tools/build-mote-html.js`).
* Tests: `node tests/run-pane.js` (engine, Node only; `--update` rewrites the stored layouts),
  `NODE_PATH=… node tests/run-pane-page.js` (browser, Playwright) and `NODE_PATH=… node tests/run-pane-app.js`
  (apps: Emit programs compiled on the spot, then run in Pane).

The grammar and the look of every widget come from the UI mode of `tiny-v3-8.html`. Two phases of a longer
plan are here: pages you can read and move between, and pages that run a script inside limits the browser
enforces, as a Mote script or as a compiled WebAssembly app; and the first part of a third: paragraphs with
styles and links inside, tables that fit their text, a real text field, and sending. Still to come: forms
without a script, images with captions, and painting only what changed.

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
| `tbl` | a table: each child is a `txt` line with `|` between cells; the first row is the header. Columns are as wide as their text needs, cells wrap, and a row is as tall as its tallest cell |
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
| `par text` | a paragraph with styles inside it (below) |
| `lnk text address` | a link; the last word is the address |
| `btn label [id]` | a button; `tap id` is 1 while its click is handled |
| `inp id [hint]` | a one-line text field; the hint shows while it is empty |
| `tog id`, `chk id label` | a switch, a checkbox |
| `sel id A, B, C` | a choice; a click steps to the next option |
| `sld min max id` | a slider |
| `prg value max` | a progress bar; value is a number or a variable name |
| `rat id max` | star rating, kept in the variable `ratID` |
| `img address`, `avt address` | an image at its own shape, a round avatar |
| `app address` | a WebAssembly program with a picture of its own (section 3) |
| `bdg text`, `ico name`, `div`, `spn` | a badge, an emoji icon, a dividing line, a spinner |
| `tmr id ms` | invisible; adds 1 to the variable `tmrID` every `ms` milliseconds and runs the `if` lines |

### Names

`id name` names the element written just before it; right after a container's opening line (or its `end`)
it names that container. Names are letters, digits and `_`, case-insensitive, and unique in a page. Scripts
find elements by name.

```
btn Add
id add
lst
  id list
end
```

### Text

A text that is exactly a variable's name shows the variable. `{expression}` inside a text is replaced by its
value: `txt Hello, {str 1}`, `txt Total: {price*qty}`. Layout follows the text, so a value that grows longer
wraps and moves what is below it.

### Paragraphs

`par` is `txt` with marks inside the text:

| written | shows |
|---|---|
| `**words**` | bold |
| `*words*` | italic |
| `` `words` `` | code: shown exactly as written, with no marks or `{expression}` read inside |
| `[words](address)` | a link in the line; it wraps with the text and opens like `lnk` |
| `\*`, `` \` ``, `\[`, `\]`, `\\` | that character itself |

Styles can sit inside each other, and bold can start in the middle of a word (`mid**dle**`). A mark only
counts when it can be one:
`2 * 3`, `4*5*6` and a `*` with no partner stay as written. `{expression}` is replaced inside each run, and
what it gives is text: marks in a value do nothing. A `par` shows a variable only through `{name}`.

### Statements

```
set name expression                       run once, when the page opens
if condition do action : action : …       run on every click or change of a control and every timer tick
```

Actions: `set name expression`, `go address` (open a page), `web address name` (GET an address; the answer
goes to `name` as a number, `name_txt` as text and `name_status` as the HTTP status), `snd address` (play a sound).

Expressions: numbers, `"strings"`, variables (case-insensitive; unknown is 0), `( )`, `* /`, `+ -`
(`+` joins when either side is a string), `= <> < > <= >=`, `not`, `and`, `or`. Division by zero is 0.
Widget values: `val N` (a text field as a number, or its text when it is not a number), `str N` (its text),
`tap N`, `chk N`, `tog N`, `sel N`, `sld N`, `rat N`.

---

## 2. Scripts

Lines between `script` and `end script` are a [Mote](MOTE.md) program (Lua 5.4 syntax). It runs once when the
page opens, after the `set` lines, and registers handlers for later. Error messages carry the line number
in the page file. A page may have several script blocks; they are one program.

```
inp 1
id field
btn Add
id add
lst
  id list
end
script
page.on("add", "click", function()
  local field = page.find("field")
  page.add("list", "txt", field.value)   -- the words go in as text, whatever they contain
  field.value = ""
end)
end script
```

The script sees two tables and nothing else of the browser.

### `page`

| call | does |
|---|---|
| `page.find(name)` | the element with that name, or nil |
| `page.on(name, event, fn)` | call `fn(value, element)` on `"click"` (buttons, links) or `"change"` (every other control) |
| `page.get(name)`, `page.set(name, value)` | the variables that `{expr}` and the statements use |
| `page.add(name, source [, words])` | add elements, written in the page format, to a container; returns how many |
| `page.clear(name)` | remove everything inside a container |
| `page.title(text)` | set the page title |
| `page.go(address)` | open a page; only while a click or key of the user is being handled |
| `page.after(ms, fn)`, `page.every(ms, fn)`, `page.cancel(id)` | timers |
| `page.fetch(address, fn)` | GET; later calls `fn(status, text)` (status 0: no answer, or not allowed) |
| `page.post(address, body, fn)` | POST; text is sent as text, a table as JSON; the answer comes back like `fetch` |

An element has seven fields: `name` and `kind` (read-only), `text`, `value`, `checked`, `hidden`, `open`.
`value` is the text of an `inp`, the number of a `sld`, `rat` or `prg`, the chosen option of a `sel` or the
selected tab of a `tab` (counted from 1), and the address of a `lnk`, `img` or `avt`. A field an element
does not have reads as nil and cannot be set (an error `pcall` can catch).

**Text from people and from the network.** `page.add(list, "txt " .. words)` reads `words` as page lines,
so words with a line break in them could add other elements. Pass them as the third argument instead:
`page.add(list, "txt", words)` makes them the text of the element added, exactly as given. Text a script
sets (this way or through `.text`) is never read as a variable name or as `{expr}`.

### `store`

`store.get(key)`, `store.set(key, value)`, `store.remove(key)`, `store.keys()`. Values are text, numbers or
true / false. What a page stores belongs to its site (below) and stays on the device.

### Limits

Every call into a script (the first run, each handler, each timer tick, each answer) has a budget of
2,000,000 VM steps and an 8 MB allocation estimate. A call that runs out ends with a message in the status
line; the page and its other handlers go on, and a repeating timer that ran out is stopped. A page can have
5,000 elements, 500 handlers, 32 timers, 4 requests at once, answers up to 1 MB, 100,000 characters per
`post`, text up to 20,000 characters per element.

---

## 3. Apps

`app address` puts a WebAssembly program on the page. It draws into a picture of its own, which is laid out
like an image (scaled down to fit, never up), and it runs in a worker of its own, so it cannot hold up the
page. The address is a `.wasm` file on the page's site, or a `data:` address with the program inside the page.

The program is written against the Emit runtime's names, so a program compiled by the Emit IDE runs as it
is when it stays inside the list below.

```
node tools/emit-to-pane.js game.emit game.pane --title "My game"
```

compiles an Emit program and writes a page with the program inside it. `pages/apps/bounce.emit` is the
source of the built-in `pane:bounce`.

**How it is run.** As the IDE's Run does: every exported function that takes nothing is called once
(not `frame`, `onclick_N`, `ontimer_N`, `onhttp_N`); if the program called `animate()`, its `frame()` is then
called once per screen frame while the app is on screen. A click on the picture gives the app the keys;
Escape takes them back. The pointer is given in the picture's own coordinates.

**What a program can call** (`Pane.APP_IMPORTS` has the exact list):

| group | names |
|---|---|
| picture | `canvas color alpha lineWidth rect strokeRect circle line pixel text clear animate screenW screenH` |
| keys and pointer | `keyDown touchX touchY touching mouseX mouseY mouseDown` |
| numbers | `abs min max sqrt sin cos tan asin acos atan atan2 pow exp ln log2 floor ceil round sign absNum minNum maxNum lerp clamp dist collides random randInt PI TAU E now` |
| text | `intToStr numToStr strLen strConcat substr strEq charAt`, and `+` and `==` on strings |
| arrays of numbers | `newArray getItem setItem getNumItem setNumItem push pop arrayLen` |
| regions | `region name: type[n]` and structs: memory the program reads and writes itself, every index checked |
| output | `print printNum printStr` (to the status line) |

Everything else the Emit IDE offers is absent: JS interop and `use` libraries, the DOM builtins (`button`,
`input`, `div`, `alert`), storage, the network, sound, images, timers, `screen` and array literals. A program
that imports any of it is not started, and the picture says which names were the problem; the tool refuses
it with the same list.

**Limits.** A program up to 4 MB; 64 MB of memory; 16 MB of text in use at once (text the program no longer
keeps is reused; one string is cut at 100,000 characters); 1,000,000 numbers in arrays; 20,000 drawing calls
per frame; a picture up to 2048 pixels a side; four apps per page. An app that does not answer within
5 seconds at the start, or 1.5 seconds for a frame, is ended: its last picture stays, with "stopped" over it.

**What it cannot do.** The worker gives the program nothing but the functions above: no network, no storage,
no page, no other app. Drawing comes back to the page as a list of commands that is checked before it is
replayed. Apps and the page's script do not talk to each other yet.

---

## 4. What a page may do

**Site.** A page's site is the origin of its address (`https://example.org`); all built-in pages are one
site. Storage and permissions go by site.

| a page can | rule |
|---|---|
| show and change its own elements and variables | always |
| read and write `store` | its own site's keys only; 100 KB per site |
| load from or send to its own site (`img`, `avt`, `app`, `snd`, `web`, `page.fetch`, `page.post`) | always; no cookies are sent |
| run an app from a `data:` address | always: it is part of the page |
| load from or send to another site, or a font from a font service | not until the user presses **Allow** in the bar that names both sites; kept until the window closes |
| open another page (`go`, `page.go`) | only while a click or key of the user is being handled; never at load or from a timer |
| play a sound | same rule as opening a page |
| reach the browser around it (DOM, other pages, cookies, the address bar) | never: none of it exists in the script's world |

When a page is left, its script, timers and unanswered requests are cut off: nothing they do afterwards
reaches the new page, the store or the address bar. Each page gets a fresh VM.

`tests/run-pane.js` and `tests/run-pane-page.js` try the ways out: host globals, constructors and
prototypes of handles and functions, `__proto__` as a name, key or variable, text that looks like page
lines, endless loops and runaway memory, loading from another site, reading another site's store, and
navigating without the user. `tests/run-pane-app.js` does the same for apps: a program that never returns,
one that imports what apps do not have (by name, by module, as a memory or a global), one that asks for or
grows too much memory, and one from another site.

Not covered: a page can still make the browser lay out a very large page slowly (the limits bound it, they
do not make it instant), and the permission bar trusts the user's answer.

---

## 5. Layout rules

* The page is a column as wide as the window. It scrolls when it is taller than the window.
* Text is broken into lines during layout, so its box is as tall as its lines. A word wider than the line is
  broken between characters.
* A row first gives fixed-size children their size, then shares the rest by `grow`. No child gets less than
  its longest word; a child with `minw` or `maxw` keeps to it and the others share what is left. The row is
  as tall as its tallest child.
* Layout runs again when the window is resized and after anything that can change sizes (a click, a key, a
  timer tick, an image or font arriving). Scrolling only repaints. Only what is on screen is painted.
* Everything is in CSS pixels; the canvas backing store follows the device pixel ratio.

## 6. The browser

* **Addresses**: `pane:name` is a built-in page; `http:` and `https:` are fetched (without cookies) and must
  be plain text, up to 2 MB. A bare word typed in the address bar is a built-in page; something with a dot
  is a site. Other kinds of address, such as `javascript:`, are refused.
* **Links** are read against the address of the page they are on. From a built-in page, a bare word is
  another built-in page.
* **History**: back, forward and reload. Each entry remembers how far it was scrolled.
* **Errors** (an answer that is not 200, an HTML page, no answer) are shown as a page, with the answer code.
* Fetching another site is subject to that site allowing it (CORS), as for any web page.
* The status line shows the last thing a page printed, a script error, or what was blocked.
* The page text is also kept in a hidden text-only copy for screen readers, built with text nodes only.
* **Text fields.** While an `inp` is being typed in, a real text field is laid over it, so the caret,
  selection, copy and paste, the phone's keyboard and input methods all work. It goes away on Enter, Escape
  or a click elsewhere. What is typed reaches the page (text, `if` lines, `"change"` handlers) as it happens.

## 7. Embedding

```js
const view = Pane.createView(canvas, {
  onNavigate: address => …,          // links, `go` and page.go
  onTitle: title => …,
  onLog: (kind, text, site) => …,    // 'print', 'error', 'blocked', 'app'
  resolve: ref => absoluteUrlOrNull, // for img, avt, snd, web and page.fetch
  allow: (kind, url, site) => bool,  // asked before every request a page causes; absent: all allowed
  storage: site => ({ get, set, remove, keys }),   // what `store` uses; absent: scripts have no store
  mirror: element,                   // optional: receives the text-only copy
  overlay: element,                  // optional: where text fields go while typed in (default: the canvas's parent)
});
view.load(source, { site });         // drops the previous page's state, script, timers and requests
view.destroy();
```

Without a canvas (Node, tests): `Pane.parse(source)` → page; `Pane.layout(page, width, height, { measure, state })`
with `measure(text, px, family, bold) → width`; `Pane.dump(page)` → one line per placed node;
`Pane.createRuntime(page, state, hooks, Mote)` runs a page's script against a host you supply.

## 8. Differences from Tiny's UI mode

* Columns stack at natural height (Tiny shared the height equally); use `grow` to fill.
* Rows never overflow: shares respect each child's longest word, and text wraps.
* Statements have a real expression parser: precedence, parentheses, strings, `not`, `tog N`, `str N`.
  `web` keeps the whole answer and the status; `:` inside `://` does not split actions.
* `lnk` opens the page in the browser instead of a new window; `go` does the same from a statement.
* `dlg` sits over the window and takes all clicks while open.
* `if` lines run after every control changes, not only after button clicks.
* Tables size their columns from their text and wrap their cells (Tiny: equal columns, one line per cell).
* Text fields are real ones while typed in (Tiny: Backspace and printable keys only).
* New: `title`, `id`, `script`, `app`, `par`, a hint for `inp`, `w h minw maxw minh maxh grow align just`, percentages, `{expression}` in text.
* Not carried over: Tiny's canvas and GPU modes, the debug panel, export.
