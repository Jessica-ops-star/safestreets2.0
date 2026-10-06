"""
predict_voice.py - SafeStreets Standalone Voice Model Inference Script

Loads trained SafeStreetsVoiceNet model checkpoint and metadata, accepts an audio WAV file,
and outputs predicted class, confidence percentage, and full class probability distribution.
"""

import os
import json
import argparse
import torch
import torch.nn.functional as F
import numpy as np
import librosa
import soundfile as sf

from model_architecture import SafeStreetsVoiceNet, CLASS_MAP
from dataset_utils import extract_log_mel_spectrogram


def predict_audio(
    audio_path: str,
    model_path: str = None,
    metadata_path: str = None,
    hop_sec: float = 0.25
):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if model_path is None or not os.path.exists(model_path):
        model_path = os.path.join(base_dir, "voice_model.pth")
    if metadata_path is None or not os.path.exists(metadata_path):
        metadata_path = os.path.join(base_dir, "model_metadata.json")

    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Input WAV file not found: {audio_path}")
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found: {model_path}. Please train model first.")
    if not os.path.exists(metadata_path):
        raise FileNotFoundError(f"Metadata file not found: {metadata_path}")

    # Load metadata
    with open(metadata_path, "r") as f:
        metadata = json.load(f)

    # Initialize and load model weights
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = SafeStreetsVoiceNet(num_classes=4).to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    # Load full audio recording (16,000 Hz, mono)
    try:
        y, file_sr = librosa.load(audio_path, sr=16000, mono=True)
    except Exception:
        y, file_sr = sf.read(audio_path, dtype="float32")
        if y.ndim > 1:
            y = np.mean(y, axis=1)
        if file_sr != 16000:
            y = librosa.resample(y, orig_sr=file_sr, target_sr=16000)

    target_samples = 16000  # 1.0 second window
    hop_samples = int(16000 * hop_sec)  # 250 ms hop

    if len(y) < target_samples:
        pad_len = target_samples - len(y)
        pad_left = pad_len // 2
        pad_right = pad_len - pad_left
        y = np.pad(y, (pad_left, pad_right), mode="constant")

    # Generate overlapping 1-second window start indices (hop = 250 ms)
    starts = list(range(0, len(y) - target_samples + 1, hop_samples))
    if len(starts) == 0 or (starts[-1] != len(y) - target_samples):
        starts.append(len(y) - target_samples)

    # Also calculate the Max-Energy 1-second window start (keyword alignment)
    max_energy = -1.0
    best_start = 0
    step = int(16000 * 0.1)  # 100 ms step
    for s_idx in range(0, len(y) - target_samples + 1, step):
        slice_energy = float(np.sum(y[s_idx:s_idx + target_samples] ** 2))
        if slice_energy > max_energy:
            max_energy = slice_energy
            best_start = s_idx

    if best_start not in starts:
        starts.append(best_start)

    window_results = []

    # 1. Evaluate Max-Energy Aligned Window (matches dataset_utils / evaluate_real_voice.py)
    try:
        max_energy_mel = extract_log_mel_spectrogram(audio_path)
        tensor_max_energy = torch.tensor(max_energy_mel, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(device)
        with torch.no_grad():
            logits_max = model(tensor_max_energy)
            probs_max = F.softmax(logits_max, dim=1).squeeze(0).cpu().numpy()

        top_idx_max = int(np.argmax(probs_max))
        window_results.append({
            "start_sec": "max_energy",
            "top_idx": top_idx_max,
            "probs": probs_max,
            "help_prob": float(probs_max[0]),
            "top_prob": float(probs_max[top_idx_max])
        })
    except Exception:
        pass

    # 2. Evaluate Overlapping 1-Second Sliding Windows (hop = 250 ms)
    for s in starts:
        y_win = y[s:s + target_samples]

        # Feature extraction (64, 101) Log-Mel Spectrogram for this 1-second window
        log_mel = extract_log_mel_spectrogram(y_win)
        tensor_input = torch.tensor(log_mel, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(device)

        with torch.no_grad():
            logits = model(tensor_input)
            probs = F.softmax(logits, dim=1).squeeze(0).cpu().numpy()

        top_idx = int(np.argmax(probs))
        window_results.append({
            "start_sec": round(s / 16000.0, 3),
            "top_idx": top_idx,
            "probs": probs,
            "help_prob": float(probs[0]),
            "top_prob": float(probs[top_idx])
        })

    # Decision Rule:
    # Check if ANY overlapping 1-second window predicts HELP (index 0) as its top class
    # or has strong HELP probability (>= 35%)
    help_windows = [w for w in window_results if (w["top_idx"] == 0 or w["help_prob"] >= 0.35)]

    if len(help_windows) > 0:
        # Select the HELP detection window with the strongest HELP probability
        best_window = max(help_windows, key=lambda w: w["help_prob"])
        predicted_idx = 0
    else:
        # If no window detected HELP, pick window with overall highest confidence
        best_window = max(window_results, key=lambda w: w["top_prob"])
        predicted_idx = best_window["top_idx"]

    predicted_class = CLASS_MAP[predicted_idx]
    confidence = float(best_window["probs"][predicted_idx]) * 100.0
    class_probs = {CLASS_MAP[i]: float(best_window["probs"][i] * 100.0) for i in range(len(best_window["probs"]))}

    return {
        "audio_file": audio_path,
        "predicted_class": predicted_class,
        "prediction": predicted_class,
        "confidence_pct": round(confidence, 2),
        "confidence": round(confidence, 2),
        "class_probabilities_pct": {k: round(v, 2) for k, v in class_probs.items()},
        "windows_evaluated": len(window_results)
    }


def main():
    parser = argparse.ArgumentParser(description="Predict audio class for a WAV file using SafeStreetsVoiceNet.")
    parser.add_argument("--audio_path", type=str, required=True, help="Path to input WAV file")
    parser.add_argument("--model_path", type=str, default=r"d:\SafeStreets\voice_model.pth", help="Path to voice_model.pth")
    parser.add_argument("--metadata_path", type=str, default=r"d:\SafeStreets\model_metadata.json", help="Path to model_metadata.json")
    args = parser.parse_args()

    result = predict_audio(args.audio_path, args.model_path, args.metadata_path)

    print("\n" + "=" * 55)
    print("        SafeStreets Voice Classification Inference")
    print("=" * 55)
    print(f"File Path        : {result['audio_file']}")
    print(f"Predicted Class  : {result['predicted_class']}")
    print(f"Confidence Score : {result['confidence_pct']:.2f}%")
    print("-" * 55)
    print("Class Probability Distribution:")
    for c_name, p_val in result['class_probabilities_pct'].items():
        print(f"  - {c_name:<10}: {p_val:>6.2f}%")
    print("-" * 55)
    print("[INFO] Audio prediction is an input signal for sensor fusion.")
    print("[INFO] No hardware SOS triggered.")
    print("=" * 55 + "\n")


if __name__ == "__main__":
    main()
