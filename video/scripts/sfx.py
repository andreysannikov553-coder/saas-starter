"""Synthesize placeholder sound design for the episode animatic.

usage: python -I sfx.py <out_dir>
"""
import sys

import numpy as np
import soundfile as sf

SR = 44100
out = sys.argv[1]
rng = np.random.default_rng(7)


def t(sec):
    return np.arange(int(SR * sec)) / SR


def env(n, attack, release):
    e = np.ones(n)
    a, r = int(SR * attack), int(SR * release)
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r)
    return e


def lowpass(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def save(name, x, peak):
    x = x / (np.abs(x).max() + 1e-9) * peak
    sf.write(f"{out}/{name}.wav", x.astype(np.float32), SR)


# Cold ambient drone: detuned low sines plus filtered city noise.
x = t(75)
drone = sum(np.sin(2 * np.pi * f * x) for f in (55, 55.4, 82.4)) / 3
city = lowpass(rng.standard_normal(len(x)), 400)
save("drone", (drone * 0.6 + city * 0.4) * env(len(x), 3, 4), 0.25)

# Phone vibration: 170 Hz buzz in two pulses.
x = t(0.9)
buzz = np.sin(2 * np.pi * 170 * x) * (np.sin(2 * np.pi * 2.2 * x) > 0)
save("buzz", buzz * env(len(x), 0.01, 0.05), 0.5)

# Notification ping: two soft sine tones.
x = t(0.5)
ping = np.sin(2 * np.pi * 1320 * x) * np.exp(-x * 9) + np.sin(2 * np.pi * 1760 * x) * np.exp(-x * 12) * (x > 0.08)
save("ping", ping, 0.35)

# Heartbeat: two low thumps.
x = t(0.9)
thump = lambda d: np.sin(2 * np.pi * 50 * (x - d)) * np.exp(-np.clip(x - d, 0, None) * 18) * (x >= d)
save("heartbeat", thump(0) + 0.7 * thump(0.28), 0.7)

# Clock tick: short filtered click every second.
x = t(8)
tick = np.zeros(len(x))
for s in range(8):
    i = s * SR
    tick[i:i + 300] = rng.standard_normal(300) * np.exp(-np.arange(300) / 40)
save("tick", tick, 0.18)

# Rain on a car roof: filtered noise with random droplets.
x = t(10)
rain = lowpass(rng.standard_normal(len(x)), 6) * 0.5
drops = (rng.random(len(x)) > 0.9993) * rng.standard_normal(len(x))
rain += lowpass(drops, 3) * 3
save("rain", rain * env(len(x), 1, 2), 0.3)

# Warm piano-like note (A3) with soft decay.
x = t(5)
note = sum(np.sin(2 * np.pi * 220 * h * x) / h ** 1.6 for h in (1, 2, 3, 4)) * np.exp(-x * 0.9)
save("piano", note * env(len(x), 0.02, 0.5), 0.3)
