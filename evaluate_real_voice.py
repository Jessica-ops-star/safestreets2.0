"""
evaluate_real_voice.py - SafeStreets Real-World Voice Evaluation Script

Evaluates the pre-trained SafeStreetsVoiceNet model on real human voice recordings.
Expected folder structure:
  real_voice_test/
      HELP/
      UNKNOWN/
      NOISE/
      SILENCE/

Features:
- Loads voice_model.pth and model_metadata.json
- Does NOT modify or retrain the model
- Uses exact dataset_utils preprocessing (16kHz mono, 1.0s window, 64-band Log-Mel Spectrogram)
- Prints individual prediction & confidence percentage for every audio file
- Reports overall accuracy, confusion matrix, precision, recall, F1-score per class
- Detailed HELP safety audit: UNKNOWN -> HELP false positives, NOISE -> HELP false positives, SILENCE -> HELP false positives, and HELP -> UNKNOWN missed detections.
"""

import os
import json
import argparse
import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import confusion_matrix, classification_report, accuracy_score

from model_architecture import SafeStreetsVoiceNet, CLASS_MAP
from dataset_utils import extract_log_mel_spectrogram


PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TEST_DIR = os.path.join(PROJECT_DIR, "real_voice_test")
DEFAULT_MODEL_PATH = os.path.join(PROJECT_DIR, "voice_model.pth")
DEFAULT_METADATA_PATH = os.path.join(PROJECT_DIR, "model_metadata.json")


def create_directory_structure(target_dir: str):
    """Creates real_voice_test directory structure if it doesn't exist."""
    classes = ["HELP", "UNKNOWN", "NOISE", "SILENCE"]
    os.makedirs(target_dir, exist_ok=True)
    for c in classes:
        os.makedirs(os.path.join(target_dir, c), exist_ok=True)


