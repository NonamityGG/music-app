"""Creates small MP3 files with different tag flavours for the tag-reader tests."""
import os
import subprocess
import sys
from mutagen.id3 import ID3, TIT2, TPE1, TALB, APIC, ID3NoHeaderError
from mutagen.mp3 import MP3

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
base = os.path.join(out, "silence.mp3")
subprocess.run(
    ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "3", "-b:a", "64k", base],
    check=True,
)

# tiny JPEG cover
cover_path = os.path.join(out, "cover.jpg")
subprocess.run(
    ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=purple:s=64x64", "-frames:v", "1", cover_path],
    check=True,
)
cover = open(cover_path, "rb").read()


def fresh(name):
    p = os.path.join(out, name)
    with open(base, "rb") as src, open(p, "wb") as dst:
        dst.write(src.read())
    try:
        ID3(p).delete()
    except ID3NoHeaderError:
        pass
    return p


# v2.4, UTF-8, with cover
p = fresh("v24_utf8.mp3")
t = ID3()
t.add(TIT2(encoding=3, text="Кукла колдуна"))
t.add(TPE1(encoding=3, text=["Король и Шут"]))
t.add(TALB(encoding=3, text="Камнем по голове"))
t.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Обложка", data=cover))
t.save(p, v2_version=4)

# v2.3, UTF-16 with BOM
p = fresh("v23_utf16.mp3")
t = ID3()
t.add(TIT2(encoding=1, text="Группа крови"))
t.add(TPE1(encoding=1, text="Кино"))
t.add(APIC(encoding=1, mime="image/jpeg", type=3, desc="cover", data=cover))
t.save(p, v2_version=3)

# v2.3 claiming Latin-1 but holding Windows-1251 bytes (common in old Russian rips)
p = fresh("v23_cp1251.mp3")
t = ID3()
t.add(TIT2(encoding=0, text="placeholder"))
t.add(TPE1(encoding=0, text="placeholder"))
t.save(p, v2_version=3)
raw = open(p, "rb").read()
raw = raw.replace("placeholder".encode("latin1"), "Звезда_____".encode("cp1251"), 1)
raw = raw.replace("placeholder".encode("latin1"), "Цой________".encode("cp1251"), 1)
open(p, "wb").write(raw)

# no tags, name carries the info
p = fresh("Linkin Park - Numb.mp3")

# ID3v1 only
p = fresh("v1only.mp3")
with open(p, "ab") as f:
    tag = b"TAG" + b"Numb".ljust(30, b"\0") + b"Linkin Park".ljust(30, b"\0") + b"Meteora".ljust(30, b"\0") + b"2003" + b"\0" * 30 + b"\x0c"
    f.write(tag)

print("fixtures ready")
