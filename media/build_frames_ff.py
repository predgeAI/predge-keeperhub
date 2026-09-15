#!/usr/bin/env python3
"""Render demo-video frames as PNG using ffmpeg drawbox+drawtext (arm64-native)."""
import os, subprocess, shutil

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "frames")
TXT = os.path.join(BASE, "txt")
if os.path.exists(TXT): shutil.rmtree(TXT)
os.makedirs(OUT, exist_ok=True); os.makedirs(TXT, exist_ok=True)

W, H = 1920, 1080
MONO = "/System/Library/Fonts/Menlo.ttc"
SANS = "/System/Library/Fonts/HelveticaNeue.ttc"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

BG = "0x0b0f14"; FG = "0xe6edf3"; DIM = "0x8b98a5"
AMBER = "0xf5a623"; GREEN = "0x3ecf8e"; RED = "0xff5c5c"; CYAN = "0x4cc9f0"

_ctr = [0]
def _tf(text):
    _ctr[0] += 1
    p = os.path.join(TXT, f"t{_ctr[0]}.txt")
    open(p, "w").write(text)
    return p

def T(text, x, y, size, color=FG, font=SANS, anchor="l"):
    """drawtext piece. anchor 'l'=left at x, 'c'=centered on x, 'r'=right at x."""
    xf = {"l": str(x), "c": f"({x}-text_w/2)", "r": f"({x}-text_w)"}[anchor]
    return (f"drawtext=fontfile='{font}':textfile='{_tf(text)}':x={xf}:y={y-size}:"
            f"fontsize={size}:fontcolor={color}")

def BOX(x, y, w, h, color):
    return f"drawbox=x={x}:y={y}:w={w}:h={h}:color={color}:t=fill"

def render(name, bg, parts):
    vf = ",".join(parts)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-f", "lavfi", "-i", f"color=c={bg}:s={W}x{H}:d=1",
           "-vf", vf, "-frames:v", "1", os.path.join(OUT, name)]
    subprocess.run(cmd, check=True)
    print("wrote", name)

def bar():  # top accent bar + footer label
    return [BOX(0, 0, W, 6, AMBER), T("Predge x KeeperHub", W-60, H-40, 24, DIM, SANS, "r")]

