import sys; sys.path.insert(0, 'tools')
from midi_helpers import NoteBuilder, new_midi, midi

BPM, TPB = 108, 480
mid = new_midi(BPM, TPB)
BAR = 4.0

chords = ['F','C','Dm','Bb','F','C','Gm','C']
voicing = {
 'F':  ['F3','A3','C4'], 'C': ['C4','E4','G4'],
 'Dm': ['D4','F4','A4'], 'Bb':['Bb3','D4','F4'],
 'Gm': ['G3','Bb3','D4'],
}
root = {'F':'F2','C':'C3','Dm':'D3','Bb':'Bb2','Gm':'G2'}

# ---------- TRUMPET fanfare (56): heroic motif ----------
tp = NoteBuilder(0, 56, TPB, pan=56, rev=42, vol=100, seed=31)
fanfare = {
 0: [(0,'F4',.5),(.5,'A4',.5),(1,'C5',.5),(1.5,'F5',.5),(2,'A5',1),(3,'G5',.5),(3.5,'E5',.5)],
 1: [(0,'F5',1),(1,'E5',.5),(1.5,'G5',.5),(2,'C6',1),(3,'B5',.5),(3.5,'G5',.5)],
 2: [(0,'A5',1),(1,'F5',.5),(1.5,'A5',.5),(2,'D6',1),(3,'C6',.5),(3.5,'A5',.5)],
 3: [(0,'F5',1),(1,'D5',.5),(1.5,'F5',.5),(2,'A5',1),(3,'G5',.5),(3.5,'F5',.5)],
 4: [(0,'F4',.5),(.5,'A4',.5),(1,'C5',.5),(1.5,'F5',.5),(2,'A5',1),(3,'G5',.5),(3.5,'E5',.5)],
 5: [(0,'F5',1),(1,'E5',.5),(1.5,'G5',.5),(2,'C6',1),(3,'B5',.5),(3.5,'G5',.5)],
 6: [(0,'G4',.5),(.5,'Bb4',.5),(1,'D5',.5),(1.5,'G5',.5),(2,'F5',1),(3,'D5',.5),(3.5,'Bb4',.5)],
 7: [(0,'C5',.5),(.5,'E5',.5),(1,'G5',.5),(1.5,'C6',.5),(2,'G5',.5),(2.5,'C6',.5),(3,'E6',1.5)],
}
for b in range(8):
    for bt, n, d in fanfare[b]:
        tp.note(b*BAR + bt, n, d, vel=90, gate=0.92, hum=6, vvar=5)
tp.swell(32, base=82, amp=18, period_bars=8, beats_per_bar=4)

# ---------- BRASS stabs (61): short block chords ----------
br = NoteBuilder(1, 61, TPB, pan=64, rev=38, vol=82, seed=32)
for b in range(8):
    v = voicing[chords[b]]
    for n in v:
        br.note(b*BAR, n, 1.2, vel=70, gate=0.7, hum=8, vvar=6)
br.swell(32, base=68, amp=12, period_bars=8, beats_per_bar=4)

# ---------- PIANO arpeggio (1): 8th-note broken chords ----------
pn = NoteBuilder(2, 1, TPB, pan=64, rev=46, vol=86, seed=33)
arp = {
 'F':  ['F3','A3','C4','F4','A4','C5','F4','C4'],
 'C':  ['C4','E4','G4','C5','E5','G5','C5','G4'],
 'Dm': ['D4','F4','A4','D5','F5','A5','F5','D5'],
 'Bb': ['Bb3','D4','F4','Bb4','D5','F5','D5','Bb4'],
 'Gm': ['G3','Bb3','D4','G4','Bb4','D5','Bb4','G4'],
}
for b in range(8):
    seq = arp[chords[b]]
    for i, n in enumerate(seq):
        pn.note(b*BAR + i*0.5, n, 0.45, vel=74, gate=0.85, hum=8, vvar=7)
pn.swell(32, base=70, amp=14, period_bars=8, beats_per_bar=4)

# ---------- ELECTRIC BASS (32): 8th roots ----------
bass = NoteBuilder(3, 32, TPB, pan=64, rev=18, vol=90, seed=34)
for b in range(8):
    r = root[chords[b]]
    for i in range(8):
        bass.note(b*BAR + i*0.5, r, 0.42, vel=80, gate=0.82, hum=5, vvar=6)
bass.swell(32, base=76, amp=12, period_bars=8, beats_per_bar=4)

# ---------- DRUMS ch9: light (kick 1&3, snare 2&4, 8th hats, crash start) ----------
dr = NoteBuilder(9, 0, TPB, pan=64, rev=16, vol=100, seed=35)
for b in range(8):
    for k in (0, 2):
        dr.note(b*BAR + k, 36, 0.4, vel=88, gate=0.6, hum=3, vvar=5)
    for k in (1, 3):
        dr.note(b*BAR + k, 38, 0.4, vel=82, gate=0.7, hum=3, vvar=5)
    for i in range(8):
        dr.note(b*BAR + i*0.5, 42, 0.28, vel=50, gate=0.5, hum=4, vvar=8)
dr.note(0, 49, 1.5, vel=92, gate=0.9, hum=3, vvar=4)   # opening crash

for nb in (tp, br, pn, bass, dr):
    mid.tracks.append(nb.track())
mid.save('result.mid')
print('result.mid written, bars=8 beats=32')
