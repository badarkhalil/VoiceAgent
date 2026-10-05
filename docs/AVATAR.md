# Azure — Photorealistic Client-Side Talking Avatar

The agent's face is rendered **entirely in the browser**. There is no per-response
cloud video call anywhere in the runtime path: the backend sends one versioned
animation timeline per sentence, the client samples it against the audio clock,
and a WebGL (or Canvas2D) mesh warp animates a single photo.

---

## 1. How it fits together

```
backend                                          frontend
--------                                         --------
text ─┬─ normalize → G2P → visemes ┐
      ├─ rule expression cues       ├─► animation.timeline ─┐
      ├─ seeded head keyframes      │                        │
      └─ seeded blinks             ─┘                        ▼
                            Piper/Edge PCM ──► audio.begin ─► AudioPlayer
                                              binary PCM       │ AudioContext.currentTime
                                              audio.end        ▼
                                                        AvatarRuntime (rAF)
                                                          getClock() → timeline.sample(t)
                                                          → controllers → AvatarRig
                                                          → AvatarRenderer.draw()
```

The **audio clock is authoritative**. `AudioPlayer.getPlayhead()` returns
`AudioContext.currentTime − sentenceStartTime`; the runtime never uses
`setTimeout` for sync. Interrupt/pause use `AudioContext.suspend()`, not
`close()`, so the clock survives.

---

## 2. Animation JSON schema (version 1.0)

One object per sentence, delivered as `animation.timeline`:

```jsonc
{
  "version": "1.0",
  "avatarId": "azure",
  "sentence_index": 2,
  "duration": 4.82,               // seconds — equals the PCM duration
  "alignment": "estimated-rule-based",

  "visemes":   [ { "start": 0.0, "end": 0.1, "value": "neutral" }, ... ],
  "expressions":[ { "start": 0.0, "end": 4.82, "type": "friendly", "intensity": 0.25 } ],
  "head":      [ { "time": 0.0, "yaw": 0, "pitch": 0, "roll": 0 }, ... ],
  "blinks":    [ { "time": 1.8, "duration": 0.12 }, ... ]
}
```

- **visemes** — contiguous spans; the set is defined in
  `frontend/js/models/Viseme.js` (`neutral, closed, fv, th, td, kg, s, sh, aa,
  ae, eh, ee, ah, oh, oo, HH, L`). Sampling cross-fades at boundaries; it never
  snaps.
- **expressions** — additive deltas scaled by `intensity` (never binary).
  Supported: `neutral, friendly, happy, sad, serious, surprised, thinking,
  confused`.
- **head** — small keyframes in degrees (±3–7° yaw) because the photo has no
  side view.
- **blinks** — events with `time` and `duration`.

A complete example lives at `frontend/avatars/azure/sample-animation.json`.
Open `frontend/avatar-lab.html` to scrub it.

> The reference spec shows uppercase viseme names (`AA`, `REST`). This project
> uses the lowercase set above consistently across the backend provider and the
> client; the schema is versioned, so both can coexist.

---

## 3. The rig

The rig turns **normalized parameters** (0..1) into per-vertex mesh offsets — it
never hard-codes pixel motion.

- `frontend/avatars/azure/rig.json` lists named facial landmarks in normalized
  image coordinates (`0..1`, origin top-left): `mouthLeft`, `mouthRight`,
  `mouthTop`, `mouthBottom`, `leftEye`, `leftBrow`, `chin`, `leftCheek`, …
- `frontend/js/avatar/AvatarRig.js` anchors each parameter to one or more
  radially-weighted "lobes" at those landmarks. Because the base mesh and rig
  are static, the per-vertex basis for every parameter is precomputed once; each
  frame is just a weighted sum — no allocation, no trig in the hot loop.
  Lobe radii/offsets are authored for a **face-filling portrait** (the
  `prepare.html` defaults) and are **scaled by the actual face size** measured
  from the rig landmarks, so a small face in a wide photo still deforms only the
  face. A portrait photo yields a scale of ~1.
- Head pose (yaw/pitch/roll) is a single affine matrix applied in the vertex
  shader, approximating a 2D-photo head turn.

Parameters: `mouthOpen, mouthWidth, jawOpen, lipRound, smile, cheek, browLeft,
browRight, browInnerUp, eyeBlinkLeft, eyeBlinkRight, eyeOpen, headYaw,
headPitch, headRoll, headX, headY`.

---

## 4. Using your own photo

1. Put a **front-facing** photo in `frontend/avatars/azure/` (e.g. `photo.jpg`).
   Until you do, the bundled `placeholder.svg` is used automatically.
2. Open `frontend/prepare.html`:
   - Drop the photo in.
   - Drag the landmarks onto the face. (If you vendor MediaPipe under
     `frontend/vendor/mediapipe/`, the **Auto-detect** button will place them for
     you; manual placement is fully supported and is the guaranteed fallback.)
   - **Export rig.json** → overwrite `frontend/avatars/azure/rig.json`.
   - **Export mouthMask.png** → place it in the same folder.
3. Reload. The face layer's alpha is multiplied by `mouthMask.png`, so the inner
   mouth (`innerMouth.png`) and teeth (`teeth.png`) show through as the lips
   deform apart. Optional layers are skipped if absent.

`frontend/avatars/azure/avatar.json` controls what loads:

```json
{
  "id": "azure", "name": "Azure",
  "photo": "photo.jpg", "placeholder": "placeholder.svg",
  "innerMouth": "innerMouth.png", "teeth": "teeth.png", "mouthMask": "mouthMask.png",
  "mesh": { "cols": 32, "rows": 32 },
  "expressions": { "default": "friendly", "idleIntensity": 0.25 }
}
```

---

## 5. Replacing providers

| Concern | Interface | Default |
|---------|-----------|---------|
| Viseme/timeline | `backend/animation/providers/base.py::VisemeProvider` | `RuleBasedVisemeProvider` |
| Client fallback | `frontend/js/providers/VisemeProvider.js` | grapheme → viseme estimate |
| Avatar assets | `frontend/js/providers/AvatarProvider.js` | fetches `avatar.json` + `rig.json` |
| Renderer | same interface in `AvatarRenderer` / `CanvasRenderer` | WebGL, auto-falls back to Canvas2D |

To swap in a forced aligner (e.g. MFA) or a TTS that reports timestamps,
implement `VisemeProvider.build(text, duration_s, language)` and return an
`AnimationTimeline`; nothing in the pipeline or client needs to change.

---

## 6. Debug & test

- `frontend/avatar-lab.html` — play/pause/stop/replay/reset, expression selector
  + intensity, head/blink toggles, debug overlay, **Run Animation Test**
  (spec §28 sequence), and a client-estimate "Speak" box.
- In the live call, toggle the debug overlay from the call controls; it shows
  FPS, audio time, viseme, expression, mouthOpen/jawOpen, head yaw/pitch/roll,
  blink state and lip-sync level.
- The call UI shows an `alignment` badge so "estimated" is always visible.

---

## 7. Known limitations

- **Lip-sync timing is estimated** (rule-based); Piper/Edge provide no
  per-phoneme timestamps. Accuracy is approximate and labelled as such.
- **Head rotation is limited** (±3–7° yaw) because a single front-facing photo
  has no side view.
- **Teeth / inner mouth are a static prepared layer**, not generated per
  sentence; without a prepared `mouthMask.png` the face layer stays opaque.
- The Canvas2D fallback approximates head motion as a best-effort warp and is
  slower than the WebGL path.
