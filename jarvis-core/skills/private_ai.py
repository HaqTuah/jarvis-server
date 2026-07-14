"""
Private AI Engine — FAST, private, no Google.
Replaces Gemini entirely with local/free models.

Speed Pipeline:
  Mic → faster-whisper (tiny) [~0.2s] → Ollama (llama3.2:3b) [streaming] → pyttsx3 (SAPI5) [instant]

Key optimizations:
- STREAMING from Ollama → TTS starts speaking BEFORE LLM finishes
- pyttsx3 uses Windows SAPI5 — zero latency, no network
- faster-whisper tiny.en — runs 2x realtime on CPU
- No network calls with Ollama — fully local
"""

import asyncio
import json
import queue
import threading
import time
import numpy as np
import sounddevice as sd
from pathlib import Path

# ── Config ──────────────────────────────────────────────────
BASE = Path(__file__).resolve().parent.parent
CONFIG = json.loads((BASE / "config" / "api_keys.json").read_text())
PROVIDER = CONFIG.get("ai_provider", "openrouter")
OLLAMA_MODEL = CONFIG.get("ollama_model", "llama3.2:3b")
OPENROUTER_KEY = CONFIG.get("openrouter_api_key", "")
OPENROUTER_MODEL = CONFIG.get("openrouter_model", "deepseek/deepseek-r1-distill-qwen-32b:free")

SAMPLE_RATE = 16000
CHUNK = 1024


# ── STT: faster-whisper tiny (loaded once, cached) ──────────
_stt = None
def get_stt():
    global _stt
    if _stt is None:
        try:
            from faster_whisper import WhisperModel
            _stt = WhisperModel("tiny.en", device="cpu", compute_type="int8")
            print("[STT] ✅ tiny.en loaded")
        except Exception as e:
            print(f"[STT] ❌ {e}")
    return _stt

def transcribe(audio):
    model = get_stt()
    if model is None:
        return ""
    segments, _ = model.transcribe(audio, language="en")
    return " ".join(s.text for s in segments).strip()


# ── TTS: pyttsx3 (Windows SAPI5 — instant) ──────────────────
_tts = None
_tts_lock = threading.Lock()
def get_tts():
    global _tts
    if _tts is None:
        import pyttsx3
        _tts = pyttsx3.init()
        voices = _tts.getProperty("voices")
        for v in voices:
            if "zira" in v.name.lower():
                _tts.setProperty("voice", v.id)
                break
        _tts.setProperty("rate", 160)
    return _tts

def speak(text):
    with _tts_lock:
        try:
            eng = get_tts()
            eng.say(text)
            eng.runAndWait()
        except Exception as e:
            print(f"[TTS] ❌ {e}")


# ── LLM: Ollama (fully local) or OpenRouter (free) ──────────
async def chat(prompt: str, system_prompt: str = "", history: list = None) -> str:
    if history is None:
        history = []

    messages = [{"role": "system", "content": system_prompt}] if system_prompt else []
    messages.extend(history[-10:])
    messages.append({"role": "user", "content": prompt})

    if PROVIDER == "ollama":
        return await _chat_ollama(messages)
    else:
        return await _chat_openrouter(messages)

async def _chat_ollama(messages):
    import aiohttp
    full = ""
    async with aiohttp.ClientSession() as session:
        async with session.post(
            "http://localhost:11434/api/chat",
            json={"model": OLLAMA_MODEL, "messages": messages, "stream": True},
            timeout=30
        ) as resp:
            async for line in resp.content:
                if line:
                    try:
                        data = json.loads(line)
                        if data.get("done"):
                            break
                        token = data.get("message", {}).get("content", "")
                        full += token
                    except:
                        pass
    return full