def termwin(title, lines, top):
    x, w = 210, W-420
    n = len(lines)
    h = 90 + n*60 + 40
    p = [BOX(x, top, w, h, "0x0d1117"),
         BOX(x, top, w, 56, "0x161b22"),
         BOX(x, top, 6, h, "0x232a33"),
         T(title, x+w//2, top+38, 26, DIM, MONO, "c")]
    for i, c in enumerate(["0xff5f56", "0xffbd2e", "0x27c93f"]):
        p.append(BOX(x+26+i*30, top+22, 16, 16, c))
    ty = top+120
    for s, col, sz in lines:
        if s: p.append(T(s, x+40, ty, sz, col, MONO, "l"))
        ty += 60
    return p

# 1 TITLE
render("01_title.png", BG, bar() + [
    T("PREDGE", W//2, 300, 150, AMBER, BOLD, "c"),
    T("x  KEEPERHUB", W//2, 430, 92, FG, SANS, "c"),
    T("Verified signal in.  Deterministic execution out.", W//2, 560, 46, CYAN, SANS, "c"),
    T("Agent Economy Hackathon", W//2, 720, 34, DIM, SANS, "c"),
    T("Best Integration into a Live Project", W//2, 772, 34, DIM, SANS, "c"),
])

# 2 THE GAP
render("02_gap.png", BG, bar() + [
    T("Agents are probabilistic.", 160, 260, 72, FG, BOLD, "l"),
    T("On-chain, that does not forgive.", 160, 350, 44, DIM, SANS, "l"),
    T("KeeperHub", 160, 560, 60, GREEN, BOLD, "l"),
    T("makes the execution deterministic.", 160, 625, 44, FG, SANS, "l"),
    T("Predge", 160, 770, 60, AMBER, BOLD, "l"),
    T("makes the input verifiable.", 160, 835, 44, FG, SANS, "l"),
    T("Two halves of the same problem.", 160, 960, 40, CYAN, SANS, "l"),
])

# 3 ARCHITECTURE
def node(x, w, label, sub, col):
    p = [BOX(x, 470, w, 150, "0x0d1117"), BOX(x, 470, w, 6, col)]
    p.append(T(label, x+w//2, 548, 38, col, BOLD, "c"))
    p.append(T(sub, x+w//2, 595, 24, DIM, MONO, "c"))
    return p
arch = bar() + [T("One loop, closed from both ends", W//2, 250, 54, FG, BOLD, "c")]
arch += node(150, 340, "Predge", "sign (ed25519)", AMBER)
arch += node(600, 340, "Agent", "verify offline", CYAN)
arch += node(1050, 340, "Gate", "conviction >= 70", FG)
arch += node(1500, 270, "KeeperHub", "dry-run -> exec", GREEN)
arch += [T("->", 520, 555, 50, DIM, SANS, "c"), T("->", 970, 555, 50, DIM, SANS, "c"), T("->", 1420, 555, 50, DIM, SANS, "c")]
arch += [T("The signal is proven before a single dollar moves.", W//2, 780, 38, DIM, SANS, "c")]
render("03_arch.png", BG, arch)

# 4 TERMINAL VERIFIED
render("04_verified.png", BG, bar()
    + [T("$ npm run integrate", 210, 190, 38, DIM, MONO, "l")]
    + termwin("agent  -  verify Predge signal", [
        ("[ok] VERIFIED Predge signal", GREEN, 44),
        ("  wallet=0x1f98...f984   conviction=82", FG, 36),
        ("  action=accumulate   window=30d", FG, 36),
        ("", FG, 36),
        ("gate: accumulate & conviction >= 70  ->  CLEARED", CYAN, 38),
    ], 250))

# 5 TERMINAL EXECUTED
render("05_executed.png", BG, bar()
    + termwin("KeeperHub  -  deterministic execution", [
        ("dry-run (simulate, no chain)...  clean", DIM, 36),
        ("", FG, 36),
        ("EXECUTED through KeeperHub", GREEN, 46),
        ("  status: completed", FG, 36),
        ("  tx: 0xe896de00...cff38307", AMBER, 36),
    ], 220)
    + [T("Verified signal in, deterministic execution out.", W//2, 960, 38, CYAN, SANS, "c")])

# 6 ETHERSCAN PROOF
card = [BOX(210, 150, 1500, 810, "0xf7f9fb"), BOX(210, 150, 1500, 88, "0xe8eef4"),
        T("Sepolia Testnet  -  Transaction", 260, 210, 40, "0x21325b", BOLD, "l"),
        T("sepolia.etherscan.io", 1660, 208, 28, "0x3498db", MONO, "r")]
rows = [
    ("Status", "Success", "0x00a186", SANS, 34),
    ("Block", "11708563", "0x1a1a1a", MONO, 32),
    ("Txn hash", "0xe896de001abb6fe6ef0bffd06f5eb8b821d0b308c65ae2c3ccdf5bb2cff38307", "0x1a1a1a", MONO, 24),
    ("Action", "Transfer 0.00082 ETH  -  EIP-7702 smart account", "0x1a1a1a", SANS, 30),
    ("To", "0xd023...E03f   -> balance now 0.00082 ETH (received)", "0x00a186", MONO, 28),
    ("From", "0xA17c...  KeeperHub relayer  (gas sponsored)", "0x1a1a1a", MONO, 28),
    ("Txn fee", "0.000075 ETH  -  paid by KeeperHub, not the agent", "0xc0392b", SANS, 30),
]
y = 330
for k, v, c, f, s in rows:
    card += [T(k, 260, y, 28, "0x8a95a5", SANS, "l"), T(v, 700, y, s, c, f, "l")]
    y += 88
render("06_etherscan.png", BG, bar() + card)

# 7 TAMPER
render("07_tamper.png", BG, bar()
    + [T("$ npm run integrate -- --tamper", 210, 190, 38, DIM, MONO, "l")]
    + termwin("agent  -  tampered signal", [
        ("(conviction flipped 82 -> 99 after signing)", DIM, 32),
        ("", FG, 32),
        ("[X] REJECTED: signature does not match payload", RED, 42),
        ("", FG, 32),
        ("KeeperHub is never called.", FG, 40),
    ], 250)
    + [T("No verified signal, no execution.", W//2, 960, 38, RED, SANS, "c")])

# 8 CLOSE
render("08_close.png", BG, bar() + [
    T("PREDGE  x  KEEPERHUB", W//2, 350, 88, AMBER, BOLD, "c"),
    T("Verified signal in.  Deterministic execution out.", W//2, 470, 48, FG, SANS, "c"),
    T("live proof on Sepolia   -   agent-authored via MCP   -   tamper-safe", W//2, 630, 32, GREEN, SANS, "c"),
    T("github.com/predgeAI/predge-keeperhub", W//2, 780, 40, CYAN, MONO, "c"),
])

print("all frames done")
