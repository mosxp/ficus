import re
import sys

files = sys.argv[1:] or ["index.html"]
found = {}
for name in files:
    src = open(name, encoding="utf-8").read()
    for m in re.finditer(r"""fetch\(\s*([`"'])(/api/[^`"']*)\1(.{0,260})""", src, re.S):
        path = re.sub(r"\$\{[^}]*\}", "{x}", m.group(2)).split("?")[0]
        method = re.search(r"""method:\s*["'](\w+)["']""", m.group(3))
        verb = method.group(1).upper() if method else "GET"
        line = src.count("\n", 0, m.start()) + 1
        found.setdefault((path, verb), []).append(f"{name}:{line}")
for (path, verb), where in sorted(found.items()):
    print(f"{verb:6} {path}  [{len(where)}] {where[0]}")
