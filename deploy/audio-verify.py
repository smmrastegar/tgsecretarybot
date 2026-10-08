#!/usr/bin/env python3
"""Is this audio file really that song? (numpy only)

usage: audio-verify.py <full-file> <spotify-30s-preview> [ffmpeg]
prints one JSON line: {"ok":true,"score":0.93,"offset":57.2}

Both files are turned into log-mel spectrogram frames; the 30 s preview is slid over the
whole file with an FFT cross-correlation and the best cosine similarity is reported.
The same recording scores ≳0.8; a different song stays far below 0.5.
"""
import json, subprocess, sys
import numpy as np

SR, NFFT, HOP, NMEL = 22050, 2048, 512, 32


def decode(path, ffmpeg):
    cmd = [ffmpeg, "-v", "error", "-t", "900", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, timeout=240).stdout, dtype=np.float32)


def mel_fb():
    hz2mel = lambda f: 2595 * np.log10(1 + f / 700)
    mel2hz = lambda m: 700 * (10 ** (m / 2595) - 1)
    pts = mel2hz(np.linspace(hz2mel(60), hz2mel(8000), NMEL + 2))
    bins = np.floor((NFFT + 1) * pts / SR).astype(int)
    fb = np.zeros((NMEL, NFFT // 2 + 1))
    for i in range(NMEL):
        a, b, c = bins[i], bins[i + 1], bins[i + 2]
        if b > a: fb[i, a:b] = (np.arange(a, b) - a) / (b - a)
        if c > b: fb[i, b:c] = (c - np.arange(b, c)) / (c - b)
    return fb


def frames(y):
    win = np.hanning(NFFT).astype(np.float32)
    FB = mel_fb()
    out = []
    step = HOP * 2000
    for pos in range(0, max(1, y.size - NFFT), step):
        seg = y[pos:pos + step + NFFT - HOP]
        n = 1 + (seg.size - NFFT) // HOP
        if n < 1: break
        idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
        S = np.abs(np.fft.rfft(seg[idx] * win, axis=1)) ** 2
        out.append(np.log(S @ FB.T + 1e-8))
    m = np.vstack(out)  # frames x mel
    m = m - m.mean(1, keepdims=True)  # per-frame loudness out: keep spectral shape
    return m - m.mean(0, keepdims=True)


def best_match(full, prev):
    Tf, Tp = full.shape[0], prev.shape[0]
    if Tp < 200 or Tf < Tp: return 0.0, 0.0
    n = 1 << int(np.ceil(np.log2(Tf + Tp)))
    num = np.zeros(Tf - Tp + 1)
    for b in range(NMEL):  # cross-correlation per band, summed
        c = np.fft.irfft(np.fft.rfft(full[:, b], n) * np.conj(np.fft.rfft(prev[:, b], n)), n)
        num += c[: Tf - Tp + 1]
    csum = np.concatenate([[0], np.cumsum((full ** 2).sum(1))])
    wnorm = np.sqrt(csum[Tp:] - csum[:-Tp])[: Tf - Tp + 1]
    pnorm = np.sqrt((prev ** 2).sum())
    score = num / (wnorm * pnorm + 1e-9)
    i = int(np.argmax(score))
    return float(score[i]), i * HOP / SR


if __name__ == "__main__":
    try:
        ff = sys.argv[3] if len(sys.argv) > 3 else "ffmpeg"
        full, prev = decode(sys.argv[1], ff), decode(sys.argv[2], ff)
        if full.size < SR * 20 or prev.size < SR * 10: raise RuntimeError("audio too short or undecodable")
        s, off = best_match(frames(full), frames(prev))
        print(json.dumps({"ok": True, "score": round(s, 3), "offset": round(off, 1)}))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)[:200]}))
