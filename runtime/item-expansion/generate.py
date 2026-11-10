"""Turn vendored pokebw2 source files into DLL translation units.

Each unit names the retail functions it replaces. The file is preprocessed with
the expanded-items configuration, then:

* replaced functions are renamed to their PMC hook symbol
  (THUMB_BRANCH[_SAFESTACK]_<segment>_<address>), so calls inside the DLL go
  straight to the replacement;
* other functions that exist in the retail game lose their bodies and become
  extern declarations, resolved to the retail address through the ESDB, so the
  DLL never carries a second copy of code (or of the state it uses) that the
  game still runs;
* functions the retail game does not have (pokebw2 additions such as
  BagPool_Count) and inline helpers keep their bodies.
"""
import re
import subprocess
from pathlib import Path

NATIVE_SUFFIX = "__retail"
KEYWORDS = {"if", "while", "for", "switch", "return", "sizeof"}
FUNC = re.compile(r"(?m)^([A-Za-z_][\w \t\*]*?)\b(\w+)\s*\(([^;{}]*?)\)\s*\{")


def _strip_comments(text):
    text = re.sub(r"//[^\n]*", "", text)
    return re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)


def _body_end(text, open_brace):
    depth = 0
    i = open_brace
    in_str = None
    while i < len(text):
        c = text[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == in_str:
                in_str = None
        elif c in "\"'":
            in_str = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("Unbalanced braces")


def functions(text):
    """(name, qualifiers, start, signature_end, end) for every file-scope function definition."""
    out = []
    pos = 0
    while True:
        m = FUNC.search(text, pos)
        if not m:
            return out
        name = m.group(2)
        brace = m.end() - 1
        if name in KEYWORDS:
            pos = m.end()
            continue
        end = _body_end(text, brace)
        out.append((name, m.group(1), m.start(), brace, end))
        pos = end + 1


def preprocess(source, includes, defines, compiler):
    args = [compiler, "-E", "-P", "-std=gnu99", "-mthumb", "-D__thumb"] + [f"-D{d}" for d in defines]
    for inc in includes:
        args += ["-I", str(inc)]
    return subprocess.check_output(args + [str(source)]).decode()


def generate(unit, includes, defines, native, compiler):
    """unit: {source, segment, hooks: {name: kind}, keep: [names]}; native: {name: address}."""
    text = _strip_comments(preprocess(unit["source"], includes, defines, compiler))
    hooks = unit["hooks"]
    keep = set(unit.get("keep", ()))
    renames = {}
    for name, kind in hooks.items():
        # kind is the PMC hook type, or (type, retail function whose entry is patched instead)
        kind, target = kind if isinstance(kind, tuple) else (kind, name)
        if target not in native:
            raise KeyError(f"{unit['source']}: {target} has no retail address")
        segment = unit["segment"]
        renames[name] = f"{kind}_{segment}_0x{native[target] & ~1:08x}"
    pieces = []
    last = 0
    defined = set()
    for name, quals, start, brace, end in functions(text):
        defined.add(name)
        pieces.append(text[last:start])
        signature = text[start:brace].rstrip()
        inline = re.search(r"\binline\b", quals) is not None
        if name in hooks:
            pieces.append(re.sub(r"\b(static|inline)\b\s*", "", signature, count=0) + " " + text[brace:end + 1])
        elif name in keep or inline or name not in native:
            pieces.append(text[start:end + 1])
        else:
            pieces.append(re.sub(r"\b(static|inline)\b\s*", "", signature) + ";")
        last = end + 1
    pieces.append(text[last:])
    out = "".join(pieces)
    missing = set(hooks) - defined
    if missing:
        raise KeyError(f"{unit['source']}: no definition for {sorted(missing)}")
    # Forward declarations of functions that are now extern or renamed must not stay static.
    externs = {n for n in defined if n in native and n not in keep}
    for name in externs | set(hooks):
        out = re.sub(r"\bstatic\s+((?:[\w\*]+\s+)*?\**\s*)" + re.escape(name) + r"\s*\(", r"\1" + name + "(", out)
    # A replaced function used as a value (a state pointer, a callback) must keep the retail address: retail code
    # compares and stores those addresses, and the retail entry branches to the replacement anyway.
    for name in renames:
        value_use = re.compile(r"\b" + re.escape(name) + r"\b(?!\s*\()")
        if not value_use.search(out):
            continue
        decl = re.search(r"(?m)^([^;{}#]*?\b" + re.escape(name) + r"\s*\([^;{)]*\))\s*[;{]", out)
        if not decl:
            raise KeyError(f"{unit['source']}: no declaration of {name} to alias")
        alias = re.sub(r"\b(static|inline)\b\s*", "", decl.group(1))
        alias = re.sub(r"\b" + re.escape(name) + r"\b", name + NATIVE_SUFFIX, alias) + ";\n"
        out = value_use.sub(name + NATIVE_SUFFIX, out)
        out = out[:decl.start()] + alias + out[decl.start():]
    for name, symbol in renames.items():
        out = re.sub(r"\b" + re.escape(name) + r"\b", symbol, out)
    return out, renames
