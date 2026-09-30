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

from model_architecture import SafeStreetsVoiceNet, CLASS_MAP
from dataset_utils import extract_log_mel_spectrogram


def predict_audio(
    audio_path: str,
    model_path: str = r"d:\SafeStreets\voice_model.pth",
    metadata_path: str = r"d:\SafeStreets\model_metadata.json"
):
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

    # Feature extraction (64, 101) Log-Mel Spectrogram
    log_mel = extract_log_mel_spectrogram(audio_path)
    tensor_input = torch.tensor(log_mel, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(device)

    # Run inference
    with torch.no_grad():
        logits = model(tensor_input)
        probs = F.softmax(logits, dim=1).squeeze(0).cpu().numpy()

    predicted_idx = int(np.argmax(probs))
    predicted_class = CLASS_MAP[predicted_idx]
    confidence = float(probs[predicted_idx]) * 100.0

    class_probs = {CLASS_MAP[i]: float(probs[i] * 100.0) for i in range(len(probs))}

    return {
        "audio_file": audio_path,
        "predicted_class": predicted_class,
        "confidence_pct": round(confidence, 2),
        "class_probabilities_pct": {k: round(v, 2) for k, v in class_probs.items()}
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
