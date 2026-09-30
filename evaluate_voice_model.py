"""
evaluate_voice_model.py - SafeStreets Dedicated Evaluation Script

Runs evaluation on the test set or custom WAV directories and outputs complete performance metrics,
confusion matrix breakdown, precision, recall, F1-scores, and HELP safety audit.
"""

import os
import json
import argparse
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from sklearn.metrics import confusion_matrix, classification_report, accuracy_score

from model_architecture import SafeStreetsVoiceNet, CLASS_MAP
from dataset_utils import SafeStreetsDataset, get_stratified_dataset_splits


def run_full_evaluation(
    dataset_dir: str = r"d:\SafeStreets\safestreets_dataset",
    model_path: str = r"d:\SafeStreets\voice_model.pth"
):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Loading model from: {model_path}")
    
    model = SafeStreetsVoiceNet(num_classes=4).to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    # Load test split
    _, _, (test_paths, test_labels) = get_stratified_dataset_splits(dataset_dir)
    test_dataset = SafeStreetsDataset(test_paths, test_labels, is_train=False)
    test_loader = DataLoader(test_dataset, batch_size=32, shuffle=False)

    all_preds = []
    all_targets = []
    criterion = nn.CrossEntropyLoss()
    total_loss = 0.0

    with torch.no_grad():
        for inputs, targets in test_loader:
            inputs, targets = inputs.to(device), targets.to(device)
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            total_loss += loss.item() * inputs.size(0)

            _, preds = torch.max(outputs, 1)
            all_preds.extend(preds.cpu().numpy())
            all_targets.extend(targets.cpu().numpy())

    test_loss = total_loss / len(all_targets)
    test_acc = accuracy_score(all_targets, all_preds)
    target_names = ["HELP", "UNKNOWN", "NOISE", "SILENCE"]

    print("\n" + "=" * 60)
    print("           SAFESTREETS VOICE MODEL EVALUATION REPORT")
    print("=" * 60)
    print(f"Total Test Samples : {len(all_targets)}")
    print(f"Test Loss          : {test_loss:.4f}")
    print(f"Test Accuracy      : {test_acc * 100:.2f}%\n")

    print("Classification Report:")
    print(classification_report(all_targets, all_preds, target_names=target_names, digits=4))

    cm = confusion_matrix(all_targets, all_preds)
    print("\nConfusion Matrix:")
    print("                 Predicted")
    print("                 HELP  UNKNOWN  NOISE  SILENCE")
    for idx, row in enumerate(cm):
        print(f"Actual {target_names[idx]:<8}: {row[0]:<5} {row[1]:<8} {row[2]:<6} {row[3]:<7}")

    help_actual = cm[0].sum()
    help_tp = cm[0][0]
    help_fn = help_actual - help_tp
    fp_unknown = cm[1][0]
    fp_noise = cm[2][0]
    fp_silence = cm[3][0]
    total_fp_help = fp_unknown + fp_noise + fp_silence

    print("\n" + "-" * 60)
    print("           HELP CLASS SAFETY AUDIT (FALSE POSITIVES)")
    print("-" * 60)
    print(f"Actual HELP Samples              : {help_actual}")
    print(f"True Positives (Correct HELP)    : {help_tp}/{help_actual} ({help_tp/help_actual*100:.2f}%)")
    print(f"False Negatives (Missed HELP)    : {help_fn}/{help_actual}")
    print(f"Total False Positives for HELP   : {total_fp_help}")
    print(f"  - Normal Speech -> HELP Alarms : {fp_unknown}")
    print(f"  - Noise        -> HELP Alarms : {fp_noise}")
    print(f"  - Silence      -> HELP Alarms : {fp_silence}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate SafeStreets Voice Model.")
    parser.add_argument("--dataset_dir", type=str, default=r"d:\SafeStreets\safestreets_dataset", help="Dataset directory")
    parser.add_argument("--model_path", type=str, default=r"d:\SafeStreets\voice_model.pth", help="Model file path")
    args = parser.parse_args()

    run_full_evaluation(args.dataset_dir, args.model_path)
