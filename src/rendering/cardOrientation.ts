export function shouldRotateCardImage(
  isLandscapeCard: boolean,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  return isLandscapeCard && sourceWidth <= sourceHeight;
}
