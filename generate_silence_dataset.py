"""
generate_silence_dataset.py - SafeStreets SILENCE Dataset Generator

Generates 300 near-silence audio samples with realistic room/mic noise floor (-45 dB to -70 dB).
Avoids pure digital zeros to prevent MFCC / log-mel numerical issues.
Outputs: 16 kHz, Mono, 16-bit PCM WAV files in ./safestreets_dataset/SILENCE/
"""

import os
import random
import uuid
import argparse
import numpy as np
import scipy.signal
import soundfile as sf


def generate_near_silence(length: int, sr: int = 16000) -> np.ndarray:
    """Generate near-silence clip with quiet room/thermal noise floor."""
    amplitude = random.uniform(0.0003, 0.005)
    
    # 1. Very faint thermal/white noise
    y = np.random.normal(0, amplitude, length)
    
    # 2. Add faint low-frequency room resonance (20Hz - 150Hz)
    if random.random() < 0.6:
        white = np.random.randn(length)
        b, a = scipy.signal.butter(2, [20 / (sr / 2), 150 / (sr / 2)], btype='band')
        room_rumble = scipy.signal.lfilter(b, a, white)
        room_rumble = room_rumble / (np.max(np.abs(room_rumble)) + 1e-8) * (amplitude * 0.5)
        y += room_rumble
        
    # 3. Add ultra-faint power line hum
    if random.random() < 0.4:
        t = np.arange(length) / float(sr)
        freq = random.choice([50.0, 60.0])
        hum = (amplitude * 0.3) * np.sin(2 * np.pi * freq * t)
        y += hum
        
    return y.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description="Generate SILENCE dataset audio samples.")
    parser.add_argument("--count", type=int, default=300, help="Number of SILENCE samples (default: 300)")
    parser.add_argument("--output_dir", type=str, default="./safestreets_dataset/SILENCE", help="Output directory")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    sr = 16000

    print(f"Dataset Output Directory: {args.output_dir}")
    print(f"Target SILENCE sample count: {args.count}")

    for i in range(args.count):
        duration = random.uniform(1.0, 1.5)
        length = int(sr * duration)
        
        y = generate_near_silence(length, sr)
        
        filename = f"silence_{i+1:04d}_{uuid.uuid4().hex[:6]}.wav"
        filepath = os.path.join(args.output_dir, filename)
        
        sf.write(filepath, y, sr, subtype='PCM_16')
        
        if (i + 1) % 25 == 0 or (i + 1) == args.count:
            print(f"Generated {i+1}/{args.count} SILENCE samples")

    print("\nSILENCE dataset generation finished successfully.")


if __name__ == "__main__":
    main()
