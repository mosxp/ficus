import difflib

a = open("_zz_index_backup.html", encoding="utf-8").read().splitlines()
b = open("static/index.html", encoding="utf-8").read().splitlines()
sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == "equal":
        continue
    print(f"=== {tag} old {i1+1}-{i2} new {j1+1}-{j2}")
    print("  before:", b[j1 - 1][:110] if j1 else "")
    print("  removed first:", a[i1][:110])
    print("  removed last :", a[i2 - 1][:110])
    print("  after :", b[j2][:110] if j2 < len(b) else "")
    if tag != "delete":
        for line in b[j1:j2]:
            print("  + ", line[:110])
