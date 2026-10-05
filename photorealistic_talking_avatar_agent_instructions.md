# Photorealistic Client-Side Talking Human Avatar
## AI Coding Agent Instructions

## 1. Project Goal

Build a working proof-of-concept for a browser-based, photorealistic talking-human avatar system.

The long-term product is an AI web-calling agent. A user visiting a business website, such as a dental clinic, should eventually be able to ask questions directly to an AI agent instead of manually navigating service pages. The agent will answer using the website's knowledge and will support both voice and a video-call-like experience.

The video experience must NOT generate a new AI video for every response. The core architecture is:

1. Prepare an avatar once.
2. Extract/construct a facial rig from a human-looking source image.
3. Convert speech/text into a compact animation timeline.
4. Send audio plus animation data to the browser.
5. Render the talking person locally in JavaScript/WebGL/WebGPU.
6. Keep server-side GPU requirements out of the real-time rendering path.

The prototype must prove that this concept works technically.

---

# 2. Critical Product Principle

Do NOT build the prototype around continuous cloud AI video generation.

Do NOT call a video-generation model for every sentence.

The runtime should be an avatar animation engine.

The intended flow is:

```text
TEXT OR AUDIO INPUT
        |
        v
Speech-to-Text (only for uploaded audio)
        |
        v
Text
        |
        v
Speech / TTS preparation
        |
        +--------------------+
        |                    |
        v                    v
     AUDIO              VISIME / FACE
                         TIMELINE JSON
        |                    |
        +---------+----------+
                  |
                  v
          Browser Avatar Runtime
                  |
                  v
       Photorealistic Talking Person
```

The browser should perform the real-time animation.

---

# 3. Prototype Scope

For the first version, create ONE female, photorealistic human-looking avatar.

The agent itself should create or provide a suitable source image/asset for testing if no image-generation service is available.

The avatar should NOT look like:

- a cartoon
- an anime character
- a 3D game character
- a generic emoji
- a simplistic SVG face

It should look like a realistic human photograph.

The first avatar can be a fictional adult woman. Do not imitate or clone a real public figure.

The prototype must support:

### Input option A: Text

A user enters:

```text
Hello, welcome to our dental clinic. How can I help you today?
```

The system processes it and generates the animation timeline.

### Input option B: Audio upload

The user uploads an audio file.

The system:

```text
Audio
  |
  v
Speech-to-Text
  |
  v
Recognized text
  |
  v
TTS / speech timing pipeline
  |
  v
Animation JSON
```

Show the recognized text in the UI.

The audio should then be played while the avatar animates.

---

# 4. Prototype UI

Create a simple but professional web interface.

Suggested layout:

```text
+-------------------------------------------------------+
|             Talking Human Avatar                      |
+-------------------------------------------------------+
|                                                       |
|                 [ FEMALE AVATAR ]                    |
|                                                       |
|             photorealistic talking face              |
|                                                       |
+-------------------------------------------------------+
| Input Mode:  (•) Text   ( ) Upload Audio              |
|                                                       |
| [ Text area                                        ]  |
|                                                       |
| [ Upload Audio ]                                      |
|                                                       |
| [ Generate / Speak ]                                  |
|                                                       |
| Recognized Text:                                      |
| ---------------------------------------------------   |
|                                                       |
| Animation JSON:                                       |
| ---------------------------------------------------   |
+-------------------------------------------------------+
```

The avatar should be the visual focus.

Also provide controls for testing:

- Play
- Pause
- Stop
- Replay
- Reset
- Expression selector
- Expression intensity
- Head movement toggle
- Blinking toggle
- Debug mode

---

# 5. Architecture

Prefer a clean modular architecture.

Suggested frontend structure:

