import sys; sys.path.insert(0, 'tools')
from midi_helpers import NoteBuilder, new_midi, held_runs, midi

BPM, TPB = 164, 480
mid = new_midi(BPM, TPB)
BAR = 4.0

# 16 bars: A section 8 (Am F C G twice), B section 8 (Dm E Am G / Dm E Am E -> tension back to Am)
chords = (['Am','F','C','G']*2) + (['Dm','E','Am','G'] + ['Dm','E','Am','E'])
voicing = {
 'Am': ['A3','C4','E4'], 'F': ['F3','A3','C4'],
 'C':  ['C4','E4','G4'], 'G': ['G3','B3','D4'],
 'Dm': ['D4','F4','A4'], 'E': ['E3','G#3','B3'],
}
root = {'Am':'A1','F':'F1','C':'C2','G':'G1','Dm':'D2','E':'E1'}

# ---------- LEAD: Sawtooth Lead (80) driving riff ----------
lead = NoteBuilder(0, 80, TPB, pan=60, rev=30, vol=102, seed=21)
riff = {}
riff['Am'] = ['A4','E5','C5','A4','G4','A4','C5','E5']
riff['F']  = ['F4','C5','A4','F4','E4','F4','A4','C5']
riff['C']  = ['C5','G5','E5','C5','G4','C5','E5','G5']
riff['G']  = ['G4','D5','B4','G4','F4','G4','B4','D5']
riff['Dm'] = ['D4','A4','F4','D4','C4','D4','F4','A4']
riff['E']  = ['E4','B4','G#4','E4','D4','E4','G#4','B4']
for b in range(16):
    ch = chords[b]
    seq = riff[ch]
    f = 0.55 if b == 15 else 1.0
    for i, n in enumerate(seq):
        dur = 0.45 if i % 2 == 0 else 0.4
        if b == 15 and i >= 6: continue   # let the tail breathe at seam
        lead.note(b*BAR + i*0.5, n, dur, vel=int(92*f), gate=0.88, hum=5, vvar=5)
lead.swell(64, base=84, amp=20, period_bars=8, beats_per_bar=4)

# ---------- OCTAVE layer: Square Lead (79), doubles lead an octave up ----------
oct = NoteBuilder(1, 79, TPB, pan=70, rev=26, vol=70, seed=22)
for b in range(16):
    ch = chords[b]
    seq = riff[ch]
    # only strong beats (even 8ths) doubled for punch, octave up
    for i in (0, 2, 4, 6):
        n = seq[i]
        up = n[:-1] + str(int(n[-1])+1)
        oct.note(b*BAR + i*0.5, up, 0.4, vel=74, gate=0.85, hum=5, vvar=6)
oct.swell(64, base=70, amp=14, period_bars=8, beats_per_bar=4)

# ---------- BASS: Synth Bass2 (38) 16th pump (root 8ths + octave 16th offbeats) ----------
bass = NoteBuilder(2, 38, TPB, pan=64, rev=18, vol=96, seed=23)
for b in range(16):
    r = root[chords[b]]
    r8 = r[:-1] + str(int(r[-1])+1)   # octave up
    f = 0.5 if b == 15 else 1.0
    for i in range(8):                 # 8th roots
        if b == 15 and i >= 6: continue
        bass.note(b*BAR + i*0.5, r, 0.4, vel=int(84*f), gate=0.8, hum=4, vvar=5)
    for i in range(8):                 # 16th offbeat octaves
        if b == 15 and i >= 6: continue
        bass.note(b*BAR + i*0.5 + 0.25, r8, 0.2, vel=int(70*f), gate=0.7, hum=4, vvar=6)
bass.swell(64, base=80, amp=14, period_bars=8, beats_per_bar=4)

# ---------- ORGAN stabs (17): short chord stabs on downbeats ----------
org = NoteBuilder(3, 17, TPB, pan=50, rev=24, vol=86, seed=24)
for b in range(16):
    ch = chords[b]
    v = voicing[ch]
    for k in (0, 2):                    # stabs on beats 1 & 3
        for n in v:
            org.note(b*BAR + k, n, 0.6, vel=78, gate=0.6, hum=6, vvar=6)
org.swell(64, base=74, amp=14, period_bars=8, beats_per_bar=4)

# ---------- DRUMS ch9: four-on-floor kick, 16th hats, snare 2&4, crash /4 bars ----------
dr = NoteBuilder(9, 0, TPB, pan=64, rev=16, vol=108, seed=25)
for b in range(16):
    for k in range(4):
        dr.note(b*BAR + k, 36, 0.4, vel=100, gate=0.55, hum=3, vvar=3)
    for i in range(16):                 # 16th closed hats
        dr.note(b*BAR + i*0.25, 42, 0.18, vel=64 if i%2==0 else 44, gate=0.45, hum=2, vvar=7)
    for k in (1, 3):
        dr.note(b*BAR + k, 38, 0.4, vel=94, gate=0.7, hum=3, vvar=4)
    if b % 4 == 0:                      # crash each 4 bars
        dr.note(b*BAR, 49, 1.2, vel=88, gate=0.9, hum=3, vvar=5)
    if b % 2 == 1 and b < 15:           # open hat on offbeat 4.5 for drive
        dr.note(b*BAR + 3.5, 46, 0.4, vel=66, gate=0.5, hum=3, vvar=6)

for nb in (lead, oct, bass, org, dr):
    mid.tracks.append(nb.track())
mid.save('battle.mid')
print('battle.mid written, bars=16 beats=64')
