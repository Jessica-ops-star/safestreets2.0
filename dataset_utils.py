"""
dataset_utils.py - SafeStreets Audio Dataset Utilities & Feature Extraction

Handles loading 16kHz mono WAV files, padding/truncating to exactly 1.0 second (16000 samples),
extracting 64-band Log-Mel Spectrograms, applying dynamic conservative audio augmentation
for real HELP training data, applying SpecAugment (training only), and stratified train/val/test data splitting.
"""

import os
import random
import numpy as np
import librosa
import soundfile as sf
import torch
from torch.utils.data import Dataset
from sklearn.model_selection import train_test_split

CLASS_MAP = {"HELP": 0, "UNKNOWN": 1, "NOISE": 2, "SILENCE": 3}


def extract_log_mel_spectrogram(
    audio_input,
    sr: int = 16000,
    n_mels: int = 64,
    n_fft: int = 512,
    hop_length: int = 160,
    target_duration: float = 1.0
) -> np.ndarray:
    """
    Load WAV audio (or accept waveform numpy array), format to target duration (1.0 sec = 16,000 samples),
    and compute 64-band Log-Mel Spectrogram of shape (64, 101).
    """
    target_samples = int(sr * target_duration)

    if isinstance(audio_input, (str, bytes, os.PathLike)):
        try:
            y, file_sr = librosa.load(audio_input, sr=sr, mono=True)
        except Exception:
            # Fallback to soundfile loading
            data, file_sr = sf.read(audio_input)
            if data.ndim > 1:
                data = np.mean(data, axis=1)
            if file_sr != sr:
                data = librosa.resample(data, orig_sr=file_sr, target_sr=sr)
            y = data
    else:
        y = np.array(audio_input, dtype=np.float32)

    # Pad or crop audio clip to exactly target_samples (16,000)
    if len(y) < target_samples:
        pad_len = target_samples - len(y)
        pad_left = pad_len // 2
        pad_right = pad_len - pad_left
        y = np.pad(y, (pad_left, pad_right), mode='constant')
    elif len(y) > target_samples:
        # Max-Energy Sliding-Window keyword alignment preprocessing
        # Replaces naive center cropping (start = (len(y) - target_samples) // 2)
        # to ensure spoken emergency keyword audio is aligned and captured rather than arbitrary silence/pauses.
        max_energy = -1.0
        best_start = 0
        step = int(sr * 0.1)  # 100 ms step window

        for s in range(0, len(y) - target_samples + 1, step):
            slice_energy = np.sum(y[s:s + target_samples] ** 2)
            if slice_energy > max_energy:
                max_energy = slice_energy
                best_start = s

        y = y[best_start:best_start + target_samples]

    # Compute Mel Spectrogram
    mel_spec = librosa.feature.melspectrogram(
        y=y,
        sr=sr,
        n_fft=n_fft,
        hop_length=hop_length,
        n_mels=n_mels,
        power=2.0
    )

    # Convert to Log-Mel Spectrogram (dB scale)
    log_mel = librosa.power_to_db(mel_spec, ref=np.max)

    # Standardize / Normalize feature range to zero-mean and unit variance
    mean = np.mean(log_mel)
    std = np.std(log_mel) + 1e-6
    normalized_mel = (log_mel - mean) / std

    return normalized_mel.astype(np.float32)


def augment_real_audio(y: np.ndarray, sr: int = 16000) -> np.ndarray:
    """
    Conservative waveform audio augmentation for real voice training samples:
    - Small volume/gain variation (0.8x to 1.2x)
    - Small time shift (up to ±500 samples ~30ms)
    - Optional low-level Gaussian noise injection
    """
    y_aug = y.copy()

    # 1. Gain / Volume variation
    gain = random.uniform(0.8, 1.2)
    y_aug = y_aug * gain

    # 2. Small time shift
    shift = random.randint(-500, 500)
    y_aug = np.roll(y_aug, shift)

    # 3. Small noise injection (50% probability)
    if random.random() < 0.5:
        noise_level = random.uniform(0.001, 0.004)
        noise = np.random.normal(0, noise_level, size=len(y_aug))
        y_aug = y_aug + noise

    return y_aug