```text
src/
  avatar/
    AvatarRuntime
    AvatarRenderer
    AvatarMesh
    AvatarRig
    MouthController
    EyeController
    EyebrowController
    ExpressionController
    HeadController
    BlinkController
    LipSyncController
    AnimationTimeline

  audio/
    AudioPlayer
    AudioAnalyzer

  input/
    TextInput
    AudioUploader
    SpeechToText

  animation/
    VisemeTimeline
    ExpressionTimeline
    HeadMotionTimeline
    AnimationInterpolator

  api/
    ApiClient

  models/
    AvatarDefinition
    AvatarRigDefinition
    AnimationFrame
    Viseme
    Expression

  debug/
    DebugOverlay
```

Backend, if required:

```text
server/
  api/
  speech/
  tts/
  stt/
  animation/
  avatars/
```

Keep frontend and backend responsibilities clearly separated.

---

# 6. Avatar Model

The avatar is NOT just one flat image.

The system should conceptually support:

```text
Avatar
 |
 +-- Base Face
 |
 +-- Facial Mesh
 |
 +-- Mouth
 |
 +-- Teeth / Inner Mouth
 |
 +-- Eyes
 |
 +-- Eyebrows
 |
 +-- Expression Data
 |
 +-- Head Movement Data
 |
 +-- Rig Definition
```

The first prototype may simplify this if necessary, but the architecture must allow the full system later.

---

# 7. Face Rig

Create a reusable face rig.

The rig should use normalized parameters rather than hard-coded pixel movements.

Example:

```json
{
  "mouthOpen": 0.72,
  "mouthWidth": 0.43,
  "jawOpen": 0.31,
  "lipRound": 0.15,
  "smile": 0.28,

  "browLeft": 0.12,
  "browRight": 0.08,

  "eyeBlinkLeft": 0.0,
  "eyeBlinkRight": 0.0,

  "headYaw": -0.03,
  "headPitch": 0.01,
  "headRoll": 0.0
}
```

Do NOT make the animation engine depend on commands such as:

```text
move lips 7 pixels down
move mouth 4 pixels left
```

The avatar-specific rig should translate normalized parameters into actual mesh/control-point movements.

This is important because different future avatars will have different dimensions and facial geometry.

---

# 8. Visemes

Do not attempt to create a unique visual mouth position for every phoneme.

Group phonemes into visually similar visemes.

A reasonable starting set is approximately 12-20 visemes.

Example mapping:

```text
P / B / M       -> closed
F / V           -> fv
TH              -> th
T / D / N       -> td
K / G           -> kg
S / Z           -> s
SH / CH / J     -> sh
AA              -> aa
AE              -> ae
EH              -> eh
EE              -> ee
AH              -> ah
OH              -> oh
OO              -> oo
REST            -> neutral
```

The exact mapping can be adjusted after visual testing.

The runtime should interpolate between visemes instead of abruptly switching between images.

---

# 9. Animation JSON

Define a stable animation schema.

Example:

```json
{
  "version": "1.0",
  "duration": 4.82,

  "audio": {
    "url": "/audio/example.mp3"
  },

  "visemes": [
    {
      "start": 0.00,
      "end": 0.10,
      "value": "REST"
    },
    {
      "start": 0.10,
      "end": 0.18,
      "value": "AA"
    },
    {
      "start": 0.18,
      "end": 0.27,
      "value": "M"
    },
    {
      "start": 0.27,
      "end": 0.38,
      "value": "EE"
    },
    {
      "start": 0.38,
      "end": 0.50,
      "value": "OO"
    }
  ],

  "expressions": [
    {
      "start": 0.0,
      "end": 1.2,
      "type": "friendly",
      "intensity": 0.25
    }
  ],

  "head": [
    {
      "time": 0.0,
      "yaw": 0,
      "pitch": 0,
      "roll": 0
    },
    {
      "time": 1.2,
      "yaw": -2,
      "pitch": 1,
      "roll": 0
    },
    {
      "time": 2.5,
      "yaw": 2,
      "pitch": 0,
      "roll": 0
    }
  ],

  "blinks": [
    {
      "time": 1.7,
      "duration": 0.12
    }
  ]
}
```

The exact schema may evolve, but keep it versioned.

---

# 10. Expressions

