"""
train_voice_model.py - SafeStreets Voice Model Training & Checkpoint Saver

Trains SafeStreetsVoiceNet 4-class keyword spotting model on Log-Mel Spectrogram features.
Outputs:
- voice_model.pth (Best PyTorch model weights)
- model_metadata.json (Model parameters, class mappings, dataset splits, and 3-part test metrics)
"""

import os
import json
import time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from sklearn.metrics import confusion_matrix, classification_report, accuracy_score

from model_architecture import SafeStreetsVoiceNet, CLASS_MAP, count_parameters
from dataset_utils import SafeStreetsDataset, get_stratified_dataset_splits, extract_log_mel_spectrogram


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


def evaluate_dataset_loader(model, dataloader, criterion, device):
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
    loss = running_loss / total if total > 0 else 0.0
    acc = accuracy_score(all_targets, all_preds) if total > 0 else 0.0
    return loss, acc, np.array(all_targets), np.array(all_preds)


def evaluate_untouched_real_help_files(model, device, test_dir=None):
    if test_dir is None:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        test_dir = os.path.join(base_dir, "real_voice_test", "HELP")

    if not os.path.exists(test_dir):
        print(f"[WARNING] Untouched real HELP folder not found at: {test_dir}")
        return {}

    wav_files = [f for f in os.listdir(test_dir) if f.endswith(".wav")]
    results = []
    correct_count = 0

    print("\n" + "=" * 80)
    print("      EVALUATION C: ORIGINAL 6 UNTOUCHED REAL HELP RECORDINGS")
    print("=" * 80)
    print(f"{'Filename':<34} | {'Actual':<6} | {'Pred':<8} | {'Conf %':<7} | {'HELP %':<7} | {'UNK %':<7} | {'NOISE %':<7} | {'SIL %':<6}")
    print("-" * 80)

    for wav_file in sorted(wav_files):
        file_path = os.path.join(test_dir, wav_file)
        log_mel = extract_log_mel_spectrogram(file_path)
        tensor_input = torch.tensor(log_mel, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(device)

        with torch.no_grad():
            logits = model(tensor_input)
            probs = F.softmax(logits, dim=1).squeeze(0).cpu().numpy()

        pred_idx = int(np.argmax(probs))
        pred_class = CLASS_MAP[pred_idx]
        confidence = float(probs[pred_idx]) * 100.0

        if pred_class == "HELP":
            correct_count += 1

        p_help = float(probs[0] * 100.0)
        p_unknown = float(probs[1] * 100.0)
        p_noise = float(probs[2] * 100.0)
        p_silence = float(probs[3] * 100.0)

        print(f"{wav_file[:33]:<34} | HELP   | {pred_class:<8} | {confidence:>6.2f}% | {p_help:>6.2f}% | {p_unknown:>6.2f}% | {p_noise:>6.2f}% | {p_silence:>6.2f}%")

        results.append({
            "filename": wav_file,
            "actual_class": "HELP",
            "predicted_class": pred_class,
            "confidence_pct": round(confidence, 2),
            "probabilities_pct": {
                "HELP": round(p_help, 2),
                "UNKNOWN": round(p_unknown, 2),
                "NOISE": round(p_noise, 2),
                "SILENCE": round(p_silence, 2)
            }
        })

    total_files = len(wav_files)
    accuracy = (correct_count / total_files) if total_files > 0 else 0.0
    recall = accuracy
    missed_count = total_files - correct_count

    print("-" * 80)
    print(f"Untouched Real HELP Total Files : {total_files}")
    print(f"Correctly Identified (TP)      : {correct_count} / {total_files}")
    print(f"Missed HELP Emergencies (FN)   : {missed_count} / {total_files}")
    print(f"Untouched Real HELP Accuracy   : {accuracy * 100.0:.2f}%")
    print(f"Untouched Real HELP Recall     : {recall * 100.0:.2f}%")
    print("=" * 80 + "\n")

    return {
        "file_results": results,
        "total_files": total_files,
        "correct_count": correct_count,
        "missed_count": missed_count,
        "real_help_accuracy": float(accuracy),
        "real_help_recall": float(recall)
    }


def main():
    print("=" * 60)
    print("      SafeStreets Voice Classification Model Training")
    print("=" * 60)

    # 1. Device selection
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using compute device: {device}\n")

    # 2. Load dataset splits
    (train_paths, train_labels), (val_paths, val_labels), (synth_test_paths, synth_test_labels), (real_eval_paths, real_eval_labels), counts_info = get_stratified_dataset_splits(seed=42)

    # 3x oversampling on real voice training data to balance with synthetic while providing dynamic augmentations
    real_oversample_factor = 3
    train_dataset = SafeStreetsDataset(train_paths, train_labels, is_train=True, real_oversample_factor=real_oversample_factor)
    val_dataset = SafeStreetsDataset(val_paths, val_labels, is_train=False)
    synth_test_dataset = SafeStreetsDataset(synth_test_paths, synth_test_labels, is_train=False)
    real_eval_dataset = SafeStreetsDataset(real_eval_paths, real_eval_labels, is_train=False)

    batch_size = 32
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, num_workers=0)
    synth_test_loader = DataLoader(synth_test_dataset, batch_size=batch_size, shuffle=False, num_workers=0)
    real_eval_loader = DataLoader(real_eval_dataset, batch_size=batch_size, shuffle=False, num_workers=0)

    # 3. Initialize Model
    model = SafeStreetsVoiceNet(num_classes=4).to(device)
    param_count = count_parameters(model)
    print(f"Model Architecture: SafeStreetsVoiceNet")
    print(f"Total Trainable Parameters: {param_count:,}\n")

    # 4. Loss & Optimizer (Moderate weight penalty on HELP class to maintain sensitivity)
    class_weights = torch.tensor([1.3, 1.0, 1.0, 1.0], dtype=torch.float32).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='min', factor=0.5, patience=3)

    # 5. Model Output Paths
    base_dir = os.path.dirname(os.path.abspath(__file__))
    model_save_path = os.path.join(base_dir, "voice_model.pth")
    metadata_save_path = os.path.join(base_dir, "model_metadata.json")

    parent_dir = r"d:\SafeStreets"
    parent_model_path = os.path.join(parent_dir, "voice_model.pth")
    parent_metadata_path = os.path.join(parent_dir, "model_metadata.json")

    # 6. Training Loop
    epochs = 35
    best_val_loss = float('inf')
    best_val_acc = 0.0

    print("Beginning Training Loop...")
    print("-" * 60)

    training_history = []
    start_time = time.time()

    for epoch in range(1, epochs + 1):
        t0 = time.time()
        train_loss, train_acc = train_one_epoch(model, train_loader, criterion, optimizer, device)
        val_loss, val_acc, _, _ = evaluate_dataset_loader(model, val_loader, criterion, device)

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

        # Save best model checkpoint based on validation loss
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_val_acc = val_acc
            torch.save(model.state_dict(), model_save_path)
            if os.path.exists(parent_dir) and os.path.abspath(parent_dir) != os.path.abspath(base_dir):
                try: torch.save(model.state_dict(), parent_model_path)
                except Exception: pass
            print(f"  --> Best model saved to {model_save_path} (Val Loss: {val_loss:.4f}, Val Acc: {val_acc*100:.2f}%)")

    total_training_time = time.time() - start_time
    print("-" * 60)
    print(f"Training Complete in {total_training_time:.2f} seconds.")

    # Load best model checkpoint for evaluation
    print("\nLoading Best Model Checkpoint for Final Comprehensive Evaluation...")
    model.load_state_dict(torch.load(model_save_path))

    target_names = ["HELP", "UNKNOWN", "NOISE", "SILENCE"]

    # =========================================================================
    # 7A. SYNTHETIC TEST SET EVALUATION
    # =========================================================================
    synth_loss, synth_acc, synth_y_true, synth_y_pred = evaluate_dataset_loader(model, synth_test_loader, criterion, device)
    synth_report_dict = classification_report(synth_y_true, synth_y_pred, target_names=target_names, output_dict=True, zero_division=0)
    synth_report_str = classification_report(synth_y_true, synth_y_pred, target_names=target_names, digits=4, zero_division=0)
    synth_cm = confusion_matrix(synth_y_true, synth_y_pred, labels=[0, 1, 2, 3])

    s_help_total = synth_cm[0].sum()
    s_help_tp = synth_cm[0][0]
    s_help_fn = s_help_total - s_help_tp
    s_fp_unknown = synth_cm[1][0]
    s_fp_noise = synth_cm[2][0]
    s_fp_silence = synth_cm[3][0]
    s_total_fp = s_fp_unknown + s_fp_noise + s_fp_silence

    print("\n" + "=" * 65)
    print("      EVALUATION A: SYNTHETIC TEST SET RESULTS")
    print("=" * 65)
    print(f"Overall Synthetic Test Accuracy : {synth_acc * 100:.2f}%")
    print(f"HELP Precision                  : {synth_report_dict['HELP']['precision'] * 100:.2f}%")
    print(f"HELP Recall                     : {synth_report_dict['HELP']['recall'] * 100:.2f}%")
    print(f"HELP False Negatives (Missed)   : {s_help_fn} / {s_help_total}")
    print(f"HELP False Positives (Alarms)   : {s_total_fp}")
    print(f"  - UNKNOWN -> HELP False Alarms: {s_fp_unknown}")
    print(f"  - NOISE   -> HELP False Alarms: {s_fp_noise}")
    print(f"  - SILENCE -> HELP False Alarms: {s_fp_silence}")
    print("-" * 65)
    print("Classification Report:")
    print(synth_report_str)
    print("\nConfusion Matrix:")
    print("                 Predicted")
    print("                 HELP  UNKNOWN  NOISE  SILENCE")
    for idx, row in enumerate(synth_cm):
        print(f"Actual {target_names[idx]:<8}: {row[0]:<5} {row[1]:<8} {row[2]:<6} {row[3]:<7}")

    # =========================================================================
    # 7B. HELD-OUT REAL-WORLD TEST SET EVALUATION
    # =========================================================================
    real_eval_loss, real_eval_acc, real_y_true, real_y_pred = evaluate_dataset_loader(model, real_eval_loader, criterion, device)
    real_eval_report_dict = classification_report(real_y_true, real_y_pred, target_names=target_names, output_dict=True, zero_division=0)
    real_eval_report_str = classification_report(real_y_true, real_y_pred, target_names=target_names, digits=4, zero_division=0)
    real_eval_cm = confusion_matrix(real_y_true, real_y_pred, labels=[0, 1, 2, 3])

    r_help_total = real_eval_cm[0].sum()
    r_help_tp = real_eval_cm[0][0]
    r_help_fn = r_help_total - r_help_tp
    r_fp_unknown = real_eval_cm[1][0]
    r_fp_noise = real_eval_cm[2][0]
    r_fp_silence = real_eval_cm[3][0]
    r_total_fp = r_fp_unknown + r_fp_noise + r_fp_silence

    print("\n" + "=" * 65)
    print("      EVALUATION B: HELD-OUT REAL-WORLD TEST SET RESULTS (65 Files)")
    print("=" * 65)
    print(f"Overall Real Held-Out Accuracy  : {real_eval_acc * 100:.2f}%")
    print(f"HELP Recall                     : {real_eval_report_dict['HELP']['recall'] * 100:.2f}%")
    print(f"HELP False Negatives (Missed)   : {r_help_fn} / {r_help_total}")
    print(f"Total False Alarms for HELP     : {r_total_fp}")
    print(f"  - UNKNOWN -> HELP False Alarms: {r_fp_unknown}")
    print(f"  - NOISE   -> HELP False Alarms: {r_fp_noise}")
    print(f"  - SILENCE -> HELP False Alarms: {r_fp_silence}")
    print("-" * 65)
    print("Classification Report:")
    print(real_eval_report_str)
    print("\nConfusion Matrix:")
    print("                 Predicted")
    print("                 HELP  UNKNOWN  NOISE  SILENCE")
    for idx, row in enumerate(real_eval_cm):
        print(f"Actual {target_names[idx]:<8}: {row[0]:<5} {row[1]:<8} {row[2]:<6} {row[3]:<7}")

    # =========================================================================
    # 7C. ORIGINAL 6 UNTOUCHED REAL HELP RECORDINGS EVALUATION
    # =========================================================================
    untouched_results = evaluate_untouched_real_help_files(model, device)

    # 8. Save Metadata JSON
    model_file_size_kb = os.path.getsize(model_save_path) / 1024.0

    metadata = {
        "model_name": "SafeStreetsVoiceNet",
        "num_classes": 4,
        "class_map": CLASS_MAP,
        "inv_class_map": {str(k): v for k, v in CLASS_MAP.items()},
        "parameters_count": param_count,
        "model_file_size_kb": round(model_file_size_kb, 2),
        "real_oversample_factor": real_oversample_factor,
        "audio_specs": {
            "sample_rate": 16000,
            "channels": 1,
            "duration_sec": 1.0,
            "n_mels": 64,
            "n_fft": 512,
            "hop_length": 160,
            "feature_shape": [1, 64, 101]
        },
        "dataset_split": counts_info,
        "synthetic_test_results": {
            "test_loss": float(synth_loss),
            "test_accuracy": float(synth_acc),
            "classification_report": synth_report_dict,
            "confusion_matrix": synth_cm.tolist(),
            "help_safety_metrics": {
                "help_precision": float(synth_report_dict["HELP"]["precision"]),
                "help_recall": float(synth_report_dict["HELP"]["recall"]),
                "help_true_positives": int(s_help_tp),
                "help_false_negatives": int(s_help_fn),
                "help_false_positives": int(s_total_fp),
                "fp_unknown_as_help": int(s_fp_unknown),
                "fp_noise_as_help": int(s_fp_noise),
                "fp_silence_as_help": int(s_fp_silence)
            }
        },
        "held_out_real_test_results": {
            "test_loss": float(real_eval_loss),
            "test_accuracy": float(real_eval_acc),
            "classification_report": real_eval_report_dict,
            "confusion_matrix": real_eval_cm.tolist(),
            "help_safety_metrics": {
                "help_precision": float(real_eval_report_dict["HELP"]["precision"]),
                "help_recall": float(real_eval_report_dict["HELP"]["recall"]),
                "help_true_positives": int(r_help_tp),
                "help_false_negatives": int(r_help_fn),
                "help_false_positives": int(r_total_fp),
                "fp_unknown_as_help": int(r_fp_unknown),
                "fp_noise_as_help": int(r_fp_noise),
                "fp_silence_as_help": int(r_fp_silence)
            }
        },
        "untouched_6_real_help_results": untouched_results
    }

    with open(metadata_save_path, "w") as f:
        json.dump(metadata, f, indent=2)

    if os.path.exists(parent_dir) and os.path.abspath(parent_dir) != os.path.abspath(base_dir):
        try:
            with open(parent_metadata_path, "w") as f:
                json.dump(metadata, f, indent=2)
        except Exception:
            pass

    print(f"\nSaved metadata JSON to: {metadata_save_path}")
    print(f"Model file size on disk: {model_file_size_kb:.2f} KB")
    print("=" * 60)


if __name__ == "__main__":
    main()

