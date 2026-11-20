TACT. READ THIS FIRST. it is written for a language model.

IN ONE BREATH
  tact is a context-only language. you are the runtime.
  a tact program is run in your own reasoning, from the spec in your context. no program is
  executed on any machine. so running one cannot damage, change or leak anything: there is
  nothing to mess up. that is the point of it.
  you write one whole program, check it against the spec, and work it out form by form.
  tact is built so this can be done exactly: nothing changes once bound, there are no loops
  to lose track of, and every builtin has one row that says what it does.
  an interpreter (tact.js) also exists. it is the reference: it defines the right answer, and
  can check you when someone has it. you do not need it, and you should not assume it.

WHAT TACT IS
  a small programming language made to be written and run by a language model, in one pass,
  from a spec that sits in its context. it is not meant for people to write by hand, and it is
  not meant to be handed to a machine. you reason about a problem, write one complete tact
  program, check it, and work it out. tact gives your reasoning a strict form to follow for
  exact work: arithmetic, data, grouping and joins, dates, money. the things that go wrong
  when done loosely "in your head".

WHY IT EXISTS
  - safety. model-written code that runs on a machine can delete, send or change things.
    a tact program runs nowhere but in reasoning. there is no program to mess anything up.
  - exactness. loose reasoning about numbers drifts. a tact program is a written procedure
    with one meaning: every step is a builtin with a fixed rule, and every value is written down.
    anyone, a person or the reference interpreter, can check each step.
  - errors up front. every error that can be known is found before any value is worked out,
    all at once, each with its line, what is wrong, and usually what to write instead. a program
    with an error is not half run and then abandoned: it is not run at all.
  - one pass. because the errors come first, one generation and one run are the aim.
  the language is small on purpose. the whole core spec is about 3400 tokens, short enough to
  stay in your context all the time. everything beyond the core is a pack you load by name.

HOW TO USE IT
  1 the spec is the contract: the syntax, the rules, every builtin as one row (name kind arity
    in out note), every error code. it is in your context. it is all you need.
  2 write the whole program. only top forms at top level: let fn rec sum show check do use.
  3 need more than the core? the spec lists the packs. (use name) loads one, and its spec must
    be in your context too. a pack marked * cannot be worked out in reasoning: see below.
  4 be the checker. go through the program against the spec before working anything out:
    every name known and its pack loaded, every call with the right number and types of
    arguments, every match covering every case, nothing bound twice.
    if anything fails, list every error as  CODE line N: what is wrong  and stop. nothing ran.
  5 be the interpreter. take the top forms in order. a name's value never changes, so work it
    out once, write it down, and reuse it. keep numbers exact: write intermediate values down
    instead of holding them in mind. a date is ms since 1970 utc: use the time pack's rules,
    and take care at month and year ends.
  6 print what show would print: a Str bare, anything else as tact writes it.
  7 put (check expr expected) beside your code. it is your proof the program does what you
    meant. work both sides out; if they differ, that is ECHECK and nothing else is reported.

  what an error looks like. this program:
      (show (+ 1 2))
      (show (+ 1 "two"))
      (show (* 3 4))
  gives exactly:
      E4 line 2: arg 2 of +: expected Num, got Str
  and prints nothing: line 1 did not run either. fix line 2 and it prints 3, 3, 12.

WHAT CANNOT BE DONE IN REASONING
  some builtins are beyond working out by hand. do not pretend to. say the result needs the
  interpreter, or restate the task without them:
  - anything seeded and random: rand shuffle randn randint sample pick k.randn, and the prop pack
  - hashes and encodings of bytes: sha256, base64, compression
  - pixels, sound and files: the draw chart wav zip xlsx and io packs
  - heavy numeric kernels: svd, eig, pinv, and root or integrate on anything but a simple function
  the pack list marks such packs with *.

HOW FAR REASONING GOES. measured, not guessed
  - over 120 records, models of three sizes worked programs out and matched the interpreter exactly.
  - over 2,000 records with messy values, a small model working in chunks of about 300 got about
    half the final values wrong, each by a little: a count off by one, a date put in the
    neighbouring month, an age off by a day. it understood every rule. it slipped over hundreds
    of steps, and it reported the results as finished.
  so the limit is the number of steps, not understanding. act on that:
  - count the steps first: records times the work on each. a few hundred is the edge. past it,
    say the result is unchecked and needs the interpreter or a second pass. never present it as done.
  - reconcile every tally. add the parts and compare with the number of records, and report
    both numbers. if they differ the result is wrong: say so, do not adjust it to fit.
  - keep a written table and update it in small batches. never hold a running total in mind.
  - compare text exactly. "Done " is not "Done". "bug" is not "Bug". do not tidy values as you read.
  - the riskiest step is turning a timestamp into a date. do not divide a 13 digit ms number by
    hand when the date can be given as iso text. in "2026-09-30T23:59:59Z" the month is the
    first 7 characters, (ssub s 0 7), and the day is the first 10. for a count of days use
    date.daynum on each date and subtract: the time pack's notes give the method by hand.
  - a record that appears twice is counted twice unless the program says otherwise (uniq, q.first).