Support at least:

- neutral
- friendly
- happy
- sad
- serious
- surprised
- thinking
- confused

Expressions must have intensity.

Example:

```json
{
  "type": "happy",
  "intensity": 0.35
}
```

Do not make expressions binary.

Allow blending:

```json
{
  "happy": 0.25,
  "surprise": 0.05,
  "sad": 0.00
}
```

Expressions should affect appropriate facial controls:

- mouth corners
- eyebrows
- eyes
- eyelids
- cheeks if supported
- subtle head position

Avoid exaggerated cartoon-like expressions.

---

# 11. Eye Animation

Eye behavior is extremely important for realism.

Support:

- blinking
- subtle gaze movement
- slight eyelid movement
- eyebrow movement

Blinking should happen naturally.

Do not blink at perfectly fixed intervals.

Use controlled procedural randomness.

Example:

```text
normal speaking
   |
   +-- occasional blink
   |
   +-- small eye movement
   |
   +-- eyebrow response
```

Provide a deterministic/debug mode so animations can also be reproduced for testing.

---

# 12. Head Movement

Support subtle:

- yaw
- pitch
- roll
- X position
- Y position

For a single photograph, keep movements small.

Recommended initial ranges:

```text
Yaw:   approximately ±3 to ±7 degrees
Pitch: approximately ±2 to ±5 degrees
Roll:  approximately ±1 to ±3 degrees
```

Do not make the head rotate dramatically because a single photograph does not contain the missing side of the face.

The prototype should prioritize realism over movement range.

---

# 13. Mouth Rendering

This is one of the most important parts.

A basic image overlay is acceptable only as an early prototype.

The intended architecture should support facial deformation.

Preferred approach:

```text
Photographic texture
        |
        v
Facial mesh
        |
        v
Control points
        |
        v
Mouth deformation
        |
        v
GPU rendering
```

The mouth should ideally use:

- upper lip points
- lower lip points
- mouth corners
- jaw region
- inner-mouth/teeth layer

When mouthOpen increases:

```text
upper lip -> slight upward deformation
lower lip -> downward deformation
jaw      -> downward movement
mouth corners -> appropriate adjustment
```

Use smooth interpolation.

Avoid visible snapping.

---

# 14. Teeth / Inner Mouth

A photograph with a closed mouth does not contain the information needed for an open-mouth state.

The avatar preparation pipeline should therefore support reconstructing or generating:

- inner mouth
- teeth
- optional tongue

For the prototype, a carefully prepared static inner-mouth/teeth layer is acceptable.

The long-term architecture should allow AI-assisted preprocessing to generate these missing regions once.

This is NOT supposed to happen for every spoken sentence.

---

# 15. Client-Side Rendering

The real-time avatar rendering must happen on the client.

Preferred technologies:

- JavaScript/TypeScript
- WebGL initially
- WebGPU where appropriate later
- Canvas only for simpler fallback/debugging

Do not use DOM elements for every facial component.

The renderer should aim for smooth animation around 30-60 FPS depending on device capability.

Use requestAnimationFrame or the appropriate GPU rendering loop.

---

# 16. Animation Engine

The browser should have a central timeline.

Conceptually:

```text
audio.currentTime
        |
        v
AnimationTimeline
        |
        +---- VisemeController
        |
        +---- ExpressionController
        |
        +---- EyeController
        |
        +---- HeadController
        |
        +---- BlinkController
        |
        v
AvatarRenderer
```

At every frame:

```text
currentTime
    ↓
find active animation values
    ↓
interpolate
    ↓
update avatar rig
    ↓
render
```

Do not create a separate animation loop for every facial component.

Use one synchronized timeline.

---

# 17. Audio Synchronization

The animation must be synchronized with the actual audio.

The audio playback clock should be authoritative.

Do not use arbitrary JavaScript timers such as:

```javascript
setTimeout(...)
```

for long-term synchronization.

Instead use:

```javascript
audio.currentTime
```

and derive the animation state from that timestamp.

