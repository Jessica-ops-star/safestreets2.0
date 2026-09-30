"""
generate_help_dataset.py - SafeStreets Voice Dataset Generator

Generates synthetic audio samples for the 'HELP' emergency class.
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
# Import TTS libraries with fallback support
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


# Emergency phrase list
HELP_PHRASES = [
    "help",
    "help me",
    "please help",
    "somebody help",
    "someone help",
    "emergency",
    "save me",
    "please help me",
    "someone help me",
    "somebody help me",
    "save me please",
    "help me please",
    "it's an emergency",
    "help emergency",
    "please save me"
]

# gTTS TLDs for voice/accent variation
GTTS_TLDS = ['com', 'co.uk', 'ca', 'co.in', 'com.au', 'ie', 'co.za']


def generate_tts_audio_gtts(phrase: str, tld: str, slow: bool) -> np.ndarray:
    """Generate audio array using gTTS."""
    if not GTTS_AVAILABLE:
        raise RuntimeError("gtts is not installed")
    tts = gTTS(text=phrase, lang='en', tld=tld, slow=slow)
    fp = io.BytesIO()
    tts.write_to_fp(fp)
    fp.seek(0)
    
    # Load audio into numpy array at 16kHz mono
    y, sr = librosa.load(fp, sr=16000, mono=True)
    return y


def generate_tts_audio_pyttsx3(phrase: str) -> np.ndarray:
    """Generate audio array using offline pyttsx3 as fallback."""
    if not PYTTSX3_AVAILABLE:
        raise RuntimeError("pyttsx3 is not installed")
        
    engine = pyttsx3.init()
    voices = engine.getProperty('voices')
    if voices:
        voice = random.choice(voices)
        engine.setProperty('voice', voice.id)
    
    # Set random rate between 120 and 200
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
    """Attempt gTTS generation with retries and pyttsx3 fallback."""
    tld = random.choice(GTTS_TLDS)
    slow = random.choice([True, False, False])  # 33% chance slow
    
    # Try gTTS up to 3 times if available
    if GTTS_AVAILABLE:
        for attempt in range(3):
            try:
                return generate_tts_audio_gtts(phrase, tld, slow)
            except Exception:
                time.sleep(0.5)
                tld = random.choice(GTTS_TLDS)
            
    # Fallback to pyttsx3 if gTTS fails completely or is unavailable
    if PYTTSX3_AVAILABLE:
        return generate_tts_audio_pyttsx3(phrase)
        
    raise RuntimeError("Failed to generate TTS audio via gTTS or pyttsx3")


def generate_synthetic_noise(length: int, noise_type: str) -> np.ndarray:
    """Generate synthetic background noise (white, pink, or hum)."""
    if noise_type == 'white':
        return np.random.normal(0, 1, length)
    elif noise_type == 'pink':
        # Pink noise approximation
        unequal = np.random.randn(length)
        b, a = scipy.signal.butter(1, 0.05)
        return scipy.signal.lfilter(b, a, unequal)
    elif noise_type == 'hum':
        # 50Hz or 60Hz power hum + harmonics
        t = np.arange(length) / 16000.0
        freq = random.choice([50.0, 60.0])
        hum = np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * freq * 2 * t)
        return hum
    else:
        return np.random.normal(0, 1, length)


def apply_augmentations(y: np.ndarray, sr: int = 16000) -> np.ndarray:
    """Apply speed, pitch, volume, and background noise augmentations."""
    # 1. Pitch shift (-2.5 to +2.5 semitones)
    if random.random() < 0.7:
        n_steps = random.uniform(-2.5, 2.5)
        y = librosa.effects.pitch_shift(y, sr=sr, n_steps=n_steps)
        
    # 2. Time stretch / Speed (0.85x to 1.2x)
    if random.random() < 0.7:
        rate = random.uniform(0.85, 1.2)
        y = librosa.effects.time_stretch(y, rate=rate)
        
    # 3. Trim silence and format duration (~1.0s padded/centered)
    y_trimmed, _ = librosa.effects.trim(y, top_db=25)
    if len(y_trimmed) > 0:
        y = y_trimmed
        
    target_length = int(sr * 1.0)  # 1 second standard keyword clip length
    if len(y) < target_length:
        pad_before = (target_length - len(y)) // 2
        pad_after = target_length - len(y) - pad_before
        y = np.pad(y, (pad_before, pad_after), mode='constant')
    elif len(y) > target_length:
        if len(y) > int(sr * 1.5):
            start = (len(y) - target_length) // 2
            y = y[start:start + target_length]
            
    # 4. Volume / Gain scaling (0.5x to 1.3x)
    gain = random.uniform(0.5, 1.3)
    y = y * gain
    
    # 5. Background noise mixing (70% probability)
    if random.random() < 0.7:
        noise_type = random.choice(['white', 'pink', 'hum'])
        noise = generate_synthetic_noise(len(y), noise_type)
        
        # Calculate SNR (12 dB to 28 dB)
        snr_db = random.uniform(12, 28)
        signal_power = np.mean(y ** 2) + 1e-8
        noise_power = np.mean(noise ** 2) + 1e-8
        
        factor = np.sqrt(signal_power / (10 ** (snr_db / 10) * noise_power))
        y = y + noise * factor

    # Normalize amplitude to avoid clipping
    max_val = np.max(np.abs(y)) + 1e-8
    if max_val > 0.99:
        y = y / max_val * 0.95
        
    return y.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description="Generate HELP dataset audio samples.")
    parser.add_argument("--count", type=int, default=300, help="Number of audio samples to generate (default: 300)")
    parser.add_argument("--output_dir", type=str, default=None, help="Directory to save WAV files")
    args = parser.parse_args()
    
    # Resolve output directory
    if args.output_dir:
        output_dir = args.output_dir
    else:
        if os.path.exists("/content/safestreets_dataset"):
            output_dir = "/content/safestreets_dataset/HELP"
        else:
            output_dir = os.path.join(os.getcwd(), "safestreets_dataset", "HELP")
            
    os.makedirs(output_dir, exist_ok=True)
    print(f"Dataset Output Directory: {output_dir}")
    print(f"Target sample count: {args.count}")
    print("Starting generation...\n")
    
    generated = 0
    failed_attempts = 0
    max_failures = 100
    
    start_time = time.time()
    
    while generated < args.count and failed_attempts < max_failures:
        phrase = random.choice(HELP_PHRASES)
        
        try:
            # Generate base TTS
            raw_audio = generate_raw_tts(phrase)
            
            # Apply augmentations
            aug_audio = apply_augmentations(raw_audio, sr=16000)
            
            # Unique filename
            filename = f"help_{generated + 1:04d}_{uuid.uuid4().hex[:8]}.wav"
            filepath = os.path.join(output_dir, filename)
            
            # Save 16kHz mono WAV file
            sf.write(filepath, aug_audio, 16000, subtype='PCM_16')
            
            generated += 1
            failed_attempts = 0  # reset failure counter on success
            
            # Report progress every 25 files or at final file
            if generated % 25 == 0 or generated == args.count:
                print(f"Generated {generated}/{args.count}")
                
        except Exception as e:
            failed_attempts += 1
            print(f"[Warning] Failed to generate sample ({e}). Retrying... (failures: {failed_attempts}/{max_failures})")
            time.sleep(0.5)
            
    elapsed = time.time() - start_time
    print(f"\nSuccessfully generated {generated} samples in {elapsed:.2f} seconds.")
    print(f"Files saved in: {output_dir}")


if __name__ == "__main__":
    main()
