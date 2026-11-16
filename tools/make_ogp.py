# make_ogp.py
# X などに URL を貼ったときに出る紹介カードの画像（1200x630）を作る。
# 使い方: python make_ogp.py <タイトル用フォント.ttf> <出力先.png>
import sys, math, random
from PIL import Image, ImageDraw, ImageFont

FONT_TITLE = sys.argv[1]
OUT = sys.argv[2]
FONT_BODY = "C:/Windows/Fonts/meiryob.ttc"

S = 2  # 2倍の大きさで描いて、最後に半分にする（線をなめらかにする）
W, H = 1200 * S, 630 * S
INK = (10, 15, 46)
GOLD, PINK, SKY, GREEN, ORANGE, RED = (255, 201, 40), (255, 93, 143), (62, 197, 255), (61, 220, 132), (255, 154, 60), (255, 82, 82)
PAPER = (255, 253, 245)

def font(path, size):
    return ImageFont.truetype(path, size * S)

# ---------- 背景 ----------
img = Image.new("RGB", (W, H), INK)
d = ImageDraw.Draw(img)
top, mid, bot = (30, 46, 132), (16, 26, 77), (10, 16, 56)
for y in range(H):
    t = y / H
    a, b, k = (top, mid, t / 0.55) if t < 0.55 else (mid, bot, (t - 0.55) / 0.45)
    d.line([(0, y), (W, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3)))
for y in range(0, H, 26 * S):
    for x in range(0, W, 26 * S):
        d.ellipse([x, y, x + 3 * S, y + 3 * S], fill=(44, 60, 140))

# らくがき（うすく）
random.seed(7)
layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ld = ImageDraw.Draw(layer)
for i in range(26):
    x, y, r = random.randint(0, W), random.randint(0, H), random.randint(18, 40) * S
    color = [GOLD, PINK, SKY, GREEN, ORANGE][i % 5] + (70,)
    kind = i % 4
    if kind == 0:
        pts = [(x + math.cos(-math.pi / 2 + k * math.pi * 4 / 5) * r, y + math.sin(-math.pi / 2 + k * math.pi * 4 / 5) * r) for k in range(6)]
        ld.line(pts, fill=color, width=5 * S, joint="curve")
    elif kind == 1:
        ld.ellipse([x - r, y - r, x + r, y + r], outline=color, width=5 * S)
    elif kind == 2:
        ld.line([(x - r, y - r), (x + r, y + r)], fill=color, width=5 * S)
        ld.line([(x + r, y - r), (x - r, y + r)], fill=color, width=5 * S)
    else:
        ld.line([(x, y - r), (x + r, y + r * 0.8), (x - r, y + r * 0.8), (x, y - r)], fill=color, width=5 * S, joint="curve")
img.paste(layer, (0, 0), layer)
d = ImageDraw.Draw(img)

def sticker(text, fnt, fill, stroke=7, shadow=9, angle=0):
    """ふちどり＋下の影つきの文字を、1枚の絵にして返す"""
    box = d.textbbox((0, 0), text, font=fnt, stroke_width=stroke * S)
    w, h = box[2] - box[0] + 40 * S, box[3] - box[1] + 60 * S
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    td = ImageDraw.Draw(im)
    ox, oy = 20 * S - box[0], 20 * S - box[1]
    td.text((ox, oy + shadow * S), text, font=fnt, fill=INK, stroke_width=stroke * S, stroke_fill=INK)
    td.text((ox, oy), text, font=fnt, fill=fill, stroke_width=stroke * S, stroke_fill=INK)
    return im.rotate(angle, resample=Image.BICUBIC, expand=True) if angle else im

def paste(im, x, y):
    img.paste(im, (int(x), int(y)), im)

# ---------- タイトル ----------
title_font = font(FONT_TITLE, 92)
x = 44 * S
for i, ch in enumerate("お絵かき合体"):
    color = [GOLD, PINK, SKY, GREEN, ORANGE, GOLD][i]
    im = sticker(ch, title_font, color, stroke=8, shadow=11, angle=(2.5 - i) * 2.2)
    paste(im, x, (44 + (8 if i % 2 else 0)) * S)
    x += im.width - 44 * S

def pill(text, fnt, x, y, bg, fg=INK, pad=(22, 10), angle=0, border=4):
    box = d.textbbox((0, 0), text, font=fnt)
    w, h = box[2] - box[0] + pad[0] * 2 * S, box[3] - box[1] + pad[1] * 2 * S
    im = Image.new("RGBA", (w + 12 * S, h + 18 * S), (0, 0, 0, 0))
    pd = ImageDraw.Draw(im)
    r = h // 2
    pd.rounded_rectangle([6 * S, 10 * S, 6 * S + w, 10 * S + h], radius=r, fill=INK)          # 影
    pd.rounded_rectangle([6 * S, 4 * S, 6 * S + w, 4 * S + h], radius=r, fill=bg, outline=INK, width=border * S)
    pd.text((6 * S + pad[0] * S - box[0], 4 * S + pad[1] * S - box[1]), text, font=fnt, fill=fg)
    if angle:
        im = im.rotate(angle, resample=Image.BICUBIC, expand=True)
    paste(im, x * S, y * S)
    return im.width // S