HOW TO THINK IN IT. where tact differs from the languages you know
  - calls are prefix: (f a b). no infix, no commas, no precedence.
  - a name is bound once. no mutation. no shadowing, of builtins either.
  - no loops. use for, map, fold, or a fn whose last call is itself: tail calls are free.
  - no null: a value that may be missing is (Opt T), Some or None.
  - no exceptions: (try expr) gives (Ok value) or (Err "code" "msg"). match on it.
  - match must cover every case, or it is an error before running.
  - types are inferred. fn signatures are declared. a type error names the argument.
  - a with or match name you never use is an error: it usually means the wrong name was used.
  - words from other languages (lambda define nil == while return ..) are caught, and the
    error says the tact form to write.
  - a Num is a finite double. for money and big whole numbers use the dec pack.
  - a value prints as the expression that builds it, so you can read your own output back.

THE REFERENCE INTERPRETER. for whoever has it; you do not need it
  tact.js is one file with no dependencies:   node tact.js program.tact
  it checks and runs a program exactly as the spec says, and is what a result worked out in
  reasoning is measured against. "tact" in the commands below means  node tact.js.
  when a program is run by the interpreter, what it can reach is only what its host gives it:
  - memory host (the default when tact is embedded, and the browser page): files live in
    memory, there is no shell and no network. asking for those is E13, a normal error.
  - node host (the command line): the files, shell and network of the sandbox it runs in.
    assume no network unless you have seen it work.
  - host functions: a program that embeds tact can hand it its own typed functions and types
    (tact --host H.js). calls to them are checked like builtins before anything runs, so a
    script cannot call the app's tools wrongly halfway through.
  - a host can refuse packs (a regex has no time bound, so an app may leave re out). (use re)
    is then E13 before anything runs. tact --check FILE also lists every io and host function
    the program names, so an app can show that list and ask before it runs anything.
  - a host function may need its arguments written as literals (its spec row says so). the
    check then lists each such call with its arguments, so the host can fetch the data first.
  effects exist only in io.* and in host functions. everything else is pure and repeatable:
  the same program gives the same answer on every machine.

WHAT COMES BACK
  - show prints a value. io.print prints a line from inside an expression.
  - either the output, or the list of errors. never both, and never part of a run.
  - from the interpreter: exit code 0 = ran clean. 1 = errors, listed. 2 = the command line was wrong.

THE PACKS. 167 rows are core, the rest load with (use name). * = needs the interpreter
  xlsx*  write .xlsx workbooks
  zip*   read and write zip and gzip
  wav*   sound: samples to wav and back
  prop*  seeded random tests that shrink
  graph  cheapest path, topo order, parts
  query  join group-sum pivot top rank
  dec    exact decimals, big whole numbers
  diff   edits by text: here it is, there it should be
  chart* charts and graphs as Draw shapes
  math   trig stats roots integrals seeded random
  text   pad wrap words edit distance
  csv    csv rows, maps, named columns
  re     regex
  json   Json sum, read by path
  time   dates and calendar math, utc
  bit    bit ops
  bytes* utf8 base64 hex url html.esc sha256
  mat    vectors and matrices
  draw*  shapes: ascii png svg pdf frames
  io*    files paths shell http clock

COMMANDS OF THE INTERPRETER
  tact FILE [args ..]     check, then run
  tact -e SRC             the same for a program given as text
  tact --check FILE       check only. nothing runs
  tact --spec [PACK|all]  the spec: core, one pack, or everything
  tact --sigs FILE        what a .tact library offers, without its source. (use "lib.tact") loads one
  tact --show FILE        every top form with its inferred type
  tact --fmt FILE         the program in the one canonical layout
  tact --list [PACK|all]  builtin names and signatures
  tact --host H.js ..     add a host's functions and types to any of the above
  tact --deny re,io ..    refuse those packs, as a host might
  tact --test | --fuzz N SEED   the language's own tests
  tact --readme           this text

LIMITS, PLAINLY
  - a run has a step budget, calls nest at most 600 deep (tail calls are free), and a vector,
    map or text holds at most 1000000 items. going over is an error, not a crash.
  - a regex has no time bound: a pattern like (a+)+ can run forever.
  - dates are utc only. there are no time zones.
  - match patterns are flat: match again inside for nested data.
  - no concurrency, no mutation, no classes. if you want one, write the data and a fn.