This prevents lip-sync drift.

---

# 18. Text Input

For direct text input:

```text
User enters text
        |
        v
Text processing
        |
        v
TTS
        |
        +---- audio
        |
        +---- timing / phoneme / viseme data
        |
        v
Animation JSON
```

If the selected TTS provider exposes phoneme or viseme timestamps, use them.

If not, create an abstraction so another timing/alignment implementation can be plugged in later.

Do not tightly couple the animation engine to one TTS vendor.

---

# 19. Audio Upload

Support:

- MP3
- WAV
- M4A if practical
- other browser-supported formats where practical

Flow:

```text
Upload audio
    |
    v
Speech-to-text
    |
    v
Recognized text shown to user
    |
    v
Timing / alignment
    |
    v
Animation JSON
    |
    v
Play original audio + animate avatar
```

For the prototype, if exact phoneme alignment of arbitrary uploaded audio is difficult, implement an adapter/interface and use the best available local or server-side alignment approach.

Do not fake synchronization without clearly labeling it as a prototype fallback.

---

# 20. Speech-to-Text

Create an abstraction:

```typescript
interface SpeechToTextProvider {
    transcribe(audio: Blob): Promise<TranscriptionResult>;
}
```

The prototype can use:

- a local model
- a browser capability
- an API provider
- a configurable backend

Do not hard-code the whole application around one provider.

---

# 21. TTS

Create an abstraction:

```typescript
interface TTSProvider {
    synthesize(text: string): Promise<TTSResult>;
}
```

The result should ideally contain:

```text
audio
+
word timestamps
and/or
phoneme timestamps
and/or
viseme timestamps
```

If the selected provider does not provide visemes, the system should allow a separate phoneme/viseme alignment layer.

---

# 22. Provider Independence

Keep these as interchangeable interfaces:

```text
STTProvider
TTSProvider
LLMProvider
VisemeProvider
AvatarProvider
```

The avatar renderer itself must not depend on OpenAI, Gemini, Azure, ElevenLabs, or any particular AI company.

The prototype should be able to replace providers later.

---

# 23. No GPU Dependency for Runtime

The architecture must explicitly preserve this requirement:

Real-time avatar animation:

```text
Client GPU
```

Not:

```text
Server GPU
```

Server-side GPU may optionally be used for one-time avatar preparation, but it must not be required for every conversation.

---

# 24. Avatar Preparation Pipeline

Design an interface for the eventual user-upload workflow.

Desired future process:

```text
User uploads photo
       |
       v
Face detection
       |
       v
Facial landmark detection
       |
       v
Mouth landmark extraction
       |
       v
Eye/eyebrow extraction
       |
       v
Face mesh creation
       |
       v
Mouth/teeth reconstruction
       |
       v
Expression parameter estimation
       |
       v
AvatarRigDefinition
       |
       v
Save avatar
```

The first prototype may use a manually prepared avatar.

However, create interfaces and data models so automated avatar preparation can be added later.

---

# 25. Future Avatar Upload

Eventually support:

```text
Upload photo
       |
       v
AI enhancement
       |
       v
AI face analysis
       |
       v
Landmarks
       |
       v
Rig
       |
       v
User preview
       |
       v
User adjusts landmarks if necessary
       |
       v
Save
```

The user should eventually be able to manually correct:

- mouth boundary
- eyes
- eyebrows
- face boundary
- teeth region
- jaw
- other control points

This is important because automatic face detection will not always be perfect.

---

# 26. Performance Requirements

The runtime should be lightweight.

Target:

- smooth 30+ FPS on normal modern laptops
- ideally 60 FPS on capable devices
- low CPU usage
- use GPU acceleration
- no server video rendering
- no frame-by-frame image generation
- avoid large memory allocations during animation

Animation should reuse GPU buffers/textures where possible.

Do not recreate textures on every frame.

---

# 27. Debug Mode

Create a debug mode.

It should show:

