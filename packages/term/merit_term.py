#!/usr/bin/env python3
"""
merit-term: record how a human types into any terminal program, as key classes + timing only.

    merit-term rec [--app LABEL] [--out DIR] -- <command> [args...]

Wraps the command in a pseudo-terminal, passes every byte through unchanged, and logs what
*kind* of key each input was (char, space, enter, back, del, paste, nav, select, undo, cmd)
with millisecond timing. It never stores the characters themselves. Output is JSONL of KeyEvent,
the device-level event model in packages/spec. Certify it with:  merit certify <session.jsonl>

Standard library only; no OS permissions needed (it sees only what you type into this terminal).
"""
import json
import os
import pty
import sys
import time
from datetime import datetime, timezone

ESC = 0x1B
PASTE_START = b"\x1b[200~"
PASTE_END = b"\x1b[201~"
BULK_PASTE_MIN = 8  # unbracketed paste heuristic: this many printable chars in one read


def classify_chunk(data: bytes):
    """Yield (class, n) tuples for one read() of user input."""
    # A human produces roughly one key per read; a long printable chunk in a single read is a paste.
    if PASTE_START not in data and ESC not in data:
        text = data.decode("utf-8", "replace")
        if sum(1 for ch in text if ch >= " ") >= BULK_PASTE_MIN:
            return [("paste", len(text))]
    i = 0
    printable_run = 0
    out = []

    def flush_run():
        nonlocal printable_run
        if printable_run:
            out.append(("_run", printable_run))
            printable_run = 0

    while i < len(data):
        if data.startswith(PASTE_START, i):
            flush_run()
            end = data.find(PASTE_END, i + len(PASTE_START))
            body = data[i + len(PASTE_START): end if end >= 0 else len(data)]
            out.append(("paste", len(body.decode("utf-8", "replace"))))
            i = (end + len(PASTE_END)) if end >= 0 else len(data)
            continue
        b = data[i]
        if b == ESC:
            flush_run()
            seq = data[i:i + 8]
            if seq.startswith(b"\x1b[3~"):
                out.append(("del", 0)); i += 4; continue
            if seq.startswith(b"\x1b[1;2") or seq.startswith(b"\x1b[1;6"):  # shift(/ctrl)-arrows: selection
                out.append(("select", 0)); i += 6; continue
            if seq[:2] in (b"\x1b[", b"\x1bO") and len(seq) >= 3:
                out.append(("nav", 0)); i += 3; continue
            out.append(("cmd", 0)); i += 2 if len(seq) > 1 else 1; continue
        if b in (0x7F, 0x08):
            flush_run(); out.append(("back", 0)); i += 1; continue
        if b in (0x0D, 0x0A):
            flush_run(); out.append(("enter", 0)); i += 1; continue
        if b == 0x1F:  # ctrl-_ : undo in readline/emacs
            flush_run(); out.append(("undo", 0)); i += 1; continue
        if b < 0x20:
            flush_run(); out.append(("cmd", 0)); i += 1; continue
        if b == 0x20:
            flush_run(); out.append(("space", 0)); i += 1; continue
        # printable (count UTF-8 lead bytes only)
        if b & 0xC0 != 0x80:
            printable_run += 1
        i += 1
    flush_run()

    # expand runs: a big single-read run is a paste without bracketing; otherwise individual chars
    final = []
    for cls, n in out:
        if cls == "_run":
            if n >= BULK_PASTE_MIN:
                final.append(("paste", n))
            else:
                final.extend([("char", 0)] * n)
        else:
            final.append((cls, n))
    return final


def rec(argv):
    app = None
    outdir = os.path.expanduser("~/.merit/sessions")
    while argv and argv[0] != "--":
        if argv[0] == "--app":
            app = argv[1]; argv = argv[2:]
        elif argv[0] == "--out":
            outdir = os.path.expanduser(argv[1]); argv = argv[2:]
        else:
            break
    if argv and argv[0] == "--":
        argv = argv[1:]
    if not argv:
        argv = [os.environ.get("SHELL", "/bin/zsh")]
    label = app or os.path.basename(argv[0])

    os.makedirs(outdir, mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.join(outdir, f"{stamp}-{label.replace('/', '_')}.jsonl")
    f = open(path, "w")
    os.chmod(path, 0o600)
    t0 = time.monotonic()
    seq = 0

    def on_input(fd):
        nonlocal seq
        data = os.read(fd, 4096)
        t = int((time.monotonic() - t0) * 1000)
        for cls, n in classify_chunk(data):
            ev = {"seq": seq, "t": t, "k": cls, "app": f"term:{label}"}
            if n:
                ev["n"] = n
            f.write(json.dumps(ev, separators=(",", ":")) + "\n")
            seq += 1
        f.flush()
        return data

    sys.stderr.write(f"merit: recording key classes (no characters) for '{label}' -> {path}\n")
    try:
        status = pty.spawn(argv, stdin_read=on_input)
    finally:
        f.close()
        sys.stderr.write(f"merit: session saved ({seq} key events). Certify with: merit certify {path}\n")
    return os.waitstatus_to_exitcode(status) if isinstance(status, int) else 0


def main():
    if len(sys.argv) < 2 or sys.argv[1] != "rec":
        print(__doc__.strip())
        sys.exit(2)
    sys.exit(rec(sys.argv[2:]))


if __name__ == "__main__":
    main()
