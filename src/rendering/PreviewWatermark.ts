import { Container, Graphics, Text } from 'pixi.js';

/** A small ribbon over the artwork, inside the card bounds and clear of rules. */
export function createPreviewWatermark(width: number, height: number): Container {
  const ribbon = new Container();
  ribbon.label = 'preview-watermark';
  ribbon.eventMode = 'none';
  ribbon.interactiveChildren = false;
  const shortSide = Math.min(width, height);
  const fontSize = shortSide * .13;
  const ribbonWidth = shortSide * .72;
  const ribbonHeight = shortSide * .19;
  ribbon.position.set((width - ribbonWidth) / 2, height * .38 - ribbonHeight / 2);
  ribbon.addChild(new Graphics().roundRect(0, 0, ribbonWidth, ribbonHeight, shortSide * .025)
    .fill({ color: 0x141a22, alpha: .64 }));
  const text = new Text({ text: 'Preview', resolution: 2, style: {
    fontFamily: 'Arial', fontWeight: 'bold', fontSize, fill: 0xfff5dc,
  } });
  text.anchor.set(.5);
  text.position.set(ribbonWidth / 2, ribbonHeight / 2);
  ribbon.addChild(text);
  return ribbon;
}
