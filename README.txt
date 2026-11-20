TACT. READ THIS FIRST. it is written for a language model.

IN ONE BREATH
  tact lives in your context. the spec and this text came with the conversation, and usually the
  runtime too (one file, tact.js). nothing is installed anywhere else. there is no tact server and
  no service to call. "in context" means exactly that: everything tact is, is here with you.
  you write one whole program and it is run once. there are two ways to run it:
  - with the interpreter:  node tact.js program.tact  in your own code sandbox. checked and exact.
  - in your own reasoning: with no interpreter, you are the runtime. you check the program
    against the spec, then work it out form by form. tact is built so that this can be done
    exactly: nothing changes once bound, there are no loops to lose track of, every builtin has
    one row that says what it does.
  always say which way a result was produced.

WHAT TACT IS
  a small programming language made to be written by a language model, in one pass,
  from a spec that sits in the model's context. it is not meant for people to write by hand.
  you reason about a problem, write one complete tact program, and the runtime checks it and
  runs it. tact gives you exact computation: arithmetic, data, algorithms, dates, money, files,
  charts. the things that go wrong when done "in your head".

WHY IT EXISTS
  a model cannot see its own mistakes until code runs. in most languages a run shows one error,
  after part of the program has already run, and every round trip costs context.
  tact turns that around:
  - every error that can be known is reported before anything runs, all at once, each with its
    line, what is wrong, and usually what to write instead.
  - if the check fails, nothing ran. no half done effects to clean up.
  - code that reaches no io does the same thing every time, so tact tries it while checking.
    a bad index, a division by zero, a check that does not hold: those come up front too.
  - so the loop is: one generation, one check, fix everything in one edit, run. often no fixes.
  the language is small on purpose. the whole core spec is about 3400 tokens, short enough to
  stay in your context all the time. everything beyond the core is a pack you load by name.

HOW TO USE IT
  below, "tact" means  node tact.js  run with the code tool you already have.
  1 the spec is the contract: the syntax, the rules, every builtin as one row (name kind arity
    in out note), every error code. if it is not in your context yet, print it:  tact --spec
  2 write the whole program. only top forms at top level: let fn rec sum show check do use.
  3 need more than the core? the spec lists the packs. (use name) loads one.
    tact --spec NAME prints a pack. if you use a pack's name without loading it, the error
    names the pack and gives the call's signature, so one edit fixes it.
  4 check it:  tact --check FILE  (nothing runs), or just run it:  tact FILE
  5 read the errors. each is  CODE line N: what is wrong. fix all of them, run again.
  6 put (check expr expected) beside your code. it is your proof the program does what you
    meant, and it is checked before the run when its values are known.

  what an error looks like. this program:
      (show (+ 1 2))
      (show (+ 1 "two"))
      (show (* 3 4))
  gives exactly:
      E4 line 2: arg 2 of +: expected Num, got Str
  and prints nothing: line 1 did not run either. fix line 2 and it prints 3, 3, 12.

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

WHERE IT RUNS: IN YOUR OWN SANDBOX, FROM WHAT IS IN YOUR CONTEXT
  there is no setup step. tact.js is one file with no dependencies. run it where you run code:
      node tact.js program.tact        or        node tact.js -e '(show (+ 1 2))'
  the aim is a single run: errors come up front so that one generation and one run are enough.
  what a program can reach is only what its host gives it:
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

RUNNING IT IN YOUR REASONING. when there is no interpreter, or you are told to run nothing
  1 be the checker first. every name is known and its pack is loaded. every call has the right
    number and types of arguments. every match covers every case. nothing is bound twice.
    if anything fails, list every error as  CODE line N: what is wrong  and stop. nothing ran.
  2 then be the interpreter. take the top forms in order. a name's value never changes, so work
    it out once, write it down, and reuse it.
  3 keep numbers exact. write intermediate values down instead of holding them in mind. a date
    is ms since 1970 utc: use the time pack's rules, and take care at month and year ends.
  4 print what show would print: a Str bare, anything else as tact writes it.
  5 say plainly that the result was worked out in reasoning and not by the interpreter.
  what is known: models of three sizes ran programs over 120 records this way and matched the
  interpreter exactly. it costs many times the tokens, nothing double-checks you, and larger
  data is untested. when an interpreter is at hand, use it, or use it to check yourself.

WHAT COMES BACK
  - show prints a value. io.print prints a line from inside an expression.
  - a picture is data. (ascii w h shapes cols) gives text you can read; png and svg are for people.
  - exit code 0 = ran clean. 1 = errors, listed. 2 = the command line was wrong.

THE PACKS. 167 rows are core, the rest load with (use name)
  xlsx  write .xlsx workbooks
  zip   read and write zip and gzip
  wav   sound: samples to wav and back
  prop  seeded random tests that shrink
  graph cheapest path, topo order, parts
  query join group-sum pivot top rank
  dec   exact decimals, big whole numbers
  diff  edits by text: here it is, there it should be
  chart charts and graphs as Draw shapes
  math  trig stats roots integrals seeded random
  text  pad wrap words edit distance
  csv   csv rows, maps, named columns
  re    regex
  json  Json sum, read by path
  time  dates and calendar math, utc
  bit   bit ops
  bytes utf8 base64 hex url html.esc sha256
  mat   vectors and matrices
  draw  shapes: ascii png svg pdf frames
  io    files paths shell http clock

COMMANDS
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
