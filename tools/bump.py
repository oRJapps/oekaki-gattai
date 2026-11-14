# bump.py
# 公開する前に1回実行する。読みこむファイルの名前のうしろに ?v=番号 をつけ直す。
#
# 理由：GitHub Pages はファイルを10分間ブラウザに覚えさせる（Cache-Control: max-age=600）。
# 番号を変えると、ブラウザは「別のファイル」として読み直すので、再読み込みだけで新しい版になる。
#
# 使い方（oekaki-web フォルダで）: python tools/bump.py
import io, re, time, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
version = time.strftime("%Y%m%d%H%M%S")

def rewrite(name, pattern, repl):
    path = os.path.join(root, name)
    text = io.open(path, encoding="utf-8").read()
    new, count = re.subn(pattern, repl, text)
    io.open(path, "w", encoding="utf-8", newline="\n").write(new)
    return count

n = 0
# index.html：スタイルと、最初に読むプログラム
n += rewrite("index.html", r'href="style\.css(\?v=\d+)?"', 'href="style.css?v=%s"' % version)
n += rewrite("index.html", r'src="app\.js(\?v=\d+)?"', 'src="app.js?v=%s"' % version)
# プログラムの中の import（'./xxx.js' の形だけ）
for name in ["app.js", "net.js"]:
    n += rewrite(name, r"from '\./([a-z]+)\.js(\?v=\d+)?'", lambda m: "from './%s.js?v=%s'" % (m.group(1), version))
# 通信の部品
n += rewrite("net.js", r"tag\.src = 'vendor/supabase\.js(\?v=\d+)?'", "tag.src = 'vendor/supabase.js?v=%s'" % version)
print("version", version, "- rewrote", n, "places")
