#!/usr/bin/env python3
"""Rectify reviewed card quadrilaterals without generating artwork or text.

Requires numpy and opencv-python. All work is offline. Coordinates and the
original photo remain in the manifest directory for repeatable corrections.
Usage: python3 scripts/extract-card-photos.py MANIFEST OUTPUT_DIRECTORY
"""

import argparse
import json
from pathlib import Path
import re
import unicodedata

import cv2
import numpy as np


def slug(name):
    ascii_name = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode()
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9_]+", "", re.sub(r"[-\s]+", "_", ascii_name.lower().replace("'", "")))).strip("_")


def extract(manifest_path, output):
    manifest = json.loads(manifest_path.read_text())
    source = cv2.imread(str(manifest_path.parent / manifest["source"]))
    if source is None or list(source.shape[1::-1]) != manifest["sourceSize"]:
        raise ValueError("Source photo is missing or its dimensions have changed")
    if manifest.get("rotate") == -90:
        source = cv2.rotate(source, cv2.ROTATE_90_COUNTERCLOCKWISE)
    elif manifest.get("rotate", 0) != 0:
        raise ValueError("Only 0 and -90 degree source rotations are supported")
    output.mkdir(parents=True, exist_ok=True)
    report = []
    for card in manifest["cards"]:
        corners = np.asarray(card["corners"], dtype=np.float32)
        if corners.shape != (4, 2) or not cv2.isContourConvex(corners):
            raise ValueError(f"Invalid card quadrilateral: {card['name']}")
        if np.any(corners < 0) or np.any(corners[:, 0] >= source.shape[1]) or np.any(corners[:, 1] >= source.shape[0]):
            raise ValueError(f"Corners outside source photo: {card['name']}")
        portrait_width, portrait_height = manifest.get("portraitSize", [380, 531])
        width, height = (portrait_height, portrait_width) if card.get("landscape") else (portrait_width, portrait_height)
        target = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
        transform = cv2.getPerspectiveTransform(corners, target)
        rectified = cv2.warpPerspective(source, transform, (width, height), flags=cv2.INTER_CUBIC)
        # A mild unsharp mask improves local contrast; no synthesis or inpainting.
        blurred = cv2.GaussianBlur(rectified, (0, 0), 0.7)
        rectified = cv2.addWeighted(rectified, 1.18, blurred, -0.18, 0)
        # Physical cards have rounded corners. Remove the small playmat wedges
        # outside those corners, using an antialiased geometric alpha mask.
        scale, radius = 4, round(portrait_width * 14 / 380)
        mask = np.zeros((height * scale, width * scale), dtype=np.uint8)
        r, right, bottom = radius * scale, width * scale - 1, height * scale - 1
        cv2.rectangle(mask, (r, 0), (right - r, bottom), 255, -1)
        cv2.rectangle(mask, (0, r), (right, bottom - r), 255, -1)
        for center in [(r, r), (right - r, r), (r, bottom - r), (right - r, bottom - r)]:
            cv2.circle(mask, center, r, 255, -1)
        rectified = cv2.cvtColor(rectified, cv2.COLOR_BGR2BGRA)
        rectified[:, :, 3] = cv2.resize(mask, (width, height), interpolation=cv2.INTER_AREA)
        destination = output / f"{slug(card['name'])}.webp"
        if not cv2.imwrite(str(destination), rectified, [cv2.IMWRITE_WEBP_QUALITY, 96]):
            raise OSError(f"Unable to encode {destination}")
        report.append({"name": card["name"], "file": destination.name, "width": width, "height": height})
    (output / "extraction.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Rectified {len(report)} cards into {output}; source detail is unchanged by enlargement.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    extract(args.manifest, args.output)
