#!/usr/bin/env python3
"""Export consecutive card crops from the archived local 4K video.

The reviewed sequence manifest records frame numbers and full-frame corners.
Requires numpy and opencv-python. This command makes no network requests.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np


def extract(manifest_path, output_root, video_override=None):
    manifest = json.loads(manifest_path.read_text())
    video_path = video_override or manifest_path.parent / manifest['video']['path']
    if hashlib.sha256(video_path.read_bytes()).hexdigest() != manifest['video']['sha256']:
        raise ValueError(f'Video checksum changed: {video_path}')
    helpers_path = Path(__file__).with_name('extract-card-previews.py')
    spec = importlib.util.spec_from_file_location('card_crops', helpers_path)
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    root = output_root.resolve()
    requests = {}
    gallery = {}
    for card in manifest['cards']:
        gallery[card['name']] = []
        for frame in card['frames']:
            requests.setdefault(frame['frameIndex'], []).append((card, frame))

    video = cv2.VideoCapture(str(video_path))
    if not video.isOpened():
        raise OSError(f'Could not open {video_path}')
    cursor = -100
    count = 0
    try:
        for index, crops in sorted(requests.items()):
            if not 0 <= index - cursor < 18:
                video.set(cv2.CAP_PROP_POS_FRAMES, index)
                cursor = index
            while cursor <= index:
                ok, pixels = video.read()
                if not ok:
                    raise OSError(f'Could not decode frame {index}')
                cursor += 1
            for card, frame in crops:
                width, height = (1039, 744) if card['landscape'] else (744, 1039)
                corners = np.float32(frame['corners'])
                if corners.shape != (4, 2) or not cv2.isContourConvex(corners):
                    raise ValueError(f'Invalid card corners at frame {index}')
                destination = np.float32([[0, 0], [width-1, 0], [width-1, height-1], [0, height-1]])
                transform = cv2.getPerspectiveTransform(corners, destination)
                image = cv2.warpPerspective(pixels, transform, (width, height),
                                           flags=cv2.INTER_CUBIC, borderValue=(30, 30, 30))
                # The box panel is in shadow throughout its shot.
                if 'luminanceGamma' in card:
                    image = helpers.adjust_luminance(image, card['luminanceGamma'])
                path = Path('assets/CardPreviewFrames') / manifest_path.parent.name / card['slug'] / f'{index}.webp'
                file = helpers.write_webp(root, Path('public') / path, image, 94)
                version = hashlib.sha256(file.read_bytes()).hexdigest()[:16]
                gallery[card['name']].append({
                    'url': f'/{path.as_posix()}?v={version}',
                    'timestampSeconds': frame['timestampSeconds'],
                })
                count += 1
            if count % 100 < len(crops):
                print(f'Exported {count} consecutive card frames', flush=True)
    finally:
        video.release()
    output = root / 'offlineData/card-previews' / manifest_path.parent.name / 'comparison-sequences.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(gallery, indent=2, ensure_ascii=False) + '\n')
    print(f'Exported {count} frames for {len(gallery)} cards.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output_root', type=Path)
    parser.add_argument('--video', type=Path)
    args = parser.parse_args()
    cv2.setNumThreads(3)
    extract(args.manifest, args.output_root, args.video)
