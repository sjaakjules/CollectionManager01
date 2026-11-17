#!/usr/bin/env python3
"""Reproduce reviewed trailer card images from archived frame patches, offline.

Requires numpy and opencv-python. Corner order is TL, TR, BR, BL in each patch.
Partial cards must be explicitly marked: missing pixels stay neutral grey.
Optional layers use other frames of the same card, registered to the base crop.
Usage: python3 scripts/extract-card-previews.py MANIFEST OUTPUT_ROOT
Use --source-frames-only to export the unsharpened gallery frames instead.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


def card_rectangle(width, height):
    return np.float32([[0, 0], [width-1, 0], [width-1, height-1], [0, height-1]])


def perspective_transform(corners, width, height, name):
    corners = np.asarray(corners, dtype=np.float32)
    if corners.shape != (4, 2) or not np.isfinite(corners).all() or not cv2.isContourConvex(corners):
        raise ValueError(f"Invalid quadrilateral: {name}")
    return cv2.getPerspectiveTransform(corners, card_rectangle(width, height))


def warp_card(image, transform, width, height):
    return cv2.warpPerspective(image, transform, (width, height),
                               flags=cv2.INTER_CUBIC, borderValue=(30, 30, 30))


def rectify(source_root, capture, name, width, height, alignment=None):
    source_path = source_root / capture['source']
    if hashlib.sha256(source_path.read_bytes()).hexdigest() != capture['sourceSha256']:
        raise ValueError(f"Source checksum changed: {source_path}")
    source = cv2.imread(str(source_path))
    if source is None or list(source.shape[1::-1]) != capture['sourceSize']:
        raise ValueError(f"Missing or changed frame patch: {source_path}")
    corners = np.asarray(capture['corners'], dtype=np.float32)
    transform = perspective_transform(corners, width, height, name)
    outside = (np.any(corners < 0) or np.any(corners[:, 0] >= source.shape[1])
               or np.any(corners[:, 1] >= source.shape[0]))
    if outside and not capture['partial']:
        raise ValueError(f"Unacknowledged missing pixels: {name}")
    if alignment is not None:
        transform = alignment @ transform
    pixels = warp_card(source, transform, width, height)
    # Leave a two-pixel source margin for the cubic interpolation footprint.
    available = np.zeros(source.shape[:2], dtype=np.uint8)
    available[2:-2, 2:-2] = 255
    available = cv2.warpPerspective(available, transform, (width, height), flags=cv2.INTER_NEAREST)
    return pixels, available


def align_composite(source_root, card, image, alignment, width, height):
    """Use the archived video patch for pixels beyond the restored crop."""
    result = warp_card(image, alignment, width, height)
    source_mask = np.zeros((height, width), dtype=np.float32)
    source_mask[9:-9, 9:-9] = 1
    soft_edge = cv2.GaussianBlur(source_mask, (0, 0), 3)
    alpha = cv2.warpPerspective(soft_edge, alignment, (width, height))[:, :, None]
    edge, _ = rectify(source_root, card, card['name'], width, height, alignment)
    return (result * alpha + edge * (1-alpha)).round().astype(np.uint8)


def blend_layer(base, detail, available, layer):
    region = np.asarray(layer['region'], dtype=np.int32)
    mask = np.zeros(base.shape[:2], dtype=np.uint8)
    cv2.fillPoly(mask, [region], 255)
    mask = cv2.bitwise_and(mask, available)
    alpha = np.clip(cv2.distanceTransform(mask, cv2.DIST_L2, 5) / layer['featherPx'], 0, 1)[:, :, None]
    detail = np.clip(detail.astype(np.float32) + np.float32(layer['colorOffsetBgr']), 0, 255)
    return (base * (1-alpha) + detail * alpha).round().astype(np.uint8)


def sharpen_luminance(image, strength):
    ycc = cv2.cvtColor(image, cv2.COLOR_BGR2YCrCb)
    luma = ycc[:, :, 0].astype(np.float32)
    detail = luma - cv2.GaussianBlur(luma, (0, 0), 1.65)
    ycc[:, :, 0] = np.clip(luma + np.clip(detail, -16, 16) * strength, 0, 255).round().astype(np.uint8)
    return cv2.cvtColor(ycc, cv2.COLOR_YCrCb2BGR)


def adjust_luminance(image, gamma):
    ycc = cv2.cvtColor(image, cv2.COLOR_BGR2YCrCb)
    luma = ycc[:, :, 0].astype(np.float32) / 255
    ycc[:, :, 0] = (255 * luma ** gamma).round().astype(np.uint8)
    return cv2.cvtColor(ycc, cv2.COLOR_YCrCb2BGR)


def rounded_card(image):
    height, width = image.shape[:2]
    scale, radius = 4, 27
    mask = np.zeros((height*scale, width*scale), dtype=np.uint8)
    r, right, bottom = radius*scale, width*scale-1, height*scale-1
    cv2.rectangle(mask, (r, 0), (right-r, bottom), 255, -1)
    cv2.rectangle(mask, (0, r), (right, bottom-r), 255, -1)
    for center in [(r, r), (right-r, r), (r, bottom-r), (right-r, bottom-r)]:
        cv2.circle(mask, center, r, 255, -1)
    result = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    result[:, :, 3] = cv2.resize(mask, (width, height), interpolation=cv2.INTER_AREA)
    return result


def write_webp(root, relative_path, image, quality):
    destination = (root / relative_path).resolve()
    if not destination.is_relative_to(root):
        raise ValueError('Output must remain inside the supplied root')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(destination), rounded_card(image), [cv2.IMWRITE_WEBP_QUALITY, quality]):
        raise OSError(f'Could not write {destination}')
    return destination


def export_source_frames(manifest_path, output_root, cards):
    set_directory = manifest_path.parent.name
    asset_directory = Path('assets/CardPreviewFrames') / set_directory
    urls = {}
    for card in cards:
        width, height = (1039, 744) if card['landscape'] else (744, 1039)
        for frame in [card, *card.get('layers', [])]:
            source = frame['source']
            relative = asset_directory / (Path(source).stem + '.webp')
            pixels, _ = rectify(manifest_path.parent, frame, card['name'], width, height)
            file = write_webp(output_root, Path('public') / relative, pixels, 94)
            version = hashlib.sha256(file.read_bytes()).hexdigest()[:16]
            urls[source] = f'/{relative.as_posix()}?v={version}'
    index = output_root / 'offlineData/card-previews' / set_directory / 'comparison-frames.json'
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(json.dumps(urls, indent=2, sort_keys=True) + '\n')
    print(f'Exported {len(urls)} unsharpened source frames for the gallery.')


def render_final(source_root, card):
    width, height = (1039, 744) if card['landscape'] else (744, 1039)
    name = card['name']
    corners = card.get('alignmentCorners')
    alignment = perspective_transform(corners, width, height, name) if corners is not None else None
    if 'restoredSource' in card:
        restored = card['restoredSource']
        path = source_root / restored['path']
        if hashlib.sha256(path.read_bytes()).hexdigest() != restored['sha256']:
            raise ValueError(f'Restored image checksum changed: {path}')
        pixels = cv2.imread(str(path))
        if pixels is None or pixels.shape[:2] != (height, width):
            raise ValueError(f'Invalid restored image: {path}')
        if alignment is not None:
            pixels = align_composite(source_root, card, pixels, alignment, width, height)
        return pixels

    layers = card.get('layers', [])
    pixels, _ = rectify(source_root, card, name, width, height, alignment if not layers else None)
    for layer in layers:
        detail, available = rectify(source_root, layer, name, width, height)
        pixels = blend_layer(pixels, detail, available, layer)
    if layers and alignment is not None:
        pixels = align_composite(source_root, card, pixels, alignment, width, height)
    if 'luminanceGamma' in card:
        pixels = adjust_luminance(pixels, card['luminanceGamma'])
    if 'luminanceSharpen' in card:
        return sharpen_luminance(pixels, card['luminanceSharpen'])
    blurred = cv2.GaussianBlur(pixels, (0, 0), 0.7)
    return cv2.addWeighted(pixels, 1.18, blurred, -0.18, 0)


def extract(manifest_path, output_root, source_frames_only=False):
    manifest = json.loads(manifest_path.read_text())
    output_root = output_root.resolve()
    if source_frames_only:
        export_source_frames(manifest_path, output_root, manifest['images'])
        return
    versions = {}
    for card in manifest['images']:
        pixels = render_final(manifest_path.parent, card)
        path = write_webp(output_root, card['output'], pixels, 96)
        if card['output'].startswith('public/assets/CardPreviews/'):
            url = '/' + card['output'].removeprefix('public/')
            versions[url] = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    index = output_root / 'offlineData/card-previews' / manifest_path.parent.name / 'gallery-image-versions.json'
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(json.dumps(versions, indent=2, sort_keys=True) + '\n')
    print(f"Rectified {len(manifest['images'])} trailer images; missing detail was not invented.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output_root', type=Path)
    parser.add_argument('--source-frames-only', action='store_true')
    args = parser.parse_args()
    extract(args.manifest, args.output_root, args.source_frames_only)
