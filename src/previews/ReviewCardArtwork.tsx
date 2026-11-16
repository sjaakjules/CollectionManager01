import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { reviewImageUrl, reviewSourceFrames, type GalleryFrame, type PreviewCapture } from './previewReviewData';
import { fittedImageRectangle, hoveredFrameIndex } from './reviewImageGeometry';

export interface ZoomImage {
  capture: PreviewCapture;
  opener: HTMLButtonElement;
  initialFrameUrl?: string;
}

interface ReviewCardArtworkProps {
  capture: PreviewCapture;
  title: string;
  illustration: string;
  onZoom: (image: ZoomImage) => void;
}

export function ReviewCardArtwork({ capture, title, illustration, onZoom }: ReviewCardArtworkProps) {
  const [index, setIndex] = useState<number | null>(null);
  const [ready, setReady] = useState<ReadonlySet<string>>(() => new Set());
  const [keyboardFrame, setKeyboardFrame] = useState('');
  const frames = useMemo(() => reviewSourceFrames(capture), [capture]);
  const quality = reviewImageUrl(capture);
  const width = capture.landscape ? 1039 : 744;
  const height = capture.landscape ? 744 : 1039;
  const alt = illustration ? `${title} · ${illustration}` : title;
  const selected = index === null ? undefined : frames[index];
  const shown = selected && ready.has(selected.url) ? selected : undefined;
  const labelFor = (frame: number) => `Frame ${frame + 1} of ${frames.length} · ${frames[frame]?.timestampSeconds}s`;
  const frameLabel = selected && index !== null ? labelFor(index) : undefined;

  const reset = () => {
    setIndex(null);
    setKeyboardFrame('');
  };
  const scrub = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'touch' || frames.length === 0) return;
    const box = fittedImageRectangle(event.currentTarget.getBoundingClientRect(), width, height);
    setIndex(hoveredFrameIndex(event.clientX, box, frames.length));
  };
  const scrubKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!frames.length) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = index === null ? 0 : Math.min(frames.length - 1, index + 1); break;
      case 'ArrowLeft': next = index === null ? frames.length - 1 : Math.max(0, index - 1); break;
      case 'Home': next = 0; break;
      case 'End': next = frames.length - 1; break;
      case 'Escape':
        reset();
        return;
      default: return;
    }
    event.preventDefault();
    setIndex(next);
    setKeyboardFrame(labelFor(next));
  };
  const enlarge = (opener: HTMLButtonElement, frame?: GalleryFrame) =>
    onZoom({ capture, opener, initialFrameUrl: frame?.url });

  return (
    <div className="review-art-wrap">
      <button
        type="button"
        className="review-art"
        aria-label={`Enlarge ${alt}`}
        aria-haspopup="dialog"
        aria-describedby="review-image-help"
        onPointerEnter={scrub}
        onPointerMove={scrub}
        onPointerLeave={reset}
        onPointerCancel={reset}
        onBlur={reset}
        onKeyDown={scrubKeys}
        onClick={(event) => enlarge(event.currentTarget, shown)}
      >
        <img
          className="review-art-result"
          src={quality}
          alt=""
          loading="lazy"
          decoding="async"
          width={width}
          height={height}
        />
        {index !== null && frames.map(({ url }, frameIndex) => Math.abs(frameIndex - index) <= 1 && (
          <img
            key={url}
            className={shown?.url === url ? 'review-art-source is-shown' : 'review-art-source'}
            aria-hidden="true"
            src={url}
            alt=""
            decoding="async"
            width={width}
            height={height}
            onLoad={() => setReady((previous) => previous.has(url) ? previous : new Set(previous).add(url))}
          />
        ))}
        {frameLabel && <span className="review-frame-badge" aria-hidden="true">{frameLabel}</span>}
        <span className="review-visually-hidden" aria-live="polite">{keyboardFrame}</span>
      </button>
      <button
        type="button"
        className="review-view-final"
        aria-label={`Enlarge finished ${alt}`}
        aria-haspopup="dialog"
        onClick={(event) => enlarge(event.currentTarget)}
      >
        View final
      </button>
    </div>
  );
}
