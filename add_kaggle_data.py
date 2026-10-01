import os
import random
import shutil
import wave
from pathlib import Path

# ============================================================
# CONFIGURATION
# ============================================================

PROJECT_DIR = Path(__file__).resolve().parent

# Change this ONLY if your Kaggle train folder is elsewhere.
KAGGLE_TRAIN_DIR = Path(r"C:\Users\jessi\Downloads\train.7z")

DATASET_DIR = PROJECT_DIR / "safestreets_dataset"

UNKNOWN_DIR = DATASET_DIR / "UNKNOWN"
NOISE_DIR = DATASET_DIR / "NOISE"

# Number of Kaggle UNKNOWN samples to add
UNKNOWN_PER_WORD = 25

# Number of 1-second noise samples to create
NOISE_SAMPLES = 500

RANDOM_SEED = 42
random.seed(RANDOM_SEED)


# ============================================================
# CHECK PATHS
# ============================================================

if not KAGGLE_TRAIN_DIR.exists():
    print()
    print("ERROR: Kaggle train folder was not found.")
    print()
    print("Current path:")
    print(KAGGLE_TRAIN_DIR)
    print()
    print("Change KAGGLE_TRAIN_DIR at the top of this script.")
    raise SystemExit(1)

UNKNOWN_DIR.mkdir(parents=True, exist_ok=True)
NOISE_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# UNKNOWN — SPOKEN WORDS
# ============================================================

# All these are ordinary spoken words that are NOT "HELP".
# We deliberately exclude anything that could be confused with
# the target keyword.
UNKNOWN_WORDS = [
    "bed",
    "bird",
    "cat",
    "dog",
    "down",
    "eight",
    "five",
    "four",
    "go",
    "happy",
    "house",
    "left",
    "marvin",
    "nine",
    "no",
    "off",
    "on",
    "one",
    "right",
    "seven",
    "sheila",
    "six",
    "stop",
    "three",
    "tree",
    "two",
    "up",
    "wow",
    "yes",
    "zero",
]


print()
print("========================================")
print("ADDING KAGGLE UNKNOWN DATA")
print("========================================")

total_unknown = 0

for word in UNKNOWN_WORDS:
    source_dir = KAGGLE_TRAIN_DIR / word

    if not source_dir.exists():
        print(f"Skipping missing folder: {word}")
        continue

    files = list(source_dir.glob("*.wav"))
    random.shuffle(files)

    selected = files[:UNKNOWN_PER_WORD]

    for index, src in enumerate(selected):
        destination = UNKNOWN_DIR / f"kaggle_{word}_{index:04d}.wav"

        if destination.exists():
            continue

        shutil.copy2(src, destination)
        total_unknown += 1

    print(f"{word:8s}: added {len(selected)}")

print()
print(f"Total UNKNOWN files added: {total_unknown}")


# ============================================================
# NOISE — BACKGROUND NOISE
# ============================================================

print()
print("========================================")
print("ADDING KAGGLE NOISE DATA")
print("========================================")

background_dir = KAGGLE_TRAIN_DIR / "_background_noise_"

if not background_dir.exists():
    print("ERROR: _background_noise_ folder not found.")
    raise SystemExit(1)

background_files = list(background_dir.glob("*.wav"))

if not background_files:
    print("ERROR: No background WAV files found.")
    raise SystemExit(1)

print(f"Background files found: {len(background_files)}")

noise_created = 0
noise_index = 0

# Create 1-second chunks from the background recordings.
for source in background_files:

    if noise_created >= NOISE_SAMPLES:
        break

    try:
        with wave.open(str(source), "rb") as wav:
            sample_rate = wav.getframerate()
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            total_frames = wav.getnframes()

            one_second = sample_rate

            if total_frames < one_second:
                continue

            # Random starting points give us different noise segments.
            starts = list(range(0, total_frames - one_second, one_second))

            random.shuffle(starts)

            for start in starts:

                if noise_created >= NOISE_SAMPLES:
                    break

                wav.setpos(start)
                frames = wav.readframes(one_second)

                destination = NOISE_DIR / (
                    f"kaggle_noise_{noise_index:04d}.wav"
                )

                with wave.open(str(destination), "wb") as output:
                    output.setnchannels(channels)
                    output.setsampwidth(sample_width)
                    output.setframerate(sample_rate)
                    output.writeframes(frames)

                noise_created += 1
                noise_index += 1

    except Exception as e:
        print(f"Could not process {source.name}: {e}")

print()
print(f"Total NOISE files created: {noise_created}")


# ============================================================
# FINAL SUMMARY
# ============================================================

print()
print("========================================")
print("DONE")
print("========================================")

print(f"UNKNOWN additions : {total_unknown}")
print(f"NOISE additions   : {noise_created}")

print()
print("Existing SafeStreets data was NOT deleted.")
print("real_voice_train was NOT modified.")
print("real_voice_test was NOT modified.")
print()