def apply_spec_augment(
    mel_spec: np.ndarray,
    max_freq_mask: int = 8,
    max_time_mask: int = 12
) -> np.ndarray:
    """
    Apply SpecAugment: Random frequency and time masking on 2D Mel Spectrogram (64, 101).
    Applied ONLY on training set to improve model generalization.
    """
    augmented = mel_spec.copy()
    num_mels, num_frames = augmented.shape

    # 1. Frequency masking
    f_len = random.randint(0, max_freq_mask)
    f0 = random.randint(0, max(0, num_mels - f_len))
    augmented[f0:f0 + f_len, :] = 0.0

    # 2. Time masking
    t_len = random.randint(0, max_time_mask)
    t0 = random.randint(0, max(0, num_frames - t_len))
    augmented[:, t0:t0 + t_len] = 0.0

    return augmented


class SafeStreetsDataset(Dataset):
    """PyTorch Dataset for SafeStreets audio samples with dynamic real-HELP oversampling & augmentation."""
    def __init__(self, filepaths: list, labels: list, is_train: bool = False, real_help_oversample_factor: int = 25):
        self.is_train = is_train

        if is_train and real_help_oversample_factor > 1:
            expanded_paths = []
            expanded_labels = []
            for path, lbl in zip(filepaths, labels):
                if "real_voice_train" in path:
                    # Oversample real HELP training files by factor (e.g. 25x)
                    expanded_paths.extend([path] * real_help_oversample_factor)
                    expanded_labels.extend([lbl] * real_help_oversample_factor)
                else:
                    expanded_paths.append(path)
                    expanded_labels.append(lbl)
            self.filepaths = expanded_paths
            self.labels = expanded_labels
        else:
            self.filepaths = list(filepaths)
            self.labels = list(labels)

    def __len__(self) -> int:
        return len(self.filepaths)

    def __getitem__(self, idx: int):
        filepath = self.filepaths[idx]
        label = self.labels[idx]

        # Dynamic augmentation for real HELP training files
        is_real_help = "real_voice_train" in filepath

        if self.is_train and is_real_help:
            try:
                y, sr = librosa.load(filepath, sr=16000, mono=True)
            except Exception:
                data, sr = sf.read(filepath)
                if data.ndim > 1:
                    data = np.mean(data, axis=1)
                y = data
            y = augment_real_audio(y)
            mel = extract_log_mel_spectrogram(y)
        else:
            mel = extract_log_mel_spectrogram(filepath)

        if self.is_train:
            mel = apply_spec_augment(mel)

        # Reshape to (1, 64, 101) for 2D Conv PyTorch model input
        tensor_mel = torch.tensor(mel, dtype=torch.float32).unsqueeze(0)
        tensor_label = torch.tensor(label, dtype=torch.long)

        return tensor_mel, tensor_label


