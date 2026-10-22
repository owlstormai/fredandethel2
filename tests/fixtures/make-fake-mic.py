#!/usr/bin/env python3
"""Generate a speech-like WAV for Chromium's --use-file-for-fake-audio-capture.

Pattern (seconds): 1.5 silence, 3.0 "speech", 2.0 silence, 2.5 "speech", 1.0 silence.
"Speech" is band-limited noise + harmonics, amplitude-modulated at a 3.5 Hz
syllable rate so VAD/analysers see realistic bursts. 48 kHz mono 16-bit.
"""
import math, struct, sys, wave
import numpy as np

rate = 48000
rng = np.random.default_rng(7)

def silence(sec):
    return np.zeros(int(rate * sec))

def speech(sec, f0=140.0):
    n = int(rate * sec)
    t = np.arange(n) / rate
    harm = sum(np.sin(2 * math.pi * f0 * k * t) / k for k in range(1, 7))
    noise = rng.normal(0, 0.15, n)
    # crude band-limit: moving average
    kernel = np.ones(24) / 24
    noise = np.convolve(noise, kernel, mode="same")
    syllables = 0.55 + 0.45 * np.sin(2 * math.pi * 3.5 * t) ** 2
    words = (np.sin(2 * math.pi * 0.7 * t) > -0.6).astype(float)
    sig = (0.6 * harm / 6 + noise) * syllables * words
    return 0.6 * sig / max(1e-6, np.max(np.abs(sig)))

out = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/fake-mic.wav"
audio = np.concatenate([silence(1.5), speech(3.0), silence(2.0), speech(2.5, 170.0), silence(1.0)])
pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
with wave.open(out, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(pcm.tobytes())
print(f"wrote {out}: {len(pcm)/rate:.1f}s")
