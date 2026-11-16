#!/usr/bin/env python3
"""Reproduce reviewed trailer card images from archived frame patches, offline.

Requires numpy and opencv-python. Corner order is TL, TR, BR, BL in each patch.
Partial cards must be explicitly marked: missing pixels stay neutral grey.
Usage: python3 scripts/extract-card-previews.py MANIFEST OUTPUT_ROOT
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


def extract(manifest_path, output_root):
    manifest = json.loads(manifest_path.read_text())
    output_root = output_root.resolve()
    for card in manifest['images']:
        source_path = manifest_path.parent / card['source']
        if hashlib.sha256(source_path.read_bytes()).hexdigest() != card['sourceSha256']:
            raise ValueError(f"Source checksum changed: {card['name']}")
        source = cv2.imread(str(source_path))
        if source is None or list(source.shape[1::-1]) != card['sourceSize']:
            raise ValueError(f"Missing or changed frame patch: {card['name']}")
        corners = np.asarray(card['corners'], dtype=np.float32)
        if corners.shape != (4, 2) or not cv2.isContourConvex(corners):
            raise ValueError(f"Invalid quadrilateral: {card['name']}")
        outside = (np.any(corners < 0) or np.any(corners[:, 0] >= source.shape[1])
                   or np.any(corners[:, 1] >= source.shape[0]))
        if outside and not card['partial']:
            raise ValueError(f"Unacknowledged missing pixels: {card['name']}")
        width, height = (1039, 744) if card['landscape'] else (744, 1039)
        target = np.float32([[0, 0], [width-1, 0], [width-1, height-1], [0, height-1]])
        transform = cv2.getPerspectiveTransform(corners, target)
        rectified = cv2.warpPerspective(source, transform, (width, height),
                                       flags=cv2.INTER_CUBIC, borderValue=(30, 30, 30))
        # Conventional local contrast only. No synthesis, inpainting or OCR redraw.
        blurred = cv2.GaussianBlur(rectified, (0, 0), 0.7)
        rectified = cv2.addWeighted(rectified, 1.18, blurred, -0.18, 0)
        scale, radius = 4, 27
        mask = np.zeros((height*scale, width*scale), dtype=np.uint8)
        r, right, bottom = radius*scale, width*scale-1, height*scale-1
        cv2.rectangle(mask, (r, 0), (right-r, bottom), 255, -1)
        cv2.rectangle(mask, (0, r), (right, bottom-r), 255, -1)
        for center in [(r, r), (right-r, r), (r, bottom-r), (right-r, bottom-r)]:
            cv2.circle(mask, center, r, 255, -1)
        rectified = cv2.cvtColor(rectified, cv2.COLOR_BGR2BGRA)
        rectified[:, :, 3] = cv2.resize(mask, (width, height), interpolation=cv2.INTER_AREA)
        destination = (output_root / card['output']).resolve()
        if not destination.is_relative_to(output_root):
            raise ValueError('Output must remain inside the supplied root')
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(destination), rectified, [cv2.IMWRITE_WEBP_QUALITY, 96]):
            raise OSError(f'Could not write {destination}')
    print(f"Rectified {len(manifest['images'])} trailer images; missing detail was not invented.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output_root', type=Path)
    args = parser.parse_args()
    extract(args.manifest, args.output_root)
