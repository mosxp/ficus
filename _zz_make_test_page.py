import sys

bust = sys.argv[1] if len(sys.argv) > 1 else "1"
html = open("index.html", encoding="utf-8").read()
tag = '<script src="ficus_drive.js?v=5"></script>'
assert tag in html
html = html.replace(tag, f'<script src="_zz_mock_google.js?b={bust}"></script>' + tag + f'<script src="_zz_mock_after.js?b={bust}"></script>', 1)
html = html.replace('src="space.js?v=86"', f'src="space.js?v=86&b={bust}"', 1)
open("_zz_test_index.html", "w", encoding="utf-8", newline="").write(html)
print("ok", bust)
