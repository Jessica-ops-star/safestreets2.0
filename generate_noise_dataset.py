"""
generate_noise_dataset.py - SafeStreets NOISE Dataset Generator

Generates 300 realistic non-speech background sound samples.
Includes white noise, pink noise, electrical hum, street/traffic rumble, wind noise, mic static.
Outputs: 16 kHz, Mono, 16-bit PCM WAV files in ./safestreets_dataset/NOISE/
"""

import os
import random
import uuid
import argparse
import numpy as np
import scipy.signal
import soundfile as sf


def generate_white_noise(length: int, sr: int = 16000) -> np.ndarray:
    """Band-passed white noise (mic hiss / AC unit)."""
    noise = np.random.normal(0, 1, length)
    b, a = scipy.signal.butter(2, [100 / (sr / 2), 7000 / (sr / 2)], btype='band')
    filtered = scipy.signal.lfilter(b, a, noise)
    return filtered


def generate_pink_noise(length: int, sr: int = 16000) -> np.ndarray:
    """Pink noise (1/f power density, natural ambiance)."""
    white = np.random.randn(length)
    b, a = scipy.signal.butter(1, 0.05)
    pink = scipy.signal.lfilter(b, a, white)
    return pink


def generate_electrical_hum(length: int, sr: int = 16000) -> np.ndarray:
    """50Hz / 60Hz power line hum with harmonics + subtle background noise."""
    t = np.arange(length) / float(sr)
    base_freq = random.choice([50.0, 60.0])
    
    hum = (
        1.0 * np.sin(2 * np.pi * base_freq * t) +
        0.5 * np.sin(2 * np.pi * (base_freq * 2) * t) +
        0.25 * np.sin(2 * np.pi * (base_freq * 3) * t) +
        0.1 * np.sin(2 * np.pi * (base_freq * 4) * t)
    )
    hum += 0.2 * np.random.randn(length)
    return hum


def generate_street_traffic_noise(length: int, sr: int = 16000) -> np.ndarray:
    """Street / traffic low-frequency rumble + pass-by frequency sweep."""
    t = np.arange(length) / float(sr)
    white = np.random.randn(length)
    b, a = scipy.signal.butter(2, [30 / (sr / 2), 350 / (sr / 2)], btype='band')
    rumble = scipy.signal.lfilter(b, a, white)
    
    sweep_freq = np.linspace(80, 200, length)
    engine = 0.3 * np.sin(2 * np.pi * sweep_freq * t)
    
    return rumble + engine


def generate_wind_noise(length: int, sr: int = 16000) -> np.ndarray:
    """Wind noise with low frequency amplitude modulation."""
    t = np.arange(length) / float(sr)
    white = np.random.randn(length)
    b, a = scipy.signal.butter(2, 400 / (sr / 2), btype='low')
    wind_base = scipy.signal.lfilter(b, a, white)
    
    mod_freq = random.uniform(0.5, 1.5)
    modulation = 0.5 + 0.5 * np.sin(2 * np.pi * mod_freq * t + random.uniform(0, 2 * np.pi))
    
    return wind_base * modulation


def generate_mic_static(length: int, sr: int = 16000) -> np.ndarray:
    """Microphone static with occasional impulse pops/clicks."""
    static = 0.3 * np.random.randn(length)
    pop_count = random.randint(3, 12)
    pop_indices = np.random.randint(0, length, pop_count)
    static[pop_indices] += np.random.choice([-1.5, 1.5], size=pop_count)
    return static


def main():
    parser = argparse.ArgumentParser(description="Generate NOISE dataset audio samples.")
    parser.add_argument("--count", type=int, default=300, help="Number of NOISE samples (default: 300)")
    parser.add_argument("--output_dir", type=str, default="./safestreets_dataset/NOISE", help="Output directory")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    sr = 16000
    
    noise_generators = [
        ("white", generate_white_noise),
        ("pink", generate_pink_noise),
        ("hum", generate_electrical_hum),
        ("traffic", generate_street_traffic_noise),
        ("wind", generate_wind_noise),
        ("static", generate_mic_static)
    ]

    print(f"Dataset Output Directory: {args.output_dir}")
    print(f"Target NOISE sample count: {args.count}")

    for i in range(args.count):
        duration = random.uniform(1.0, 1.5)
        length = int(sr * duration)
        
        name, gen_func = random.choice(noise_generators)
        y = gen_func(length, sr)
        
        gain = random.uniform(0.2, 0.8)
        y = y * gain
        
        max_val = np.max(np.abs(y)) + 1e-8
        if max_val > 0.95:
            y = (y / max_val) * 0.90
            
        y = y.astype(np.float32)
        
        filename = f"noise_{name}_{i+1:04d}_{uuid.uuid4().hex[:6]}.wav"
        filepath = os.path.join(args.output_dir, filename)
        
        sf.write(filepath, y, sr, subtype='PCM_16')
        
        if (i + 1) % 25 == 0 or (i + 1) == args.count:
            print(f"Generated {i+1}/{args.count} NOISE samples")

    print("\nNOISE dataset generation finished successfully.")


if __name__ == "__main__":
    main()
