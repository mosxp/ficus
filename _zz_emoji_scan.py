import collections
import re
import unicodedata

text = open("static/index.html", encoding="utf-8").read()
pattern = re.compile(
    "[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF\u2190-\u21FF\u25A0-\u25FF\u2700-\u27BF]\uFE0F?"
)
counts = collections.Counter(m.group(0) for m in pattern.finditer(text))
for ch, n in counts.most_common():
    base = ch[0]
    try:
        name = unicodedata.name(base)
    except ValueError:
        name = "?"
    emoji_like = ord(base) >= 0x1F000 or ch.endswith("\uFE0F")
    print(f"{n:5d}  U+{ord(base):05X}  {'EMOJI' if emoji_like else 'text '}  {name}")
