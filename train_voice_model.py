"""
train_voice_model.py - SafeStreets Voice Model Training & Checkpoint Saver

Trains SafeStreetsVoiceNet 4-class keyword spotting model on Log-Mel Spectrogram features.
Outputs:
- voice_model.pth (Best PyTorch model weights)
- model_metadata.json (Model parameters, class mappings, and final test metrics)
"""

import os
import json
import time
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from sklearn.metrics import confusion_matrix, classification_report, accuracy_score

from model_architecture import SafeStreetsVoiceNet, CLASS_MAP, count_parameters
from dataset_utils import SafeStreetsDataset, get_stratified_dataset_splits


def train_one_epoch(model, dataloader, criterion, optimizer, device):
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0

    for inputs, targets in dataloader:
        inputs, targets = inputs.to(device), targets.to(device)
        
        optimizer.zero_grad()
        outputs = model(inputs)
        loss = criterion(outputs, targets)
        loss.backward()
        optimizer.step()

        running_loss += loss.item() * inputs.size(0)
        _, preds = torch.max(outputs, 1)
        correct += torch.sum(preds == targets).item()
        total += inputs.size(0)

    epoch_loss = running_loss / total
    epoch_acc = correct / total
    return epoch_loss, epoch_acc


def evaluate_model(model, dataloader, criterion, device):
    model.eval()
    running_loss = 0.0
    all_preds = []
    all_targets = []

    with torch.no_grad():
        for inputs, targets in dataloader:
            inputs, targets = inputs.to(device), targets.to(device)
            outputs = model(inputs)
            loss = criterion(outputs, targets)

            running_loss += loss.item() * inputs.size(0)
            _, preds = torch.max(outputs, 1)
            
            all_preds.extend(preds.cpu().numpy())
            all_targets.extend(targets.cpu().numpy())

    total = len(all_targets)
    loss = running_loss / total
    acc = accuracy_score(all_targets, all_preds)
    return loss, acc, np.array(all_targets), np.array(all_preds)