```text
FPS
current audio time
current viseme
current expression
current mouthOpen
current jawOpen
head yaw
head pitch
head roll
blink state
```

Also optionally display facial landmarks:

```text
     •----•----•
   •             •
  •   •       •   •
  •      •        •
   •   ••••••    •
    •----mouth---•
```

This will make rig development much easier.

---

# 28. Test Animation

Include a test button:

```text
Run Animation Test
```

It should play a predefined sequence:

```text
neutral
   |
   v
friendly
   |
   v
speak
   |
   v
smile
   |
   v
blink
   |
   v
head turn
   |
   v
neutral
```

This allows testing the renderer without STT or TTS.

---

# 29. Test Speech

Include a sample:

```text
Hello, welcome to our dental clinic.
We provide dental cleaning, root canal treatment,
dental implants, and cosmetic dentistry.
How can I help you today?
```

The female avatar should speak it.

The mouth should move according to the animation data.

The head should move subtly.

The eyes should blink.

The expression should remain natural.

---

# 30. Example JSON

The implementation should include at least one complete sample JSON file:

```json
{
  "version": "1.0",
  "avatarId": "female-demo-001",
  "duration": 6.4,

  "visemes": [
    {"start": 0.00, "end": 0.12, "value": "REST"},
    {"start": 0.12, "end": 0.22, "value": "HH"},
    {"start": 0.22, "end": 0.34, "value": "EH"},
    {"start": 0.34, "end": 0.44, "value": "L"},
    {"start": 0.44, "end": 0.55, "value": "OO"}
  ],

  "expressions": [
    {
      "start": 0.0,
      "end": 6.4,
      "type": "friendly",
      "intensity": 0.25
    }
  ],

  "head": [
    {
      "time": 0,
      "yaw": 0,
      "pitch": 0,
      "roll": 0
    },
    {
      "time": 2.0,
      "yaw": -2,
      "pitch": 1,
      "roll": 0
    },
    {
      "time": 4.0,
      "yaw": 2,
      "pitch": -1,
      "roll": 0
    },
    {
      "time": 6.4,
      "yaw": 0,
      "pitch": 0,
      "roll": 0
    }
  ],

  "blinks": [
    {
      "time": 1.8,
      "duration": 0.12
    },
    {
      "time": 4.9,
      "duration": 0.11
    }
  ]
}
```

This is an example only. Implement the schema cleanly rather than blindly copying it.

---

# 31. Important Technical Principle

The animation JSON should describe **what the face should do**, not how the browser should draw every pixel.

Bad:

```json
{
  "mouthX": 481,
  "mouthY": 293,
  "mouthWidth": 93
}
```

Better:

```json
{
  "mouthOpen": 0.72,
  "mouthWidth": 0.43,
  "jawOpen": 0.31,
  "smile": 0.20
}
```

The avatar's rig knows how those normalized values map to its own geometry.

This makes the system reusable across many future avatars.

---

# 32. Security and Privacy

The eventual product will process user-uploaded faces and voice.

Design with privacy in mind.

For the prototype:

- do not expose uploaded files publicly by default
- use temporary storage where possible
- do not log raw face images unnecessarily
- do not log raw audio unnecessarily
- clearly separate demo assets from user assets
- do not build identity verification or impersonation features
- only use fictional/test subjects unless the user has appropriate rights/consent

---

# 33. Do Not Overengineer the First Version

The goal is NOT to solve:

- perfect human facial animation
- arbitrary 3D head rotation
- full-body animation
- multi-person avatars
- production multi-tenancy
- billing
- authentication
- enterprise deployment

The goal is to prove:

```text
Input speech/text
        +
Photorealistic female image
        +
Animation JSON
        |
        v
Convincing talking human in browser
```

Once this works, iterate.

---

# 34. Suggested Implementation Order

Follow this order.

## Step 1

Create the web application shell.

## Step 2

Create/import a photorealistic fictional female demo image.

## Step 3

Create the avatar rig representation.

## Step 4

Implement facial mesh / deformation.

## Step 5

