import type { IconName } from "./registry.js";
import { svgMap } from "./svg-map.js";

export interface AIconProps {
  name: IconName | string;
  size?: number;
  className?: string;
}

export function AIcon({ name, size = 16, className }: AIconProps) {
  const svg = svgMap[name as IconName];
  if (!svg) return null;

  // Parse the SVG string and inject size/className/aria-hidden
  // The SVGs already have consistent attributes from the source files
  let sizedSvg = svg;
  
  // Add size attributes
  sizedSvg = sizedSvg.replace(
    /<svg/,
    `<svg width="${size}" height="${size}"`
  );
  
  // Add className if provided
  if (className) {
    sizedSvg = sizedSvg.replace(
      /<svg/,
      `<svg class="${className}"`
    );
  }
  
  // Add aria-hidden
  sizedSvg = sizedSvg.replace(
    /<svg/,
    `<svg aria-hidden="true"`
  );

  return <span dangerouslySetInnerHTML={{ __html: sizedSvg }} />;
}
