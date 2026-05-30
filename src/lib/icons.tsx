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
