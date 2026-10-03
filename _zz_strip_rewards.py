import re
import sys

PATH = "static/index.html"
raw = open(PATH, "rb").read().decode("utf-8")
text = raw.replace("\r\n", "\n")

FUNCS = [
    "paintVisionRewardDisplay", "paintHabitRewardDisplay", "paintProjectRewardDisplay",
    "rewardElementLabel", "paintRewardElementsList", "paintRewardElementDraft",
    "openRewardEditor", "openVisionRewardModal", "openProjectRewardModal", "openHabitRewardModal",
    "saveRewardEditor", "saveVisionReward", "queueUnlockedRewards", "maybeCelebrateRewards",
    "maybeShowNextReward", "openRewardCelebrate", "renderLegacyTrophies", "renderRewardsVault",
    "createReward", "claimReward", "uploadRewardPhoto",
]

LISTENERS = [
    'document.getElementById("vision-reward-display-container").addEventListener(',
    'document.getElementById("vision-reward-form").addEventListener(',
    'document.getElementById("legacy-trophy-grid")?.addEventListener(',
    'document.getElementById("rewards-list")?.addEventListener(',
    'document.getElementById("reward-claim").addEventListener(',
    'document.getElementById("habit-reward-upload")?.addEventListener(',
]


def block_end(src: str, open_idx: int) -> int:
    """Index just past the brace that closes the one at open_idx (skips strings/templates/comments)."""
    depth = 0
    i = open_idx
    stack = []  # template literal nesting
    n = len(src)
    while i < n:
        c = src[i]
        if stack and stack[-1] == "tpl":
            if c == "\\":
                i += 2
                continue
            if c == "`":
                stack.pop()
            elif c == "$" and src[i + 1] == "{":
                stack.append(depth)
                depth += 1
                i += 2
                continue
            i += 1
            continue
        if c in "\"'":
            j = i + 1
            while src[j] != c:
                j += 2 if src[j] == "\\" else 1
            i = j + 1
            continue
        if c == "`":
            stack.append("tpl")
            i += 1
            continue
        if c == "/" and src[i + 1] == "/":
            i = src.index("\n", i)
            continue
        if c == "/" and src[i + 1] == "*":
            i = src.index("*/", i) + 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if stack and stack[-1] == depth and stack[-1] != "tpl":
                stack.pop()
                i += 1
                continue
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced")


def remove_span(src: str, start: int, end: int) -> str:
    line_start = src.rfind("\n", 0, start) + 1
    if src[line_start:start].strip() == "":
        start = line_start
    line_end = src.find("\n", end)
    if line_end != -1 and src[end:line_end].strip() in ("", ";", ");"):
        end = line_end + 1
    return src[:start] + src[end:]


for name in FUNCS:
    m = re.search(r"(?:async\s+)?function\s+" + name + r"\s*\(", text)
    if not m:
        print("missing function", name)
        continue
    brace = text.index("{", text.index(")", m.end()))
    end = block_end(text, brace)
    text = remove_span(text, m.start(), end)
    print("removed function", name)

for prefix in LISTENERS:
    while True:
        idx = text.find(prefix)
        if idx == -1:
            break
        paren = idx + len(prefix) - 1
        # walk to matching close paren of addEventListener( ... )
        depth = 0
        i = paren
        while True:
            c = text[i]
            if c == "{":
                i = block_end(text, i)
                continue
            if c in "\"'`":
                q = c
                j = i + 1
                while text[j] != q:
                    j += 2 if text[j] == "\\" else 1
                i = j + 1
                continue
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        text = remove_span(text, idx, i + 1)
        print("removed listener", prefix[:60])

if "--write" in sys.argv:
    open(PATH, "wb").write(text.replace("\n", "\r\n").encode("utf-8"))
    print("written")
