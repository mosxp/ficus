import re
import sys

name = sys.argv[1]
pattern = re.compile(sys.argv[2]) if len(sys.argv) > 2 else None
src = open(name, encoding="utf-8").read().split("\n")
defs = [(i + 1, m.group(1)) for i, line in enumerate(src) for m in [re.match(r"(?:async )?def (\w+)", line)] if m]
for k, (start, fn) in enumerate(defs):
    end = defs[k + 1][0] - 1 if k + 1 < len(defs) else len(src)
    if pattern is None or pattern.search(fn):
        print(f"{start}-{end} ({end - start + 1}) {fn}")