def main():
    print("=" * 60)
    print("      SafeStreets Voice Classification Model Training")
    print("=" * 60)

    # 1. Device selection
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using compute device: {device}")

    # 2. Load dataset splits
    dataset_dir = r"d:\SafeStreets\safestreets_dataset"
    (train_paths, train_labels), (val_paths, val_labels), (test_paths, test_labels) = get_stratified_dataset_splits(dataset_dir)

    train_dataset = SafeStreetsDataset(train_paths, train_labels, is_train=True)
    val_dataset = SafeStreetsDataset(val_paths, val_labels, is_train=False)
    test_dataset = SafeStreetsDataset(test_paths, test_labels, is_train=False)

    batch_size = 32
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, num_workers=0)
    test_loader = DataLoader(test_dataset, batch_size=batch_size, shuffle=False, num_workers=0)

    # 3. Initialize Model
    model = SafeStreetsVoiceNet(num_classes=4).to(device)
    param_count = count_parameters(model)
    print(f"Model Architecture: SafeStreetsVoiceNet")
    print(f"Total Trainable Parameters: {param_count:,}\n")

    # 4. Loss & Optimizer (Apply slight extra penalty weight on HELP class to minimize false negatives)
    class_weights = torch.tensor([1.2, 1.0, 1.0, 1.0], dtype=torch.float32).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='min', factor=0.5, patience=3)

    # 5. Training Loop
    epochs = 30
    best_val_loss = float('inf')
    best_val_acc = 0.0
    model_save_path = r"d:\SafeStreets\voice_model.pth"
    metadata_save_path = r"d:\SafeStreets\model_metadata.json"

    print("Beginning Training Loop...")
    print("-" * 60)
    
    training_history = []
    start_time = time.time()

    for epoch in range(1, epochs + 1):
        t0 = time.time()
        train_loss, train_acc = train_one_epoch(model, train_loader, criterion, optimizer, device)
        val_loss, val_acc, _, _ = evaluate_model(model, val_loader, criterion, device)
        
        scheduler.step(val_loss)
        elapsed = time.time() - t0

        print(f"Epoch {epoch:02d}/{epochs:02d} [{elapsed:.1f}s] - "
              f"Train Loss: {train_loss:.4f}, Train Acc: {train_acc * 100:.2f}% | "
              f"Val Loss: {val_loss:.4f}, Val Acc: {val_acc * 100:.2f}%")

        training_history.append({
            "epoch": epoch,
            "train_loss": train_loss,
            "train_acc": train_acc,
            "val_loss": val_loss,
            "val_acc": val_acc
        })

        # Save best model checkpoint
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_val_acc = val_acc
            torch.save(model.state_dict(), model_save_path)
            print(f"  --> Best model saved to {model_save_path} (Val Loss: {val_loss:.4f}, Val Acc: {val_acc*100:.2f}%)")

    total_training_time = time.time() - start_time
    print("-" * 60)
    print(f"Training Complete in {total_training_time:.2f} seconds.")

    # 6. Test Set Evaluation
    print("\nLoading Best Model Checkpoint for Test Set Evaluation...")
    model.load_state_dict(torch.load(model_save_path))
    test_loss, test_acc, y_true, y_pred = evaluate_model(model, test_loader, criterion, device)

    print("\n" + "=" * 60)
    print("                  TEST SET EVALUATION RESULTS")
    print("=" * 60)
    print(f"Test Loss    : {test_loss:.4f}")
    print(f"Test Accuracy: {test_acc * 100:.2f}%\n")

    # Metrics per class
    target_names = ["HELP", "UNKNOWN", "NOISE", "SILENCE"]
    report_dict = classification_report(y_true, y_pred, target_names=target_names, output_dict=True)
    report_str = classification_report(y_true, y_pred, target_names=target_names, digits=4)
    
    print("Classification Report:")
    print(report_str)

    # Confusion Matrix
    cm = confusion_matrix(y_true, y_pred)
    print("\nConfusion Matrix:")
    print("                 Predicted")
    print("                 HELP  UNKNOWN  NOISE  SILENCE")
    for idx, row in enumerate(cm):
        print(f"Actual {target_names[idx]:<8}: {row[0]:<5} {row[1]:<8} {row[2]:<6} {row[3]:<7}")

    # Analyze HELP False Positives and False Negatives
    help_idx = 0
    help_actual_total = cm[help_idx].sum()
    help_true_positives = cm[help_idx][help_idx]
    help_false_negatives = help_actual_total - help_true_positives

    # False Positives for HELP: UNKNOWN, NOISE, SILENCE wrongly classified as HELP
    fp_unknown_as_help = cm[1][0]
    fp_noise_as_help = cm[2][0]
    fp_silence_as_help = cm[3][0]
    total_help_false_positives = fp_unknown_as_help + fp_noise_as_help + fp_silence_as_help

    print("\n" + "-" * 60)
    print("            HELP CLASS SAFETY AUDIT & CRITICAL METRICS")
    print("-" * 60)
    print(f"Actual HELP Samples in Test Set: {help_actual_total}")
    print(f"Correctly Triggered HELP (True Positives) : {help_true_positives}/{help_actual_total} ({help_true_positives/help_actual_total*100:.2f}%)")
    print(f"Missed HELP Emergencies (False Negatives)  : {help_false_negatives}/{help_actual_total}")
    print(f"Total False HELP Triggers (False Positives): {total_help_false_positives}")
    print(f"  - Normal Speech (UNKNOWN) -> HELP False Alarms: {fp_unknown_as_help}")
    print(f"  - Background Noise        -> HELP False Alarms: {fp_noise_as_help}")
    print(f"  - Silence                 -> HELP False Alarms: {fp_silence_as_help}")

    # Calculate actual model file size
    model_file_size_kb = os.path.getsize(model_save_path) / 1024.0

    # 7. Save Model Metadata JSON
    metadata = {
        "model_name": "SafeStreetsVoiceNet",
        "num_classes": 4,
        "class_map": CLASS_MAP,
        "inv_class_map": {str(k): v for k, v in CLASS_MAP.items()},
        "parameters_count": param_count,
        "model_file_size_kb": round(model_file_size_kb, 2),
        "audio_specs": {
            "sample_rate": 16000,
            "channels": 1,
            "duration_sec": 1.0,
            "n_mels": 64,
            "n_fft": 512,
            "hop_length": 160,
            "feature_shape": [1, 64, 101]
        },
        "dataset_split": {
            "train_samples": len(train_paths),
            "val_samples": len(val_paths),
            "test_samples": len(test_paths)
        },
        "test_results": {
            "test_loss": float(test_loss),
            "test_accuracy": float(test_acc),
            "classification_report": report_dict,
            "confusion_matrix": cm.tolist(),
            "help_safety_metrics": {
                "help_true_positives": int(help_true_positives),
                "help_false_negatives": int(help_false_negatives),
                "help_false_positives": int(total_help_false_positives),
                "fp_unknown_as_help": int(fp_unknown_as_help),
                "fp_noise_as_help": int(fp_noise_as_help),
                "fp_silence_as_help": int(fp_silence_as_help)
            }
        }
    }

    with open(metadata_save_path, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\nSaved metadata JSON to: {metadata_save_path}")
    print(f"Model file size on disk: {model_file_size_kb:.2f} KB")
    print("=" * 60)


if __name__ == "__main__":
    main()