def get_stratified_dataset_splits(
    dataset_dir: str = None,
    real_train_dir: str = None,
    train_ratio: float = 0.70,
    val_ratio: float = 0.15,
    test_ratio: float = 0.15,
    seed: int = 42
):
    """
    Discovers synthetic dataset files and splits them 70% Train, 15% Validation, 15% Test.
    ALL real_voice_train/HELP recordings are assigned exclusively to the TRAIN split.
    Zero real HELP recordings enter Validation or Test splits.
    """
    if dataset_dir is None:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dataset_dir = os.path.join(base_dir, "safestreets_dataset")
    if real_train_dir is None:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        real_train_dir = os.path.join(base_dir, "real_voice_train")

    synthetic_filepaths = []
    synthetic_labels = []
    class_counts = {}

    for class_name, class_idx in CLASS_MAP.items():
        class_folder = os.path.join(dataset_dir, class_name)
        if not os.path.exists(class_folder):
            raise FileNotFoundError(f"Dataset directory missing: {class_folder}")

        files = [os.path.join(class_folder, f) for f in os.listdir(class_folder) if f.endswith('.wav')]
        class_counts[class_name] = len(files)
        print(f"Discovered {len(files)} synthetic files for class '{class_name}' (label: {class_idx})")

        synthetic_filepaths.extend(files)
        synthetic_labels.extend([class_idx] * len(files))

    # Stratified split on synthetic files
    train_paths, temp_paths, train_labels, temp_labels = train_test_split(
        synthetic_filepaths,
        synthetic_labels,
        test_size=(val_ratio + test_ratio),
        stratify=synthetic_labels,
        random_state=seed
    )

    val_paths, test_paths, val_labels, test_labels = train_test_split(
        temp_paths,
        temp_labels,
        test_size=0.50,
        stratify=temp_labels,
        random_state=seed
    )

    # Discover real HELP files and force 100% of them into TRAIN split ONLY
    real_help_files = []
    real_help_folder = os.path.join(real_train_dir, "HELP")
    if os.path.exists(real_help_folder):
        real_help_files = [os.path.join(real_help_folder, f) for f in os.listdir(real_help_folder) if f.endswith('.wav')]

    print(f"Discovered {len(real_help_files)} real HELP files for training.")

    # Append ALL real HELP files ONLY to the TRAIN split
    train_paths = list(train_paths) + list(real_help_files)
    train_labels = list(train_labels) + [CLASS_MAP["HELP"]] * len(real_help_files)

    # Count breakdown for logging
    synth_help_train = sum(1 for p, l in zip(train_paths, train_labels) if l == CLASS_MAP["HELP"] and "real_voice_train" not in p)
    synth_help_val = sum(1 for p, l in zip(val_paths, val_labels) if l == CLASS_MAP["HELP"] and "real_voice_train" not in p)
    synth_help_test = sum(1 for p, l in zip(test_paths, test_labels) if l == CLASS_MAP["HELP"] and "real_voice_train" not in p)

    real_help_train = sum(1 for p in train_paths if "real_voice_train" in p)
    real_help_val = sum(1 for p in val_paths if "real_voice_train" in p)
    real_help_test = sum(1 for p in test_paths if "real_voice_train" in p)

    oversample_factor = 25
    effective_real_help_train = real_help_train * oversample_factor

    counts_info = {
        "synthetic_help_train": synth_help_train,
        "synthetic_help_val": synth_help_val,
        "synthetic_help_test": synth_help_test,
        "real_help_train": real_help_train,
        "real_help_val": real_help_val,
        "real_help_test": real_help_test,
        "real_help_oversample_factor": oversample_factor,
        "effective_real_help_train_exposure": effective_real_help_train,
        "total_train_samples": len(train_paths),
        "val_samples": len(val_paths),
        "test_samples": len(test_paths)
    }

    print("\n" + "=" * 50)
    print("      DATASET SPLIT & OVER-SAMPLING SUMMARY")
    print("=" * 50)
    print("Synthetic HELP:")
    print(f"  train count      : {synth_help_train}")
    print(f"  validation count : {synth_help_val}")
    print(f"  test count       : {synth_help_test}")
    print("\nReal HELP:")
    print(f"  train count      : {real_help_train}")
    print(f"  validation count : {real_help_val}")
    print(f"  test count       : {real_help_test}")
    print(f"\nEffective real HELP samples per epoch after oversampling ({oversample_factor}x): {effective_real_help_train}")
    print("=" * 50 + "\n")

    return (train_paths, train_labels), (val_paths, val_labels), (test_paths, test_labels), counts_info


if __name__ == "__main__":
    train_data, val_data, test_data, info = get_stratified_dataset_splits()
    train_dataset = SafeStreetsDataset(train_data[0], train_data[1], is_train=True)
    print("Effective training dataset length after 25x oversampling:", len(train_dataset))


