#!/usr/bin/env python3
"""Đóng gói bản bán trên Chrome Web Store từ thư mục extension/ (bản cá nhân giữ nguyên).

    python3 tools/build-store.py            → dist/store/ (nạp thử "Load unpacked") + dist/song-ngu-thuyet-minh-<ver>.zip (tải lên store)

Khác bản cá nhân:
  - YSN_EDITION = 'store': miễn phí 30 phút/ngày, Pro (Lemon Squeezy) không giới hạn; cấu hình lấy từ store/config.json
  - tên mới (không dùng "YouTube" làm tên), bỏ trang thử localhost, bỏ dev-mode.json (kênh test)
  - không có giọng offline Piper/MMS (dữ liệu huấn luyện cấm thương mại) — xử lý trong content/voices.js + service worker
    theo YSN_EDITION; không kèm ONNX runtime (offscreen/vendor/ort*)
  - kèm LICENSE (GPL-3.0, vì đóng gói espeak-ng) + NOTICE (thư viện bên thứ ba, nơi lấy mã nguồn)
Không xoá file nào: chỉ ghi đè trong dist/store/; gói zip luôn dựng lại đúng danh sách file từ extension/.
"""
import json, re, shutil, sys, zipfile, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'extension'
TEST = '--test' in sys.argv          # bản để test tự động: cửa hàng giả (id 111), không tạo zip
OUT = ROOT / 'dist' / ('store-test' if TEST else 'store')
cfg = json.loads((ROOT / 'store' / 'config.json').read_text(encoding='utf-8'))
ls = cfg['lemonSqueezy']
if TEST:
    ls = {'storeId': 111, 'productIds': [222], 'variants': {'monthly': 1, 'yearly': 2, 'lifetime': 3},
          'checkout': {k: f'https://test.lemonsqueezy.com/buy/{k}' for k in ('monthly', 'yearly', 'lifetime')}}

SKIP = {'dev-mode.json'}
# bản store không có giọng offline → không kèm ONNX runtime (offscreen/tts.js chỉ nạp nó khi cần)
SKIP_STORE = re.compile(r'^offscreen/vendor/ort[.-]')
files = sorted(p for p in SRC.rglob('*') if p.is_file() and p.name not in SKIP and not p.name.startswith('.')
               and not SKIP_STORE.match(p.relative_to(SRC).as_posix()))

def transform(rel, data):
    if rel == 'edition.js':
        s = data.decode('utf-8')
        s, n = re.subn(r"var YSN_EDITION = '[a-z]+';", "var YSN_EDITION = 'store';", s)
        assert n == 1, 'không tìm thấy YSN_EDITION'
        pro = {
            'freeMinutes': cfg['freeMinutes'], 'storeId': ls['storeId'], 'productIds': ls['productIds'],
            'variants': ls['variants'], 'checkout': ls['checkout'], 'prices': cfg['prices'], 'support': cfg.get('support', ''),
        }
        # ghi đè từng khoá trong YSN_PRO (giữ nguyên các khoá khác + chú thích)
        for k, v in pro.items():
            s, n = re.subn(r"(\n  %s: )[^\n]*?(,\s*(//[^\n]*)?\n)" % re.escape(k), lambda m: m.group(1) + json.dumps(v, ensure_ascii=False) + m.group(2), s, count=1)
            assert n == 1, 'không tìm thấy YSN_PRO.' + k
        return s.encode('utf-8')
    if rel == 'manifest.json':
        m = json.loads(data.decode('utf-8'))
        m['version'] = cfg['version']
        m['name'] = cfg['name']
        m['short_name'] = cfg['shortName']
        m['description'] = cfg['description']
        m['action']['default_title'] = cfg['shortName']
        for cs in m['content_scripts']:
            cs['matches'] = [x for x in cs['matches'] if not re.match(r'https?://(127\.0\.0\.1|localhost)/', x)]
        return (json.dumps(m, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    if rel == 'offscreen/vendor/THIRD_PARTY_NOTICES.txt':
        return (ROOT / 'store' / 'NOTICE.txt').read_bytes()
    return data

entries = {}
for p in files:
    rel = p.relative_to(SRC).as_posix()
    entries[rel] = transform(rel, p.read_bytes())
entries['LICENSE'] = (ROOT / 'LICENSE').read_bytes()
entries['NOTICE.txt'] = (ROOT / 'store' / 'NOTICE.txt').read_bytes()

# kiểm tra nhanh
man = json.loads(entries['manifest.json'])
assert 'youtube' not in man['name'].lower(), 'tên không được chứa YouTube'
assert len(man['name']) <= 75 and len(man['description']) <= 132, 'tên ≤ 75, mô tả ≤ 132 ký tự'
assert b"YSN_EDITION = 'store'" in entries['edition.js']
assert 'dev-mode.json' not in entries
assert not any(SKIP_STORE.match(k) for k in entries)

OUT.mkdir(parents=True, exist_ok=True)
for rel, data in entries.items():
    dst = OUT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists() or dst.read_bytes() != data:
        dst.write_bytes(data)
stale = sorted(p.relative_to(OUT).as_posix() for p in OUT.rglob('*') if p.is_file() and p.relative_to(OUT).as_posix() not in entries)

if TEST:
    print(f"OK  {len(entries)} file → {OUT.relative_to(ROOT)}/ (bản test, cửa hàng giả 111)"); sys.exit(0)
zpath = ROOT / 'dist' / f"song-ngu-thuyet-minh-{cfg['version']}.zip"
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for rel in sorted(entries):
        z.writestr(zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0)), entries[rel], zipfile.ZIP_DEFLATED)
size = zpath.stat().st_size
print(f"OK  {len(entries)} file → dist/store/  +  {zpath.relative_to(ROOT)}  ({size/1e6:.1f} MB, sha1 {hashlib.sha1(zpath.read_bytes()).hexdigest()[:12]})")
print(f"    tên: {man['name']}  ·  phiên bản {man['version']}  ·  Lemon Squeezy store {ls['storeId'] or 'CHƯA CẤU HÌNH'}")
if stale: print('    (file cũ không còn trong bản mới, nằm thừa trong dist/store/ — xoá tay nếu cần):', ', '.join(stale))
