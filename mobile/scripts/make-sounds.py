"""
Makes Envo Phone's sounds from scratch (no samples, so no licences): four ringtones, the keypad's
DTMF tones, the ringback heard while calling, and a short hang-up chime.

    python3 scripts/make-sounds.py      # writes assets/sounds/*.wav
"""
import math
import os
import struct
import wave

RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sounds')


def write(name, samples):
    os.makedirs(OUT, exist_ok=True)
    peak = max(1e-9, max(abs(s) for s in samples))
    gain = 0.89 / peak
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s * gain)) * 32767)) for s in samples))


def silence(seconds):
    return [0.0] * int(RATE * seconds)


def note(freq, seconds, partials, attack=0.004):
    """A struck tone: (ratio, level, decay per second) partials with a soft attack."""
    out = []
    for i in range(int(RATE * seconds)):
        t = i / RATE
        env_a = min(1.0, t / attack)
        v = 0.0
        for ratio, level, decay in partials:
            v += level * math.exp(-decay * t) * math.sin(2 * math.pi * freq * ratio * t)
        out.append(v * env_a)
    return out


def mix(base, add, at):
    start = int(RATE * at)
    end = start + len(add)
    if end > len(base):
        base.extend([0.0] * (end - len(base)))
    for i, s in enumerate(add):
        base[start + i] += s
    return base


MARIMBA = [(1, 1.0, 5.5), (3.93, 0.28, 14), (9.2, 0.06, 30)]
BELL = [(1, 1.0, 1.6), (2.4, 0.5, 2.6), (4.5, 0.28, 4.2), (5.9, 0.16, 6.5)]
GLASS = [(1, 1.0, 3.2), (2.0, 0.35, 5.0), (3.0, 0.12, 8.0)]

N = {'A4': 440.0, 'B4': 493.88, 'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'F5': 698.46, 'G5': 783.99, 'A5': 880.0, 'B5': 987.77, 'C6': 1046.5, 'D6': 1174.66, 'E6': 1318.51, 'G6': 1567.98}


def melody(steps, timbre, length, note_len=1.2):
    out = silence(length)
    for at, name in steps:
        mix(out, note(N[name], note_len, timbre), at)
    return out[: int(RATE * length)]


def ringtones():
    # Envo: a friendly rising figure on marimba, twice, then a breath.
    phrase = [(0.0, 'E5'), (0.16, 'G5'), (0.32, 'C6'), (0.56, 'G5'), (0.72, 'E6')]
    write('ring-envo.wav', melody(phrase + [(at + 1.4, n) for at, n in phrase], MARIMBA, 3.6))
    # Calm: two soft bell chimes, lots of air.
    write('ring-calm.wav', melody([(0.0, 'C5'), (0.5, 'G5'), (2.0, 'C5'), (2.5, 'E5')], BELL, 4.4, note_len=2.2))
    # Bright: a quick upbeat run on glass.
    run = [(0.0, 'C6'), (0.12, 'D6'), (0.24, 'E6'), (0.36, 'G6'), (0.6, 'E6'), (0.72, 'G6')]
    write('ring-bright.wav', melody(run + [(at + 1.2, n) for at, n in run], GLASS, 3.0, note_len=0.9))
    # Classic: the old double ring of a desk phone (two close tones, warbled).
    out = []
    for burst in range(2):
        for i in range(int(RATE * 0.4)):
            t = i / RATE
            warble = 0.5 + 0.5 * math.sin(2 * math.pi * 20 * t)
            out.append(warble * (math.sin(2 * math.pi * 440 * t) + math.sin(2 * math.pi * 480 * t)) * min(1, t / 0.01))
        out.extend(silence(0.2))
    out.extend(silence(1.8))
    write('ring-classic.wav', out)


def dtmf():
    rows = [697, 770, 852, 941]
    cols = [1209, 1336, 1477]
    keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'star', '0', 'hash']
    for idx, key in enumerate(keys):
        lo, hi = rows[idx // 3], cols[idx % 3]
        samples = []
        n = int(RATE * 0.12)
        for i in range(n):
            t = i / RATE
            env = min(1, t / 0.005) * min(1, (n - i) / (RATE * 0.01))
            samples.append(env * (math.sin(2 * math.pi * lo * t) + math.sin(2 * math.pi * hi * t)))
        write(f'dtmf-{key}.wav', samples)


def ringback():
    # 425 Hz, one second on and three off: what callers hear in Bangladesh while it rings.
    out = []
    n = int(RATE * 1.0)
    for i in range(n):
        t = i / RATE
        out.append(math.sin(2 * math.pi * 425 * t) * min(1, t / 0.02) * min(1, (n - i) / (RATE * 0.02)))
    out.extend(silence(3.0))
    write('ringback.wav', out)


def hangup():
    write('hangup.wav', melody([(0.0, 'G5'), (0.14, 'C5')], GLASS, 0.9, note_len=0.7))


if __name__ == '__main__':
    ringtones()
    dtmf()
    ringback()
    hangup()
    print('sounds written to', os.path.normpath(OUT))