def evaluate_real_world_dataset(
    test_dir: str = None,
    model_path: str = None,
    metadata_path: str = None
):
    if test_dir is None:
        test_dir = DEFAULT_TEST_DIR
    if model_path is None:
        model_path = DEFAULT_MODEL_PATH
    if metadata_path is None:
        metadata_path = DEFAULT_METADATA_PATH

    # Ensure directory structure exists
    create_directory_structure(test_dir)

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found: {model_path}")
    if not os.path.exists(metadata_path):
        raise FileNotFoundError(f"Metadata file not found: {metadata_path}")

    # Load metadata
    with open(metadata_path, "r") as f:
        metadata = json.load(f)

    # Initialize PyTorch device & load model
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = SafeStreetsVoiceNet(num_classes=4).to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    target_names = ["HELP", "UNKNOWN", "NOISE", "SILENCE"]
    inv_map = {name: idx for idx, name in enumerate(target_names)}

    all_file_results = []
    y_true = []
    y_pred = []

    print("=" * 70)
    print("      SafeStreets Real Voice Evaluation - Individual Predictions")
    print("=" * 70)
    print(f"{'Filename':<35} | {'True Label':<10} | {'Predicted':<10} | {'Confidence':<10}")
    print("-" * 70)

    total_files_found = 0

    for class_name in target_names:
        class_folder = os.path.join(test_dir, class_name)
        if not os.path.exists(class_folder):
            continue

        wav_files = [f for f in os.listdir(class_folder) if f.endswith(".wav")]
        for wav_file in wav_files:
            file_path = os.path.join(class_folder, wav_file)
            total_files_found += 1

            # Exact preprocessing match (16kHz mono, 1.0s clip, 64 Log-Mel)
            log_mel = extract_log_mel_spectrogram(file_path)
            tensor_input = torch.tensor(log_mel, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(device)

            with torch.no_grad():
                logits = model(tensor_input)
                probs = F.softmax(logits, dim=1).squeeze(0).cpu().numpy()

            pred_idx = int(np.argmax(probs))
            pred_class = CLASS_MAP[pred_idx]
            confidence = float(probs[pred_idx]) * 100.0

            true_idx = inv_map[class_name]
            y_true.append(true_idx)
            y_pred.append(pred_idx)

            print(f"{wav_file[:34]:<35} | {class_name:<10} | {pred_class:<10} | {confidence:>8.2f}%")

            all_file_results.append({
                "file": wav_file,
                "path": file_path,
                "true_class": class_name,
                "predicted_class": pred_class,
                "confidence_pct": confidence,
                "probabilities": {CLASS_MAP[i]: float(probs[i] * 100.0) for i in range(len(probs))}
            })

    print("-" * 70)
    if total_files_found == 0:
        print("\n[NOTICE] No WAV files found in 'real_voice_test/'.")
        print(f"Directory structure created and ready at: {os.path.abspath(test_dir)}")
        print("Please add real .wav files to HELP, UNKNOWN, NOISE, SILENCE subdirectories and re-run.")
        print("=" * 70 + "\n")
        return

    print("\n" + "=" * 70)
    print("      DIAGNOSTIC - COMPLETE PROBABILITY DISTRIBUTIONS PER FILE")
    print("=" * 70)
    for res in all_file_results:
        print(f"Filename             : {res['file']}")
        print(f"Predicted Class      : {res['predicted_class']}")
        print(f"Predicted Confidence : {res['confidence_pct']:.2f}%")
        print(f"Highest HELP Prob    : {res['probabilities']['HELP']:.2f}%")
        print("Probability Distribution:")
        print(f"  HELP       {res['probabilities']['HELP']:>6.2f}%")
        print(f"  UNKNOWN    {res['probabilities']['UNKNOWN']:>6.2f}%")
        print(f"  NOISE      {res['probabilities']['NOISE']:>6.2f}%")
        print(f"  SILENCE    {res['probabilities']['SILENCE']:>6.2f}%")
        print("-" * 70)


    # Calculate Evaluation Metrics
    acc = accuracy_score(y_true, y_pred)
    cm = confusion_matrix(y_true, y_pred, labels=[0, 1, 2, 3])
    report_dict = classification_report(y_true, y_pred, labels=[0, 1, 2, 3], target_names=target_names, output_dict=True, zero_division=0)
    report_str = classification_report(y_true, y_pred, labels=[0, 1, 2, 3], target_names=target_names, digits=4, zero_division=0)

    print("\n" + "=" * 70)
    print("            REAL VOICE EVALUATION SUMMARY REPORT")
    print("=" * 70)
    print(f"Total Real Audio Samples Evaluated: {total_files_found}")
    print(f"Overall Accuracy                  : {acc * 100:.2f}%\n")

    print("Detailed Classification Report:")
    print(report_str)

    print("\nConfusion Matrix:")
    print("                 Predicted")
    print("                 HELP  UNKNOWN  NOISE  SILENCE")
    for idx, row in enumerate(cm):
        print(f"Actual {target_names[idx]:<8}: {row[0]:<5} {row[1]:<8} {row[2]:<6} {row[3]:<7}")

    # Specific HELP safety metrics
    help_actual = cm[0].sum()
    help_tp = cm[0][0]
    help_to_unknown = cm[0][1]                 # Specific HELP -> UNKNOWN missed

    fp_unknown_as_help = cm[1][0]
    fp_noise_as_help = cm[2][0]
    fp_silence_as_help = cm[3][0]
    total_help_fp = fp_unknown_as_help + fp_noise_as_help + fp_silence_as_help

    help_precision = report_dict["HELP"]["precision"] * 100.0
    help_recall = report_dict["HELP"]["recall"] * 100.0

    print("\n" + "-" * 70)
    print("         CRITICAL HELP SAFETY METRICS & AUDIT")
    print("-" * 70)
    print(f"HELP Class Precision              : {help_precision:.2f}%")
    print(f"HELP Class Recall                 : {help_recall:.2f}%")
    print(f"HELP -> UNKNOWN Missed Detections : {help_to_unknown} / {help_actual}")
    print(f"Total False Positives for HELP   : {total_help_fp}")
    print(f"  - UNKNOWN (Speech) -> HELP      : {fp_unknown_as_help}")
    print(f"  - NOISE            -> HELP      : {fp_noise_as_help}")
    print(f"  - SILENCE          -> HELP      : {fp_silence_as_help}")
    print("=" * 70 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Evaluate SafeStreets voice model on real human voice dataset.")
    parser.add_argument("--test_dir", type=str, default=DEFAULT_TEST_DIR, help="Directory containing real voice evaluation dataset")
    parser.add_argument("--model_path", type=str, default=DEFAULT_MODEL_PATH, help="Path to voice_model.pth")
    parser.add_argument("--metadata_path", type=str, default=DEFAULT_METADATA_PATH, help="Path to model_metadata.json")
    args = parser.parse_args()

    evaluate_real_world_dataset(args.test_dir, args.model_path, args.metadata_path)


if __name__ == "__main__":
    main()
