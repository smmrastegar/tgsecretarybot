#!/usr/bin/env python3
"""Audio feature extractor for the music library (numpy only).

usage: audio-analyze.py <audio-file> [ffmpeg-binary]
prints ONE JSON line:
  {"ok":true,"bpm":..,"beat":..,"key":"A","mode":"minor","keyStrength":..,
   "energy":..,"brightness":..,"vec":[47 floats]}
`vec` = timbre (MFCC mean/std), spectral shape, loudness, rhythm and a
key-invariant chroma profile; the app standardises it across the library
and compares tracks with cosine similarity.
Analyses the WHOLE track (capped at 10 min), in 40 s chunks to bound memory.
If essentia-tensorflow and the Discogs-EffNet models are installed it also adds
`emb` (1280-d embedding), `genres` (top Discogs styles) and `moods`.
"""
import json, os, subprocess, sys
import numpy as np

SR, NFFT, HOP, NMEL, NMFCC = 22050, 2048, 512, 40, 13
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


MAXSEC = 600


def decode(path, ffmpeg):
    cmd = [ffmpeg, "-v", "error", "-t", str(MAXSEC), "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, timeout=240).stdout, dtype=np.float32)


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
    FB, DCT = mel_fb(), dct_matrix()
    win = np.hanning(NFFT).astype(np.float32)
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    lo, hi = np.searchsorted(freqs, 65), np.searchsorted(freqs, 2000)
    pc = np.round(12 * np.log2(freqs[lo:hi] / 440.0) + 69).astype(int) % 12
    pc_masks = [pc == k for k in range(12)]
    bass_hi = np.searchsorted(freqs, 250)
    vlo, vhi = np.searchsorted(freqs, 300), np.searchsorted(freqs, 3400)
    CH = HOP * 1700  # ≈ 40 s of samples per chunk, multiple of HOP

    cols = {k: [] for k in ("mfcc", "cent", "roll", "flux", "flat", "rms", "zcr", "onset", "bass", "voc")}
    chroma = np.zeros(12)
    prev_S = prev_mel = None
    pos = 0
    while pos + NFFT <= y.size:
        seg = y[pos:pos + CH + NFFT - HOP]
        nfr = 1 + (seg.size - NFFT) // HOP
        if nfr < 1: break
        idx = np.arange(NFFT)[None, :] + HOP * np.arange(nfr)[:, None]
        fr = seg[idx]
        S = np.abs(np.fft.rfft(fr * win, axis=1)).astype(np.float64)
        P = S ** 2
        mel = np.log(P @ FB.T + 1e-10)
        cols["mfcc"].append(mel @ DCT.T)
        tot = S.sum(1) + 1e-9
        cols["cent"].append((S * freqs).sum(1) / tot)
        cs = np.cumsum(S, 1)
        cols["roll"].append(freqs[(cs >= 0.85 * cs[:, -1:]).argmax(1)])
        Sx = S if prev_S is None else np.vstack([prev_S, S])
        mx = mel if prev_mel is None else np.vstack([prev_mel, mel])
        cols["flux"].append(np.sqrt((np.diff(Sx, axis=0).clip(min=0) ** 2).sum(1)))
        cols["onset"].append(np.diff(mx, axis=0).clip(min=0).sum(1))
        prev_S, prev_mel = S[-1:], mel[-1:]
        cols["flat"].append(np.exp(np.mean(np.log(S + 1e-9), 1)) / (S.mean(1) + 1e-9))
        cols["rms"].append(np.sqrt((fr ** 2).mean(1)))
        cols["zcr"].append((np.diff(np.sign(fr), axis=1) != 0).mean(1))
        cols["bass"].append(P[:, :bass_hi].sum(1) / (P.sum(1) + 1e-9))
        cols["voc"].append(P[:, vlo:vhi].sum(1) / (P.sum(1) + 1e-9))
        Pc = P[:, lo:hi].sum(0)
        for k in range(12): chroma[k] += Pc[pc_masks[k]].sum()
        pos += CH
    c = {k: np.concatenate(v) for k, v in cols.items()}
    mfcc = c["mfcc"]
    mfcc_mean, mfcc_std = mfcc.mean(0), mfcc.std(0)
    chroma = chroma / (chroma.sum() + 1e-9)
    best = (-2, 0, "major")
    for k in range(12):
        for prof, mode in ((MAJ, "major"), (MIN, "minor")):
            cc = np.corrcoef(np.roll(prof, k), chroma)[0, 1]
            if cc > best[0]: best = (cc, k, mode)
    keystr, tonic, mode = best
    chroma_rot = np.roll(chroma, -tonic)

    onset = c["onset"] - c["onset"].mean()
    ac = np.correlate(onset, onset, "full")[onset.size - 1:]
    ac = ac / (ac[0] + 1e-9)
    fps = SR / HOP
    lags = np.arange(int(fps * 60 / 190), int(fps * 60 / 55))
    bpms = 60 * fps / lags
    score = ac[lags] * (1 - 0.25 * np.abs(np.log2(bpms / 120)))
    j = int(score.argmax())
    lag = int(lags[j])
    near = lambda L: (ac[max(1, L - 2):L + 3].max() if 1 <= L < ac.size - 3 else 0.0)
    bpm = 60 * fps / lag
    if bpm < 100 and near(lag // 2) >= 0.55 * ac[lag] and 60 * fps / (lag // 2) <= 190: bpm *= 2
    elif bpm > 175 and near(lag * 2) >= 0.55 * ac[lag]: bpm /= 2
    bpm, beat = float(bpm), float(max(0.0, ac[lag]))

    rms, flux, cent = c["rms"], c["flux"], c["cent"]
    rms_m = float(rms.mean())
    energy = float(np.clip(0.45 * np.tanh(rms_m * 6) + 0.30 * np.tanh(flux.mean() / 25) + 0.25 * np.clip((bpm - 60) / 120, 0, 1), 0, 1))
    brightness = float(np.clip(np.log2(cent.mean() / 500 + 1) / 3, 0, 1))
    db = 20 * np.log10(rms + 1e-6)
    peaks = int(((onset[1:-1] > onset[:-2]) & (onset[1:-1] > onset[2:]) & (onset[1:-1] > onset.std())).sum())
    vec = np.concatenate([
        mfcc_mean, mfcc_std,
        [cent.mean() / 1000, c["roll"].mean() / 1000, flux.mean() / 20, c["flat"].mean()],
        [rms_m * 4, rms.std() * 8, c["zcr"].mean() * 10],
        [bpm / 100, beat],
        chroma_rot,
    ])
    return {
        "ok": True, "bpm": round(bpm, 1), "beat": round(beat, 3), "key": KEYS[tonic], "mode": mode, "keyStrength": round(float(keystr), 3),
        "energy": round(energy, 3), "brightness": round(brightness, 3), "rms": round(rms_m, 4), "flux": round(float(flux.mean()), 3), "centroid": round(float(cent.mean()), 1),
        "bass": round(float(c["bass"].mean()), 3), "vocal": round(float(c["voc"].mean()), 3), "onsetRate": round(peaks / (onset.size / fps), 2),
        "dynamics": round(float(np.percentile(db, 95) - np.percentile(db, 10)), 1), "seconds": round(y.size / SR),
        "vec": [round(float(v), 5) for v in vec],
    }


MODELS = os.environ.get("TGSB_MODELS", "/var/lib/tgsb-tools/models")


def ml(path, ffmpeg):
    """Discogs-EffNet embedding + genre/mood heads, or None when not installed."""
    try:
        import essentia.standard as es  # noqa: PLC0415
        if not os.path.exists(f"{MODELS}/discogs-effnet-bs64-1.pb"): return None
        pcm = subprocess.run([ffmpeg, "-v", "error", "-t", str(MAXSEC), "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, timeout=240).stdout
        audio = np.frombuffer(pcm, dtype=np.float32)
        if audio.size < 16000 * 8: return None
        emb = es.TensorflowPredictEffnetDiscogs(graphFilename=f"{MODELS}/discogs-effnet-bs64-1.pb", output="PartitionedCall:1")(audio)
        out = {"emb": [round(float(v), 3) for v in emb.mean(0)]}
        g = es.TensorflowPredict2D(graphFilename=f"{MODELS}/genre_discogs400-discogs-effnet-1.pb", input="serving_default_model_Placeholder", output="PartitionedCall:0")(emb).mean(0)
        classes = json.load(open(f"{MODELS}/genre_discogs400-discogs-effnet-1.json"))["classes"]
        top = np.argsort(-g)[:8]
        out["genres"] = [[classes[i], round(float(g[i]), 3)] for i in top if g[i] >= 0.04]
        moods = {}
        for name, key, i in (("mood_happy", "happy", 0), ("mood_sad", "sad", 1), ("mood_aggressive", "aggressive", 0), ("mood_relaxed", "relaxed", 1), ("danceability", "danceable", 0), ("voice_instrumental", "instrumental", 0)):
            f = f"{MODELS}/{name}-discogs-effnet-1.pb"
            if os.path.exists(f):
                moods[key] = round(float(es.TensorflowPredict2D(graphFilename=f, output="model/Softmax")(emb).mean(0)[i]), 3)
        out["moods"] = moods
        return out
    except Exception as e:  # noqa: BLE001
        return {"mlError": str(e)[:160]}


if __name__ == "__main__":
    try:
        ff = sys.argv[2] if len(sys.argv) > 2 else "ffmpeg"
        y = decode(sys.argv[1], ff)
        if y.size < SR * 8: raise RuntimeError("audio too short or undecodable")
        out = analyse(y)
        out["ml"] = False
        extra = ml(sys.argv[1], ff)
        if extra and "emb" in extra: out.update(extra); out["ml"] = True
        elif extra: out.update(extra)
        print(json.dumps(out))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)[:200]}))
