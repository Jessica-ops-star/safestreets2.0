"""
generate_unknown_dataset.py - SafeStreets UNKNOWN Dataset Generator

Generates synthetic audio samples for non-emergency speech words (e.g. 'yes', 'no', 'hello', 'stop', 'go', 'water', 'car', 'street', etc.)
Features:
- Multi-accent gTTS & pyttsx3 fallback
- 16 kHz mono WAV output
- Audio augmentations: pitch shift, speed variation, volume scaling, background noise mixing
- Network failure handling & retry logic
- Duplicate prevention & clear progress reporting
"""

import os
import io
import time
import random
import uuid
import argparse
import tempfile
import numpy as np
import scipy.signal
import soundfile as sf
import librosa

try:
    from gtts import gTTS
    GTTS_AVAILABLE = True
except ImportError:
    GTTS_AVAILABLE = False

try:
    import pyttsx3
    PYTTSX3_AVAILABLE = True
except ImportError:
    PYTTSX3_AVAILABLE = False


# Non-emergency speech words/phrases (UNKNOWN category)
UNKNOWN_PHRASES = [
    "hello", "good morning", "yes", "no", "okay", "stop", "go",
    "left", "right", "up", "down", "water", "car", "street", "phone",
    "apple", "banana", "music", "play", "number", "zero", "one",
    "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "cat", "dog", "house", "door", "window", "table", "chair", "food",
    "city", "park", "how are you", "what time is it", "see you later",
    "good night", "open the door", "turn on the light", "play music",
    "where are we going", "have a nice day", "thank you", "you are welcome"
]

GTTS_TLDS = ['com', 'co.uk', 'ca', 'co.in', 'com.au', 'ie', 'co.za']


def generate_tts_audio_gtts(phrase: str, tld: str, slow: bool) -> np.ndarray:
    if not GTTS_AVAILABLE:
        raise RuntimeError("gtts is not installed")
    tts = gTTS(text=phrase, lang='en', tld=tld, slow=slow)
    fp = io.BytesIO()
    tts.write_to_fp(fp)
    fp.seek(0)
    y, sr = librosa.load(fp, sr=16000, mono=True)
    return y


def generate_tts_audio_pyttsx3(phrase: str) -> np.ndarray:
    if not PYTTSX3_AVAILABLE:
        raise RuntimeError("pyttsx3 is not installed")
    engine = pyttsx3.init()
    voices = engine.getProperty('voices')
    if voices:
        voice = random.choice(voices)
        engine.setProperty('voice', voice.id)
    rate = random.randint(120, 200)
    engine.setProperty('rate', rate)
    
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        tmp_path = tmp.name
        
    engine.save_to_file(phrase, tmp_path)
    engine.runAndWait()
    
    y, sr = librosa.load(tmp_path, sr=16000, mono=True)
    try:
        os.remove(tmp_path)
    except OSError:
        pass
    return y


def generate_raw_tts(phrase: str) -> np.ndarray:
    tld = random.choice(GTTS_TLDS)
    slow = random.choice([True, False, False])
    
    if GTTS_AVAILABLE:
        for attempt in range(3):
            try:
                return generate_tts_audio_gtts(phrase, tld, slow)
            except Exception:
                time.sleep(0.5)
                tld = random.choice(GTTS_TLDS)
                
    if PYTTSX3_AVAILABLE:
        return generate_tts_audio_pyttsx3(phrase)
        
    raise RuntimeError("Failed to generate TTS audio")


def generate_synthetic_noise(length: int, noise_type: str) -> np.ndarray:
    if noise_type == 'white':
        return np.random.normal(0, 1, length)
    elif noise_type == 'pink':
        white = np.random.randn(length)
        b, a = scipy.signal.butter(1, 0.05)
        return scipy.signal.lfilter(b, a, white)
    elif noise_type == 'hum':
        t = np.arange(length) / 16000.0
        freq = random.choice([50.0, 60.0])
        return np.sin(2 * np.pi * freq * t)
    else:
        return np.random.normal(0, 1, length)


def apply_augmentations(y: np.ndarray, sr: int = 16000) -> np.ndarray:
    if random.random() < 0.7:
        n_steps = random.uniform(-2.5, 2.5)
        y = librosa.effects.pitch_shift(y, sr=sr, n_steps=n_steps)
        
    if random.random() < 0.7:
        rate = random.uniform(0.85, 1.2)
        y = librosa.effects.time_stretch(y, rate=rate)
        
    y_trimmed, _ = librosa.effects.trim(y, top_db=25)
    if len(y_trimmed) > 0:
        y = y_trimmed
        
    target_length = int(sr * 1.0)
    if len(y) < target_length:
        pad_before = (target_length - len(y)) // 2
        pad_after = target_length - len(y) - pad_before
        y = np.pad(y, (pad_before, pad_after), mode='constant')
    elif len(y) > target_length:
        if len(y) > int(sr * 1.5):
            start = (len(y) - target_length) // 2
            y = y[start:start + target_length]
            
    gain = random.uniform(0.5, 1.3)
    y = y * gain
    
    if random.random() < 0.7:
        noise_type = random.choice(['white', 'pink', 'hum'])
        noise = generate_synthetic_noise(len(y), noise_type)
        snr_db = random.uniform(12, 28)
        signal_power = np.mean(y ** 2) + 1e-8
        noise_power = np.mean(noise ** 2) + 1e-8
        factor = np.sqrt(signal_power / (10 ** (snr_db / 10) * noise_power))
        y = y + noise * factor

    max_val = np.max(np.abs(y)) + 1e-8
    if max_val > 0.99:
        y = y / max_val * 0.95
        
    return y.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description="Generate UNKNOWN dataset audio samples.")
    parser.add_argument("--count", type=int, default=300, help="Number of samples (default: 300)")
    parser.add_argument("--output_dir", type=str, default="./safestreets_dataset/UNKNOWN", help="Output directory")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    print(f"Dataset Output Directory: {args.output_dir}")
    print(f"Target UNKNOWN sample count: {args.count}")

    generated = 0
    failed_attempts = 0
    max_failures = 100

    while generated < args.count and failed_attempts < max_failures:
        phrase = random.choice(UNKNOWN_PHRASES)
        try:
            raw_audio = generate_raw_tts(phrase)
            aug_audio = apply_augmentations(raw_audio, sr=16000)
            
            filename = f"unknown_{generated + 1:04d}_{uuid.uuid4().hex[:8]}.wav"
            filepath = os.path.join(args.output_dir, filename)
            
            sf.write(filepath, aug_audio, 16000, subtype='PCM_16')
            generated += 1
            failed_attempts = 0
            
            if generated % 25 == 0 or generated == args.count:
                print(f"Generated {generated}/{args.count} UNKNOWN samples")
        except Exception as e:
            failed_attempts += 1
            time.sleep(0.5)

    print(f"\nSuccessfully generated {generated} UNKNOWN samples.")


if __name__ == "__main__":
    main()
