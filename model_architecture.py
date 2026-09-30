"""
model_architecture.py - SafeStreets Voice Classification Model Architecture

Defines SafeStreetsVoiceNet: A lightweight 2D CNN model for keyword spotting
and audio classification into 4 classes: HELP, UNKNOWN, NOISE, SILENCE.
Input shape: (batch_size, 1, 64, 101) representing Log-Mel Spectrograms.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


# Class index mapping
CLASS_MAP = {
    0: "HELP",
    1: "UNKNOWN",
    2: "NOISE",
    3: "SILENCE"
}

INV_CLASS_MAP = {v: k for k, v in CLASS_MAP.items()}


class SafeStreetsVoiceNet(nn.Module):
    def __init__(self, num_classes: int = 4):
        super(SafeStreetsVoiceNet, self).__init__()
        
        # Block 1: Input (1, 64, 101) -> (16, 32, 50)
        self.conv1 = nn.Conv2d(1, 16, kernel_size=3, stride=1, padding=1)
        self.bn1 = nn.BatchNorm2d(16)
        self.pool1 = nn.MaxPool2d(kernel_size=2, stride=2)
        self.drop1 = nn.Dropout(0.15)
        
        # Block 2: (16, 32, 50) -> (32, 16, 25)
        self.conv2 = nn.Conv2d(16, 32, kernel_size=3, stride=1, padding=1)
        self.bn2 = nn.BatchNorm2d(32)
        self.pool2 = nn.MaxPool2d(kernel_size=2, stride=2)
        self.drop2 = nn.Dropout(0.15)
        
        # Block 3: (32, 16, 25) -> (64, 8, 12)
        self.conv3 = nn.Conv2d(32, 64, kernel_size=3, stride=1, padding=1)
        self.bn3 = nn.BatchNorm2d(64)
        self.pool3 = nn.MaxPool2d(kernel_size=2, stride=2)
        self.drop3 = nn.Dropout(0.20)
        
        # Global Average Pooling & Dense Classifier
        self.global_pool = nn.AdaptiveAvgPool2d((1, 1))
        self.fc1 = nn.Linear(64, 32)
        self.drop_fc = nn.Dropout(0.30)
        self.fc2 = nn.Linear(32, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Conv Block 1
        x = self.conv1(x)
        x = self.bn1(x)
        x = F.relu(x)
        x = self.pool1(x)
        x = self.drop1(x)
        
        # Conv Block 2
        x = self.conv2(x)
        x = self.bn2(x)
        x = F.relu(x)
        x = self.pool2(x)
        x = self.drop2(x)
        
        # Conv Block 3
        x = self.conv3(x)
        x = self.bn3(x)
        x = F.relu(x)
        x = self.pool3(x)
        x = self.drop3(x)
        
        # Pooling & Classification
        x = self.global_pool(x)
        x = x.view(x.size(0), -1)
        x = self.fc1(x)
        x = F.relu(x)
        x = self.drop_fc(x)
        logits = self.fc2(x)
        
        return logits


def count_parameters(model: nn.Module) -> int:
    """Returns the total number of trainable parameters."""
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == "__main__":
    model = SafeStreetsVoiceNet(num_classes=4)
    dummy_input = torch.randn(1, 1, 64, 101)
    output = model(dummy_input)
    print("Model initialized successfully.")
    print("Input shape:", dummy_input.shape)
    print("Output logits shape:", output.shape)
    print("Total trainable parameters:", count_parameters(model))
