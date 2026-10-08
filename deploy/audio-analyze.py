#!/usr/bin/env python3
"""Audio feature extractor for the music library (numpy only).

usage: audio-analyze.py <audio-file> [ffmpeg-binary]
prints ONE JSON line:
  {"ok":true,"bpm":..,"beat":..,"key":"A","mode":"minor","keyStrength":..,
   "energy":..,"brightness":..,"vec":[47 floats]}
`vec` = timbre (MFCC mean/std), spectral shape, loudness, rhythm and a
key-invariant chroma profile; the app standardises it across the library
and compares tracks with cosine similarity.
Analyses up to 120 s from the middle of the track (skips intros/outros).
"""
import json, subprocess, sys
import numpy as np

SR, NFFT, HOP, NMEL, NMFCC = 22050, 2048, 512, 40, 13
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def decode(path, ffmpeg):
    def run(ss):
        cmd = [ffmpeg, "-v", "error", "-ss", str(ss), "-t", "120", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
        return np.frombuffer(subprocess.run(cmd, capture_output=True, timeout=120).stdout, dtype=np.float32)
    y = run(25)
    if y.size < SR * 20:  # short track: take it from the start
        y = run(0)
    return y


def mel_fb():
    def hz2mel(f): return 2595 * np.log10(1 + f / 700)
    def mel2hz(m): return 700 * (10 ** (m / 2595) - 1)
    pts = mel2hz(np.linspace(hz2mel(30), hz2mel(SR / 2), NMEL + 2))
    bins = np.floor((NFFT + 1) * pts / SR).astype(int)
    fb = np.zeros((NMEL, NFFT // 2 + 1))
    for i in range(NMEL):
        a, b, c = bins[i], bins[i + 1], bins[i + 2]
        if b > a: fb[i, a:b] = (np.arange(a, b) - a) / (b - a)
        if c > b: fb[i, b:c] = (c - np.arange(b, c)) / (c - b)
    return fb


def dct_matrix():
    n = np.arange(NMEL)
    return np.array([np.cos(np.pi * k * (2 * n + 1) / (2 * NMEL)) for k in range(NMFCC)]) * np.sqrt(2 / NMEL)


def analyse(y):
    win = np.hanning(NFFT).astype(np.float32)
    nfr = 1 + (y.size - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(nfr)[:, None]
    S = np.abs(np.fft.rfft(y[idx] * win, axis=1)).astype(np.float64)  # frames x bins
    P = S ** 2
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)

    mel = np.log(P @ mel_fb().T + 1e-10)
    mfcc = mel @ dct_matrix().T
    mfcc_mean, mfcc_std = mfcc.mean(0), mfcc.std(0)

    tot = S.sum(1) + 1e-9
    centroid = (S * freqs).sum(1) / tot
    csum = np.cumsum(S, 1)
    rolloff = freqs[(csum >= 0.85 * csum[:, -1:]).argmax(1)]
    flux = np.sqrt((np.diff(S, axis=0).clip(min=0) ** 2).sum(1))
    flat = np.exp(np.mean(np.log(S + 1e-9), 1)) / (S.mean(1) + 1e-9)
    rms = np.sqrt((y[idx] ** 2).mean(1))
    zcr = (np.diff(np.sign(y[idx]), axis=1) != 0).mean(1)

    # chroma (65 Hz – 2 kHz) → key (Krumhansl) + key-invariant profile
    lo, hi = np.searchsorted(freqs, 65), np.searchsorted(freqs, 2000)
    pc = np.round(12 * np.log2(freqs[lo:hi] / 440.0) + 69).astype(int) % 12
    chroma = np.zeros(12)
    for k in range(12): chroma[k] = P[:, lo:hi][:, pc == k].sum()
    chroma = chroma / (chroma.sum() + 1e-9)
    best = (-2, 0, "major")
    for k in range(12):
        for prof, mode in ((MAJ, "major"), (MIN, "minor")):
            c = np.corrcoef(np.roll(prof, k), chroma)[0, 1]
            if c > best[0]: best = (c, k, mode)
    keystr, tonic, mode = best
    chroma_rot = np.roll(chroma, -tonic)

    # tempo from the onset envelope (autocorrelation, 55–190 BPM, mild prior around 120)
    onset = np.diff(np.log(P @ mel_fb().T + 1e-10), axis=0).clip(min=0).sum(1)
    onset = onset - onset.mean()
    ac = np.correlate(onset, onset, "full")[onset.size - 1:]
    ac = ac / (ac[0] + 1e-9)
    fps = SR / HOP
    lags = np.arange(int(fps * 60 / 190), int(fps * 60 / 55))
    bpms = 60 * fps / lags
    score = ac[lags] * (1 - 0.25 * np.abs(np.log2(bpms / 120)))
    j = int(score.argmax())
    lag = int(lags[j])
    # octave check: a strong peak at half the lag means the true tempo is double
    # (70 → 140); a very fast reading with a strong peak at double lag is halved.
    near = lambda L: (ac[max(1, L - 2):L + 3].max() if 1 <= L < ac.size - 3 else 0.0)
    bpm = 60 * fps / lag
    if bpm < 100 and near(lag // 2) >= 0.55 * ac[lag] and 60 * fps / (lag // 2) <= 190: bpm *= 2
    elif bpm > 175 and near(lag * 2) >= 0.55 * ac[lag]: bpm /= 2
    bpm, beat = float(bpm), float(max(0.0, ac[lag]))

    rms_m = float(rms.mean())
    energy = float(np.clip(0.45 * np.tanh(rms_m * 6) + 0.30 * np.tanh(flux.mean() / 25) + 0.25 * np.clip((bpm - 60) / 120, 0, 1), 0, 1))
    brightness = float(np.clip(np.log2(centroid.mean() / 500 + 1) / 3, 0, 1))
    vec = np.concatenate([
        mfcc_mean, mfcc_std,
        [centroid.mean() / 1000, rolloff.mean() / 1000, flux.mean() / 20, flat.mean()],
        [rms_m * 4, rms.std() * 8, zcr.mean() * 10],
        [bpm / 100, beat],
        chroma_rot,
    ])
    return {
        "ok": True, "bpm": round(bpm, 1), "beat": round(beat, 3), "key": KEYS[tonic], "mode": mode, "keyStrength": round(float(keystr), 3),
        "energy": round(energy, 3), "brightness": round(brightness, 3), "rms": round(rms_m, 4), "flux": round(float(flux.mean()), 3), "centroid": round(float(centroid.mean()), 1), "vec": [round(float(v), 5) for v in vec],
    }


if __name__ == "__main__":
    try:
        ff = sys.argv[2] if len(sys.argv) > 2 else "ffmpeg"
        y = decode(sys.argv[1], ff)
        if y.size < SR * 8: raise RuntimeError("audio too short or undecodable")
        print(json.dumps(analyse(y)))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)[:200]}))