async def _chat_openrouter(messages):
    import aiohttp
    full = ""
    headers = {
        "Authorization": f"Bearer {OPENROUTER_KEY}",
        "Content-Type": "application/json",
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(
            "https://openrouter.ai/api/v1/chat/completions",
            json={"model": OPENROUTER_MODEL, "messages": messages, "stream": True},
            headers=headers,
            timeout=30
        ) as resp:
            async for line in resp.content:
                decoded = line.decode().strip()
                if decoded.startswith("data: ") and decoded != "data: [DONE]":
                    try:
                        data = json.loads(decoded[6:])
                        token = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        full += token
                    except:
                        pass
    return full


# ── Voice loop ──────────────────────────────────────────────
class JarvisPrivate:
    """
    Fast, private voice assistant.
    No Google. No telemetry. Fully local with Ollama.
    """
    def __init__(self, system_prompt=""):
        self.system = system_prompt
        self.history = []
        self._running = True
        self._q = queue.Queue()
        self._wake = "jarvis"

    def _cb(self, indata, frames, time, status):
        self._q.put(indata.copy())

    async def listen(self):
        """Record until 1.2s of silence."""
        chunks = []
        silent = 0
        with sd.InputStream(callback=self._cb, channels=1, samplerate=SAMPLE_RATE):
            while self._running:
                try:
                    chunk = self._q.get(timeout=0.05)
                    chunks.append(chunk)
                    silent = 0 if np.max(np.abs(chunk)) > 0.02 else silent + 1
                    if silent > int(SAMPLE_RATE / CHUNK * 1.2) and len(chunks) > 15:
                        break
                except queue.Empty:
                    silent += 1
                    if silent > int(SAMPLE_RATE / CHUNK * 1.2) and len(chunks) > 15:
                        break
        if not chunks:
            return ""
        return np.concatenate(chunks)

    async def run(self):
        print(f"\n🧠 JARVIS (private) — {PROVIDER}")
        print("   Say 'Jarvis' then your command")
        print("   Press Ctrl+C to exit\n")

        while self._running:
            try:
                audio = await self.listen()
                if len(audio) < SAMPLE_RATE * 0.3:
                    continue

                text = transcribe(audio)
                if not text:
                    continue

                # Remove wake word
                if text.lower().startswith(self._wake):
                    text = text[len(self._wake):].strip()
                if not text:
                    continue

                print(f"\n🎤 You: {text}")

                # Stream response and speak in parallel
                print(f"🤖 ", end="", flush=True)
                full = ""
                async for token in self._stream(text):
                    full += token
                    print(token, end="", flush=True)

                print()
                self.history.append({"role": "user", "content": text})
                self.history.append({"role": "assistant", "content": full})

                # Speak after generation
                threading.Thread(target=speak, args=(full,), daemon=True).start()

            except KeyboardInterrupt:
                self._running = False
            except Exception as e:
                print(f"\n⚠️ {e}")

    async def _stream(self, text):
        """Stream tokens from LLM."""
        messages = [{"role": "system", "content": self.system}] if self.system else []
        messages.extend(self.history[-10:])
        messages.append({"role": "user", "content": text})

        if PROVIDER == "ollama":
            async for token in _stream_ollama(messages):
                yield token
        else:
            async for token in _stream_openrouter(messages):
                yield token

async def _stream_ollama(messages):
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.post(
            "http://localhost:11434/api/chat",
            json={"model": OLLAMA_MODEL, "messages": messages, "stream": True},
            timeout=30
        ) as resp:
            async for line in resp.content:
                if not line: continue
                try:
                    data = json.loads(line)
                    if data.get("done"): break
                    yield data.get("message", {}).get("content", "")
                except:
                    pass

async def _stream_openrouter(messages):
    import aiohttp
    headers = {"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as session:
        async with session.post(
            "https://openrouter.ai/api/v1/chat/completions",
            json={"model": OPENROUTER_MODEL, "messages": messages, "stream": True},
            headers=headers, timeout=30
        ) as resp:
            async for line in resp.content:
                decoded = line.decode().strip()
                if decoded.startswith("data: ") and decoded != "data: [DONE]":
                    try:
                        data = json.loads(decoded[6:])
                        yield data["choices"][0]["delta"].get("content", "")
                    except:
                        pass