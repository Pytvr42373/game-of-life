import sys; sys.path.insert(0, 'tools')
from midi_helpers import NoteBuilder, new_midi, held_runs, midi

BPM, TPB = 172, 480
mid = new_midi(BPM, TPB)
BAR = 4.0

# 16 bars, E minor dark: Em C D Em x2 | C D Em B x2 (ends on B = V tension)
chords = (['Em','C','D','Em']*2) + (['C','D','Em','B']*2)
voicing = {
 'Em': ['E3','G3','B3'], 'C': ['C4','E4','G4'],
 'D':  ['D4','F#4','A4'], 'B': ['B3','D#4','F#4'],
}
root = {'Em':'E1','C':'C2','D':'D2','B':'B1'}

# ---------- LEAD: Sawtooth (80) driving, darker riff ----------
lead = NoteBuilder(0, 80, TPB, pan=58, rev=32, vol=104, seed=41)
riff = {}
riff['Em'] = ['E4','B4','G4','E4','D4','E4','G4','B4']
riff['C']  = ['C5','G5','E5','C5','B4','C5','E5','G5']
riff['D']  = ['D4','A4','F#4','D4','C4','D4','F#4','A4']
riff['B']  = ['B4','F#5','D#5','B4','A4','B4','D#5','F#5']
for b in range(16):
    ch = chords[b]
    seq = riff[ch]
    f = 0.6 if b == 15 else 1.0
    for i, n in enumerate(seq):
        if b == 15 and i >= 6: continue
        dur = 0.45 if i % 2 == 0 else 0.4
        lead.note(b*BAR + i*0.5, n, dur, vel=int(96*f), gate=0.88, hum=5, vvar=5)
lead.swell(64, base=88, amp=18, period_bars=8, beats_per_bar=4)

# ---------- BASS: Synth Bass2 (38) 16th pump, lower octave menace ----------
bass = NoteBuilder(2, 38, TPB, pan=64, rev=18, vol=98, seed=43)
for b in range(16):
    r = root[chords[b]]
    r8 = r[:-1] + str(int(r[-1])+1)
    f = 0.55 if b == 15 else 1.0
    for i in range(8):
        if b == 15 and i >= 6: continue
        bass.note(b*BAR + i*0.5, r, 0.4, vel=int(86*f), gate=0.8, hum=4, vvar=5)
    for i in range(8):
        if b == 15 and i >= 6: continue
        bass.note(b*BAR + i*0.5 + 0.25, r8, 0.2, vel=int(72*f), gate=0.7, hum=4, vvar=6)
bass.swell(64, base=82, amp=12, period_bars=8, beats_per_bar=4)

# ---------- ORGAN stabs (17): heavy downbeats ----------
org = NoteBuilder(3, 17, TPB, pan=52, rev=26, vol=90, seed=44)
for b in range(16):
    ch = chords[b]
    v = voicing[ch]
    f = 0.6 if b == 15 else 1.0
    for k in (0, 2):
        for n in v:
            org.note(b*BAR + k, n, 0.6, vel=int(82*f), gate=0.6, hum=6, vvar=6)
org.swell(64, base=78, amp=12, period_bars=8, beats_per_bar=4)

# ---------- DRUMS ch9: heavy four-on-floor + 16th hats, crash /4 ----------
dr = NoteBuilder(9, 0, TPB, pan=64, rev=16, vol=110, seed=45)
for b in range(16):
    for k in range(4):
        dr.note(b*BAR + k, 36, 0.4, vel=104, gate=0.55, hum=3, vvar=3)
    for i in range(16):
        if b == 15 and i >= 12: continue
        dr.note(b*BAR + i*0.25, 42, 0.18, vel=66 if i%2==0 else 46, gate=0.45, hum=2, vvar=7)
    for k in (1, 3):
        if b == 15 and k == 3: continue
        dr.note(b*BAR + k, 38, 0.4, vel=96, gate=0.7, hum=3, vvar=4)
    if b % 4 == 0:
        dr.note(b*BAR, 49, 1.2, vel=90, gate=0.9, hum=3, vvar=5)
    if b % 2 == 1 and b < 15:
        dr.note(b*BAR + 3.5, 46, 0.4, vel=68, gate=0.5, hum=3, vvar=6)

for nb in (lead, bass, org, dr):
    mid.tracks.append(nb.track())
mid.save('boss.mid')
print('boss.mid written, bars=16 beats=64')
