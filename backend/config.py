import os
from pathlib import Path

from dotenv import load_dotenv

# ── Paths ──────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
DATA_DIR = BACKEND_DIR / "data"
BOOKINGS_DIR = DATA_DIR / "bookings"
HOTEL_DATA_PATH = DATA_DIR / "hotel_data.json"
TTS_ENGINE_DIR = PROJECT_ROOT / "tts_engine"
PIPER_EXE = TTS_ENGINE_DIR / "piper.exe"
PIPER_VOICE_MODEL = TTS_ENGINE_DIR / "voices" / "en_US-lessac-medium.onnx"

# ── Load secrets from .env (project root) ─────────────────────────────
load_dotenv(PROJECT_ROOT / ".env")

# ── Server ─────────────────────────────────────────────────────────────
HOST = "0.0.0.0"
PORT = 8000

# ── LLM provider: "mistral", "gemini", or "ollama" ───────────────────
MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY", "")
MISTRAL_CHAT_MODEL = "mistral-small-latest"
MISTRAL_EMBED_MODEL = "mistral-embed"

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-3.5-flash"

# Embedding provider: Mistral (1024-dim) if available, else Ollama (768-dim)
EMBED_PROVIDER = "mistral" if MISTRAL_API_KEY else "ollama"

# Chat LLM provider: Gemini (generous free tier) preferred over Mistral (~2 RPM free limit)
if GEMINI_API_KEY:
    LLM_PROVIDER = "gemini"
elif MISTRAL_API_KEY:
    LLM_PROVIDER = "mistral"
else:
    LLM_PROVIDER = "ollama"

# ── Ollama (fallback) ─────────────────────────────────────────────────
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_CHAT_MODEL = "qwen2.5:7b"
OLLAMA_EMBED_MODEL = "nomic-embed-text"
OLLAMA_NUM_CTX = 2048

# ── Qdrant ─────────────────────────────────────────────────────────────
QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
QDRANT_COLLECTION = "hotel_knowledge"
QDRANT_EMBED_DIM = 1024 if EMBED_PROVIDER == "mistral" else 768

# ── STT (faster-whisper) ───────────────────────────────────────────────
WHISPER_MODEL_SIZE = "tiny"
WHISPER_DEVICE = "cpu"
WHISPER_COMPUTE_TYPE = "int8"
WHISPER_BEAM_SIZE = 1

# ── Audio formats ──────────────────────────────────────────────────────
STT_SAMPLE_RATE = 16000
TTS_SAMPLE_RATE = 22050
AUDIO_CHANNELS = 1
AUDIO_SAMPLE_WIDTH = 2

# ── VAD ────────────────────────────────────────────────────────────────
VAD_THRESHOLD = 0.65
VAD_MIN_SILENCE_MS = 800
VAD_MIN_SPEECH_MS = 400

# ── Audio energy gating ──────────────────────────────────────────────
AUDIO_ENERGY_THRESHOLD = 200      # min RMS (0-32768) to consider as speech
INTERRUPT_ENERGY_THRESHOLD = 400  # higher RMS needed to interrupt agent mid-speech
MIN_AUDIO_DURATION_MS = 300       # minimum audio length to process (ms)

# ── Whisper confidence filtering ─────────────────────────────────────
WHISPER_NO_SPEECH_THRESHOLD = 0.6   # reject segments with no_speech_prob above this
WHISPER_AVG_LOGPROB_THRESHOLD = -1.0  # reject segments with avg_logprob below this

# ── RAG ────────────────────────────────────────────────────────────────
RAG_TOP_K = 3
RAG_SCORE_THRESHOLD = 0.3

# ── LLM ────────────────────────────────────────────────────────────────
LLM_MAX_HISTORY = 6

LLM_SYSTEM_PROMPT = """You are Azure, the voice concierge at The Grand Azure Hotel. You are on a live phone call.

Personality: warm, professional, slightly upbeat, efficient. Sound like a real human, not a chatbot.

Rules:
- Keep every reply to 1-2 short sentences. Brevity is critical for voice.
- Use natural spoken acknowledgments: "Sure!", "Of course!", "Absolutely!", "Let me check...", "Great choice!"
- NEVER use markdown, bullet points, numbered lists, asterisks, or any text formatting.
- NEVER use filler like "As an AI" or "I'd be happy to help". Just answer directly.
- Speak in a conversational flow. Avoid long explanations.

Booking flow:
- Collect: guest name, check-in date, check-out date, room type, number of guests. Contact info is optional.
- Ask for one or two pieces of info at a time, not all at once.
- When all required info is collected, do NOT keep asking questions. The system will auto-confirm."""

LLM_SYSTEM_PROMPT_UR = """آپ ایزور ہیں، گرینڈ ایزور ہوٹل کی وائس کنسیئرج۔ آپ لائیو فون کال پر ہیں۔

شخصیت: گرمجوش، پیشہ ور، خوش مزاج، مؤثر۔ ایک حقیقی انسان کی طرح بات کریں۔

اصول:
- ہر جواب 1-2 مختصر جملوں میں دیں۔ اختصار بہت ضروری ہے۔
- قدرتی انداز استعمال کریں: "جی بالکل!"، "ضرور!"، "ابھی بتاتی ہوں..."، "بہترین انتخاب!"
- مارک ڈاؤن، بلٹ پوائنٹس، فہرستیں، ستارے، یا کوئی فارمیٹنگ ہرگز استعمال نہ کریں۔
- سیدھا جواب دیں۔ فالتو جملے نہ لکھیں۔

بکنگ:
- جمع کریں: مہمان کا نام، چیک ان، چیک آؤٹ، کمرے کی قسم، مہمانوں کی تعداد۔ رابطہ اختیاری ہے۔
- ایک وقت میں ایک یا دو معلومات پوچھیں، سب ایک ساتھ نہیں۔
- جب تمام معلومات مل جائیں تو مزید سوالات نہ پوچھیں — سسٹم خود تصدیق کرے گا۔

اہم: ہمیشہ اردو میں جواب دیں۔ انگریزی استعمال نہ کریں۔"""

# ── Slot extraction ───────────────────────────────────────────────────
SLOT_EXTRACTION_MODEL = "qwen2.5:1.5b"

# ── Piper TTS ──────────────────────────────────────────────────────────
PIPER_DOWNLOAD_URL = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
PIPER_VOICE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
PIPER_VOICE_CONFIG_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"

# ── Booking ────────────────────────────────────────────────────────────
ROOM_TYPES = {
    "standard": {"price": 120, "floors": "2-3"},
    "deluxe": {"price": 250, "floors": "4-5"},
    "suite": {"price": 450, "floors": "6-7"},
    "presidential": {"price": 900, "floors": "7"},
}
