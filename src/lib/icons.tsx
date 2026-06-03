// Inline SVG icons, ported from design-reference/shell.jsx so we don't
// have to pull in a whole icon library. Each accepts standard svg props.

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base: P = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const Icon = {
  download: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M8 2v8m0 0l3-3m-3 3L5 7" />
      <path d="M3 13h10" />
    </svg>
  ),
  library: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M2 7h12" />
      <path d="M6 3v4" />
    </svg>
  ),
  projects: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z" />
    </svg>
  ),
  settings: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M1.5 8h2M12.5 8h2M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  ),
  search: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M13.5 13.5L10.5 10.5" />
    </svg>
  ),
  filter: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M2 4h12M4 8h8M6 12h4" />
    </svg>
  ),
  grid: (p: P = {}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} {...p}>
      <rect x="2.5" y="2.5" width="4" height="4" rx="0.5" />
      <rect x="9.5" y="2.5" width="4" height="4" rx="0.5" />
      <rect x="2.5" y="9.5" width="4" height="4" rx="0.5" />
      <rect x="9.5" y="9.5" width="4" height="4" rx="0.5" />
    </svg>
  ),
  list: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  ),
  plus: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  chev: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  ),
  x: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
  retry: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M2.5 3v3h3" />
    </svg>
  ),
  trash: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M3 4h10M6 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4" />
      <path d="M4 4l.7 9a1 1 0 0 0 1 1h4.6a1 1 0 0 0 1-1L12 4" />
      <path d="M7 7v4M9 7v4" />
    </svg>
  ),
  folder: (p: P = {}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" {...p}>
      <path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z" />
    </svg>
  ),
  tag: (p: P = {}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" {...p}>
      <path d="M2 2v6l6 6 6-6-6-6H2z" />
      <circle cx="5" cy="5" r="0.8" fill="currentColor" />
    </svg>
  ),
  check: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} strokeWidth={1.6} {...p}>
      <path d="M3 8.5L6.5 12 13 5" />
    </svg>
  ),
  yt: (p: P = {}) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} {...p}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="2" />
      <path d="M7 6.5v3l3-1.5z" fill="currentColor" />
    </svg>
  ),
  twitter: (p: P = {}) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M11.7 2H14l-4.8 5.5L14.5 14H10l-3.5-4.4L2.5 14H.2l5.2-6L.5 2h4.6l3.1 4zM11 12.7h1.3L4.5 3.2H3.1z" />
    </svg>
  ),
  // 1.3.x — Pinterest. Stylized "P" mark inside a circle; matches the
  // brand silhouette enough to read at chip size while staying mono-
  // chromatic with the rest of the icon set.
  pinterest: (p: P = {}) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M8 1.4a6.6 6.6 0 0 0-2.4 12.74c-.06-.54-.12-1.37.02-1.96.14-.53.9-3.37.9-3.37s-.23-.46-.23-1.14c0-1.07.62-1.87 1.39-1.87.66 0 .97.49.97 1.08 0 .66-.42 1.65-.64 2.57-.18.76.39 1.39 1.14 1.39 1.37 0 2.42-1.44 2.42-3.52 0-1.84-1.32-3.13-3.21-3.13-2.19 0-3.47 1.64-3.47 3.33 0 .66.25 1.36.57 1.75.06.07.07.13.05.21l-.21.85c-.03.14-.11.17-.25.1-.94-.44-1.53-1.81-1.53-2.91 0-2.37 1.72-4.55 4.96-4.55 2.6 0 4.62 1.85 4.62 4.33 0 2.58-1.63 4.66-3.89 4.66-.76 0-1.48-.4-1.72-.86l-.47 1.78c-.17.65-.62 1.47-.93 1.97A6.6 6.6 0 1 0 8 1.4Z" />
    </svg>
  ),
  // 1.3.x — TikTok. Stylized music-note silhouette matching the
  // brand's "d/J" hybrid mark, monochromatic to fit the badge row.
  tiktok: (p: P = {}) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M10.2 2.1c.15.93.62 1.72 1.37 2.27.55.4 1.2.63 1.93.66v2.18c-1.18-.03-2.28-.35-3.3-.96v4.18c0 1.05-.32 2.02-.96 2.81a4.07 4.07 0 0 1-2.62 1.5 4.06 4.06 0 0 1-2.93-.67 4.05 4.05 0 0 1-1.65-2.51c-.13-.55-.13-1.1-.05-1.65a4.08 4.08 0 0 1 4.09-3.41c.18 0 .35.02.52.04v2.21c-.17-.04-.33-.06-.52-.06a1.86 1.86 0 0 0-1.36 3.16c.36.36.84.54 1.36.54a1.87 1.87 0 0 0 1.86-1.86V2.1h2.26Z" />
    </svg>
  ),
  // 1.2.0 — video + audio tab icons. Minimal "film strip" and
  // "music note" so the Video|Audio mode tabs are scannable at a glance.
  video: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1" />
      <path d="M1.5 6h13M1.5 10h13M5 3.5v9M11 3.5v9" />
    </svg>
  ),
  music: (p: P = {}) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M6 12V3l7-1v8" />
      <circle cx="4.5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="10" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  ),
};
