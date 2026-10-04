"""Download Piper TTS binary and voice model."""

import io
import sys
import zipfile
from pathlib import Path
from urllib.request import urlretrieve

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.config import (
    PIPER_DOWNLOAD_URL,
    PIPER_EXE,
    PIPER_VOICE_CONFIG_URL,
    PIPER_VOICE_MODEL,
    PIPER_VOICE_URL,
    TTS_ENGINE_DIR,
)


def progress_hook(block_num: int, block_size: int, total_size: int) -> None:
    downloaded = block_num * block_size
    if total_size > 0:
        pct = min(100, downloaded * 100 // total_size)
        mb = downloaded / (1024 * 1024)
        total_mb = total_size / (1024 * 1024)
        print(f"\r  {mb:.1f}/{total_mb:.1f} MB ({pct}%)", end="", flush=True)


def download_piper() -> None:
    if PIPER_EXE.exists():
        print(f"[OK] Piper binary already exists at {PIPER_EXE}")
        return

    TTS_ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = TTS_ENGINE_DIR / "piper.zip"

    print(f"Downloading Piper binary from {PIPER_DOWNLOAD_URL} ...")
    urlretrieve(PIPER_DOWNLOAD_URL, str(zip_path), reporthook=progress_hook)
    print()

    print("Extracting Piper ...")
    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.namelist():
            # piper_windows_amd64/piper.exe → piper.exe (flatten one level)
            parts = Path(member).parts
            if len(parts) > 1:
                dest = TTS_ENGINE_DIR / Path(*parts[1:])
            else:
                dest = TTS_ENGINE_DIR / member
            if member.endswith("/"):
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, open(dest, "wb") as dst:
                    dst.write(src.read())

    zip_path.unlink()
    print(f"[OK] Piper extracted to {TTS_ENGINE_DIR}")


def download_voice() -> None:
    PIPER_VOICE_MODEL.parent.mkdir(parents=True, exist_ok=True)

    if PIPER_VOICE_MODEL.exists():
        print(f"[OK] Voice model already exists at {PIPER_VOICE_MODEL}")
    else:
        print(f"Downloading voice model ...")
        urlretrieve(str(PIPER_VOICE_URL), str(PIPER_VOICE_MODEL), reporthook=progress_hook)
        print()
        print(f"[OK] Voice model saved to {PIPER_VOICE_MODEL}")

    config_path = PIPER_VOICE_MODEL.with_suffix(".onnx.json")
    if config_path.exists():
        print(f"[OK] Voice config already exists at {config_path}")
    else:
        print(f"Downloading voice config ...")
        urlretrieve(str(PIPER_VOICE_CONFIG_URL), str(config_path))
        print(f"[OK] Voice config saved to {config_path}")


def main() -> None:
    print("=" * 50)
    print("Voice Agent - Setup")
    print("=" * 50)
    download_piper()
    print()
    download_voice()
    print()
    print("Setup complete!")


if __name__ == "__main__":
    main()
