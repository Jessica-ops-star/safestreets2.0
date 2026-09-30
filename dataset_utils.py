"""
dataset_utils.py - SafeStreets Audio Dataset Utilities & Feature Extraction

Handles loading 16kHz mono WAV files, padding/truncating to exactly 1.0 second (16000 samples),
extracting 64-band Log-Mel Spectrograms, applying SpecAugment (training only),
and stratified train/val/test data splitting.
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
    filepath: str,
    sr: int = 16000,
    n_mels: int = 64,
    n_fft: int = 512,
    hop_length: int = 160,
    target_duration: float = 1.0
) -> np.ndarray:
    """
    Load WAV audio, format to target duration (1.0 sec = 16,000 samples),
    and compute 64-band Log-Mel Spectrogram of shape (64, 101).
    """
    target_samples = int(sr * target_duration)
    
    try:
        y, file_sr = librosa.load(filepath, sr=sr, mono=True)
    except Exception:
        # Fallback to soundfile loading
        data, file_sr = sf.read(filepath)
        if data.ndim > 1:
            data = np.mean(data, axis=1)
        if file_sr != sr:
            data = librosa.resample(data, orig_sr=file_sr, target_sr=sr)
        y = data
        
    # Pad or crop audio clip to exactly target_samples (16,000)
    if len(y) < target_samples:
        pad_len = target_samples - len(y)
        pad_left = pad_len // 2
        pad_right = pad_len - pad_left
        y = np.pad(y, (pad_left, pad_right), mode='constant')
    elif len(y) > target_samples:
        start = (len(y) - target_samples) // 2
        y = y[start:start + target_samples]

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
    
    # Standardize / Normalize feature range to [0, 1] or zero-mean
    mean = np.mean(log_mel)
    std = np.std(log_mel) + 1e-6
    normalized_mel = (log_mel - mean) / std

    return normalized_mel.astype(np.float32)


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
    """PyTorch Dataset for SafeStreets audio samples."""
    def __init__(self, filepaths: list, labels: list, is_train: bool = False):
        self.filepaths = filepaths
        self.labels = labels
        self.is_train = is_train

    def __len__(self) -> int:
        return len(self.filepaths)

    def __getitem__(self, idx: int):
        filepath = self.filepaths[idx]
        label = self.labels[idx]
        
        mel = extract_log_mel_spectrogram(filepath)
        
        if self.is_train:
            mel = apply_spec_augment(mel)
            
        # Reshape to (1, 64, 101) for 2D Conv PyTorch model input
        tensor_mel = torch.tensor(mel, dtype=torch.float32).unsqueeze(0)
        tensor_label = torch.tensor(label, dtype=torch.long)
        
        return tensor_mel, tensor_label


def get_stratified_dataset_splits(
    dataset_dir: str = r"d:\SafeStreets\safestreets_dataset",
    train_ratio: float = 0.70,
    val_ratio: float = 0.15,
    test_ratio: float = 0.15,
    seed: int = 42
):
    """
    Discovers all WAV files in HELP, UNKNOWN, NOISE, SILENCE folders
    and splits them into 70% Train, 15% Validation, 15% Test set using
    stratified splitting to ensure exact class balance and zero data leakage.
    """
    all_filepaths = []
    all_labels = []
    
    for class_name, class_idx in CLASS_MAP.items():
        class_folder = os.path.join(dataset_dir, class_name)
        if not os.path.exists(class_folder):
            raise FileNotFoundError(f"Dataset directory missing: {class_folder}")
            
        files = [os.path.join(class_folder, f) for f in os.listdir(class_folder) if f.endswith('.wav')]
        print(f"Found {len(files)} files for class '{class_name}' (label: {class_idx})")
        
        all_filepaths.extend(files)
        all_labels.extend([class_idx] * len(files))

    # First split: Train (70%) vs Temp (30%)
    train_paths, temp_paths, train_labels, temp_labels = train_test_split(
        all_filepaths,
        all_labels,
        test_size=(val_ratio + test_ratio),
        stratify=all_labels,
        random_state=seed
    )
    
    # Second split: Val (15%) vs Test (15%)
    val_paths, test_paths, val_labels, test_labels = train_test_split(
        temp_paths,
        temp_labels,
        test_size=0.50,  # Half of 30% = 15%
        stratify=temp_labels,
        random_state=seed
    )

    print("\nDataset Stratified Split Summary:")
    print(f"  Total samples: {len(all_filepaths)}")
    print(f"  Training set   (70%): {len(train_paths)} samples")
    print(f"  Validation set (15%): {len(val_paths)} samples")
    print(f"  Testing set    (15%): {len(test_paths)} samples\n")
    
    return (train_paths, train_labels), (val_paths, val_labels), (test_paths, test_labels)


if __name__ == "__main__":
    train_data, val_data, test_data = get_stratified_dataset_splits()
    sample_mel = extract_log_mel_spectrogram(train_data[0][0])
    print("Extracted sample Log-Mel shape:", sample_mel.shape)
