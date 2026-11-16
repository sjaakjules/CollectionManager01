import { useCallback, useLayoutEffect, useRef } from 'react';
import type { ZoomImage } from './ReviewCardArtwork';
import { fittedImageRectangle } from './reviewImageGeometry';

interface ReviewImageZoomProps {
  image: ZoomImage;
  onDismiss: () => void;
}

function canAnimate(element: HTMLImageElement): boolean {
  return typeof element.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ReviewImageZoom({ image, onDismiss }: ReviewImageZoomProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const surface = useRef<HTMLButtonElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const animation = useRef<Animation | null>(null);
  const closeTimer = useRef<number | undefined>();
  const closing = useRef(false);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    window.clearTimeout(closeTimer.current);
    animation.current?.cancel();
    if (dialog.current?.open) dialog.current.close();
    onDismiss();
    image.opener.focus({ preventScroll: true });
  }, [image.opener, onDismiss]);

  const thumbnailTransform = useCallback((enlarged: HTMLImageElement) => {
    const thumb = fittedImageRectangle(image.origin.getBoundingClientRect(), image.width, image.height);
    const large = fittedImageRectangle(enlarged.getBoundingClientRect(), image.width, image.height);
    const x = thumb.left + thumb.width / 2 - large.left - large.width / 2;
    const y = thumb.top + thumb.height / 2 - large.top - large.height / 2;
    return `translate(${x}px, ${y}px) scale(${thumb.width / large.width})`;
  }, [image.height, image.origin, image.width]);

  const dismiss = () => {
    if (closing.current || finished.current) return;
    const enlarged = picture.current;
    if (!enlarged || !canAnimate(enlarged)) {
      finish();
      return;
    }
    closing.current = true;
    dialog.current?.classList.add('review-zoom-closing');
    const from = window.getComputedStyle(enlarged).transform;
    animation.current?.cancel();
    animation.current = enlarged.animate(
      [{ transform: from }, { transform: thumbnailTransform(enlarged) }],
      { duration: 170, easing: 'ease-in', fill: 'forwards' },
    );
    animation.current.onfinish = finish;
    closeTimer.current = window.setTimeout(finish, 200);
  };

  useLayoutEffect(() => {
    const modal = dialog.current;
    const enlarged = picture.current;
    if (!modal || !enlarged) return;
    finished.current = false;
    closing.current = false;
    modal.classList.remove('review-zoom-entering', 'review-zoom-closing');
    // Keep the document scrollable so the gesture that dismisses the image can
    // also continue through the gallery.
    modal.open = true;
    surface.current?.focus({ preventScroll: true });
    if (canAnimate(enlarged)) {
      animation.current = enlarged.animate(
        [{ transform: thumbnailTransform(enlarged) }, { transform: 'none' }],
        { duration: 190, easing: 'ease-out' },
      );
      modal.classList.add('review-zoom-entering');
    }
    window.addEventListener('wheel', finish, { capture: true, passive: true });
    window.addEventListener('scroll', finish, { passive: true });
    document.addEventListener('scroll', finish, { capture: true, passive: true });
    window.visualViewport?.addEventListener('scroll', finish, { passive: true });
    window.addEventListener('touchmove', finish, { capture: true, passive: true });
    return () => {
      window.clearTimeout(closeTimer.current);
      animation.current?.cancel();
      window.removeEventListener('wheel', finish, true);
      window.removeEventListener('scroll', finish);
      document.removeEventListener('scroll', finish, true);
      window.visualViewport?.removeEventListener('scroll', finish);
      window.removeEventListener('touchmove', finish, true);
      if (modal.open) modal.close();
    };
  }, [image, finish, thumbnailTransform]);

  return (
    <dialog
      ref={dialog}
      className="review-zoom"
      aria-label={`${image.alt} enlarged`}
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
        } else if (event.key === 'Tab') {
          // The entire surface is the single dismissal control.
          event.preventDefault();
        }
      }}
    >
      <button ref={surface} type="button" className="review-zoom-surface" onClick={dismiss} aria-label="Close enlarged image">
        <img ref={picture} src={image.url} alt={image.alt} width={image.width} height={image.height} />
        <span className="review-zoom-close" aria-hidden="true">×</span>
        {image.frameLabel && <span className="review-zoom-label">{image.frameLabel}</span>}
      </button>
    </dialog>
  );
}