Implement mouth visemes.

## Step 6

Implement eyes and blinking.

## Step 7

Implement expressions.

## Step 8

Implement subtle head movement.

## Step 9

Implement centralized animation timeline.

## Step 10

Implement audio playback synchronization.

## Step 11

Implement sample animation JSON playback.

## Step 12

Add text input.

## Step 13

Add TTS.

## Step 14

Add audio upload.

## Step 15

Add STT.

## Step 16

Connect the complete pipeline.

## Step 17

Add debug tools.

## Step 18

Optimize rendering.

---

# 35. Acceptance Criteria

The prototype is successful when all of these are true:

### Avatar

- A realistic-looking female human is displayed.
- It does not look cartoonish.
- The identity remains visually consistent while speaking.

### Mouth

- Mouth movement follows speech timing.
- Mouth movement is smooth.
- There is no obvious frame-by-frame image swapping.
- Visemes interpolate naturally.
- Teeth/inner mouth can appear when appropriate.

### Eyes

- Avatar blinks.
- Blinking is synchronized with the animation timeline.
- Eye movement is subtle.

### Expressions

At minimum:

```text
neutral
friendly
happy
sad
serious
thinking
```

must work.

### Head

- Head can move slightly left/right.
- Head can move slightly up/down.
- Movement remains natural.
- No major artifacts occur.

### Input

Both must work:

```text
Text
Audio upload
```

### Audio

The avatar's animation follows the audio playback clock.

### JSON

The animation JSON can be inspected in the UI.

### Rendering

The animation is rendered locally in the browser.

There is no cloud video generation call for each response.

### Architecture

The code should make it possible to replace:

- STT provider
- TTS provider
- LLM provider
- viseme provider
- avatar asset

without rewriting the renderer.

---

# 36. Quality Rules

Prioritize:

1. realism
2. synchronization
3. smoothness
4. clean architecture
5. replaceable providers
6. performance

Do NOT prioritize adding lots of features.

A small prototype that looks convincing is more valuable than a large prototype with poor facial animation.

---

# 37. Long-Term Product Direction

The eventual product should become:

```text
Business Website
       |
       v
AI Website Agent
       |
       +---- Website Knowledge / RAG
       |
       +---- LLM
       |
       +---- Voice
       |
       +---- Photorealistic Avatar
                    |
                    v
             Client-side renderer
```

A customer could configure:

```text
Business
  |
  +-- Website
  +-- Knowledge
  +-- AI Agent
  +-- Voice
  +-- Avatar
  +-- Personality
  +-- Expressions
```

The same avatar could handle thousands or millions of conversations without generating a separate AI video for every conversation.

---

# 38. Important Design Decision

The system should treat the avatar as a **runtime asset**, not a video.

Think:

```text
Avatar + Rig + Animation Timeline + Audio
```

rather than:

```text
Generated MP4
```

This distinction is central to the entire project.

---

# 39. Final Instruction to the Coding Agent

You are responsible for implementing the prototype end-to-end.

Do not merely create placeholder UI and claim that the concept works.

Build the actual animation pipeline.

When a real dependency cannot be implemented immediately, create a clean interface and a working local/demo implementation behind it.

Do not hide limitations.

Document:

- what is implemented
- what is simulated
- what requires an external provider
- how to run the project
- how to replace providers
- how the avatar rig works
- how the animation JSON works
- how synchronization works

At the end, provide:

1. Complete source code.
2. README.
3. Setup instructions.
4. Architecture documentation.
5. Example avatar.
6. Example audio.
7. Example animation JSON.
8. Working text-to-avatar demonstration.
9. Working audio-upload demonstration where supported.
10. Debug mode.
11. Clear list of known limitations.
12. Clear next-step recommendations.

Most importantly:

**Do not solve the problem by generating a new AI video for every response.**

The central proof-of-concept must demonstrate:

**a photorealistic human-looking image + reusable facial rig + speech/animation JSON + client-side rendering = a convincing real-time talking human.**
