import sys; sys.path.insert(0, 'tools')
from midi_helpers import NoteBuilder, new_midi, held_runs, midi

BPM, TPB = 126, 480
mid = new_midi(BPM, TPB)
BAR = 4.0

# chords per bar (A minor, 16 bars, A A' variation)
chords = ['Am','F','C','G'] * 4
voicing = {
 'Am': ['A3','C4','E4'], 'F': ['F3','A3','C4'],
 'C':  ['C4','E4','G4'], 'G': ['G3','B3','D4'],
}
root = {'Am':'A2','F':'F2','C':'C3','G':'G2'}
varmap = {'Am':'Am','F':'F','C':'C','G':'G'}

# ---------- LEAD: Square Lead (79), short arcade motif ----------
lead = NoteBuilder(0, 79, TPB, pan=64, rev=30, vol=100, seed=11)
mel = {}
mel['Am'] = ['A4','C5','E5','A5','G5','E5','C5','E5']
mel['F']  = ['F4','A4','C5','F5','E5','C5','A4','C5']
mel['C']  = ['G4','C5','E5','G5','D5','C5','E5','C5']
mel['G']  = ['G4','B4','D5','G5','F5','D5','B4','D5']
for b in range(16):
    ch = chords[b]
    seq = mel[ch]
    # pass B (bars 8-15): octave-up variation for lift
    if b >= 8:
        seq = [n[:-1] + str(int(n[-1])+1) for n in seq]
    for i, n in enumerate(seq):
        lead.note(b*BAR + i*0.5, n, 0.45, vel=88, gate=0.9, hum=8, vvar=6)
lead.swell(64, base=80, amp=22, period_bars=8, beats_per_bar=4)

# ---------- CELESTA sparkle (8): high accents ----------
cel = NoteBuilder(1, 8, TPB, pan=88, rev=50, vol=70, seed=12)
spk = [(2, 'E6'), (4.5, 'A5'), (6, 'E6'), (10, 'C6'), (14.5, 'A5'),
       (26, 'E6'), (30.5, 'D6'), (34, 'C6'), (38, 'A5'), (42, 'E6'),
       (50, 'A5'), (54, 'E6'), (58, 'B5'), (62, 'A5')]
for bt, n in spk:
    cel.note(bt, n, 0.5, vel=72, gate=0.85, hum=10, vvar=8)
cel.swell(64, base=66, amp=16, period_bars=8, beats_per_bar=4)

# ---------- BASS: Synth Bass1 (37), 8th-note roots ----------
bass = NoteBuilder(2, 37, TPB, pan=64, rev=20, vol=92, seed=13)
for b in range(16):
    r = root[chords[b]]
    for i in range(8):
        bass.note(b*BAR + i*0.5, r, 0.42, vel=78, gate=0.82, hum=6, vvar=7)
bass.swell(64, base=74, amp=14, period_bars=8, beats_per_bar=4)

# ---------- PAD: Slow Strings (49), held common tones ----------
pad = NoteBuilder(3, 49, TPB, pan=64, vib=16, rev=70, vol=52, seed=14)
vox = [voicing[chords[b]] for b in range(16)]
for start, pitch, dur in held_runs(vox):
    pad.note(start, pitch, dur, vel=42, gate=0.99, hum=20)
pad.swell(64, base=48, amp=22, period_bars=8, beats_per_bar=4)

# ---------- DRUMS ch9: kick every beat, cl hat 8ths, snare 2&4 ----------
dr = NoteBuilder(9, 0, TPB, pan=64, rev=16, vol=104, seed=15)
for b in range(16):
    for k in range(4):                     # kick each beat
        dr.note(b*BAR + k, 36, 0.4, vel=96, gate=0.6, hum=3, vvar=4)
    for i in range(8):                     # closed hat 8ths
        dr.note(b*BAR + i*0.5, 42, 0.3, vel=58, gate=0.5, hum=4, vvar=8)
    for k in (1, 3):                       # snare 2 & 4
        dr.note(b*BAR + k, 38, 0.4, vel=88, gate=0.7, hum=3, vvar=5)

for nb in (lead, cel, bass, pad, dr):
    mid.tracks.append(nb.track())
mid.save('menu.mid')
print('menu.mid written, bars=16 beats=64')