pill("お題を分けて描いて、最後に1枚に合体！", font(FONT_TITLE, 30), 50, 216, PAPER, angle=1.5)

body = font(FONT_BODY, 36)
for n, line in enumerate(["となりの絵は見えないまま", "半分だけ描いて、合体。", "だいたい変な生き物が生まれます。"]):
    d.text((58 * S, (312 + n * 50) * S), line, font=body, fill=(255, 255, 255))

cx = 54
for text, color in [("無料", GOLD), ("登録なし", GREEN), ("スマホOK", SKY), ("3分で遊べる", PINK)]:
    cx += pill(text, font(FONT_TITLE, 28), cx, 482, color) + 6

d.text((58 * S, 572 * S), "orjapps.github.io/oekaki-gattai", font=font(FONT_BODY, 26), fill=(195, 203, 239))

# ---------- 右：合体した絵のカード ----------
CX, CY, CS = 826, 176, 316          # カードの左上と、絵の一辺
P = 14                               # 紙のふちの幅
card = [CX - P, CY - P, CX + CS + P, CY + CS + P]
d.rounded_rectangle([c * S + (0 if i < 2 else 0) for i, c in enumerate([card[0], card[1] + 12, card[2], card[3] + 12])], radius=22 * S, fill=INK)
d.rounded_rectangle([c * S for c in card], radius=22 * S, fill=PAPER, outline=INK, width=6 * S)
d.rounded_rectangle([(CX + CS / 2 - 48) * S, (CY - P - 14) * S, (CX + CS / 2 + 48) * S, (CY - P + 10) * S], radius=8 * S, fill=PINK, outline=INK, width=5 * S)
d.rectangle([CX * S, CY * S, (CX + CS) * S, (CY + CS) * S], fill=(255, 255, 255))

def art():
    """1000x1000 の座標で描く透明な絵（上半分用と下半分用に使う）"""
    im = Image.new("RGBA", (1000, 1000), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)

GRAY, BLACK, BLUE, YELLOW, BROWN = (138, 143, 152, 255), (30, 30, 30, 255), (30, 136, 229, 255), (249, 168, 37, 255), (121, 85, 72, 255)

# 上半分：ネコの頭
top_im, t = art()
t.ellipse([200, 190, 800, 760], outline=GRAY, width=16)
t.line([(262, 330), (250, 110), (420, 240)], fill=GRAY, width=16, joint="curve")
t.line([(738, 330), (750, 110), (580, 240)], fill=GRAY, width=16, joint="curve")
t.ellipse([372, 372, 428, 428], fill=BLACK)
t.ellipse([572, 372, 628, 428], fill=BLACK)
t.polygon([(476, 452), (524, 452), (500, 482)], fill=(236, 106, 156, 255))
for sx in (1, -1):
    t.line([(500 + sx * 120, 462), (500 + sx * 300, 430)], fill=BLACK, width=8)
    t.line([(500 + sx * 120, 486), (500 + sx * 300, 492)], fill=BLACK, width=8)

# 下半分：ロボットの体
bot_im, b = art()
b.rectangle([300, 470, 700, 800], outline=GRAY, width=16)
b.ellipse([440, 580, 560, 700], outline=YELLOW, width=12)
b.line([(400, 745), (600, 745)], fill=BLACK, width=10)
b.line([(300, 540), (170, 540), (170, 740)], fill=GRAY, width=16, joint="curve")
b.line([(700, 540), (830, 540), (830, 740)], fill=GRAY, width=16, joint="curve")
b.line([(400, 800), (400, 930), (330, 930)], fill=GRAY, width=16, joint="curve")
b.line([(600, 800), (600, 930), (670, 930)], fill=GRAY, width=16, joint="curve")
b.ellipse([155, 725, 185, 755], fill=BLUE)
b.ellipse([815, 725, 845, 755], fill=BLUE)

merged = Image.new("RGBA", (1000, 1000), (0, 0, 0, 0))
merged.paste(top_im.crop((0, 0, 1000, 500)), (0, 0))
merged.paste(bot_im.crop((0, 500, 1000, 1000)), (0, 500))
md = ImageDraw.Draw(merged)
for x0 in range(0, 1000, 44):                      # 区切りの点線
    md.line([(x0, 500), (x0 + 22, 500)], fill=(0, 0, 0, 60), width=5)
merged = merged.resize((CS * S, CS * S), Image.LANCZOS)
img.paste(merged, (CX * S, CY * S), merged)

paste(sticker("合体！", font(FONT_TITLE, 56), RED, stroke=6, shadow=8, angle=8), (CX + CS - 236) * S, (CY - 150) * S)
lx = CX - 6
lx += pill("上：あなた", font(FONT_BODY, 24), lx, CY + CS + 30, (28, 43, 110), fg=(255, 255, 255), pad=(16, 8), border=3) + 4
pill("下：ともだち", font(FONT_BODY, 24), lx, CY + CS + 30, (28, 43, 110), fg=(255, 255, 255), pad=(16, 8), border=3)

img.resize((1200, 630), Image.LANCZOS).save(OUT, optimize=True)
print("saved", OUT)
