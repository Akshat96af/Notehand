/** URL of a file in public/, correct whether the app is served from `/` or a subpath (GitHub Pages). */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

// Every product string lives here (claude/brand/BRAND.md): renaming the app is a one-file change.
export const APP = {
  name: 'Notehand',
  subtitle: 'Text to handwriting',
  tagline: 'Type it. Get it in handwriting.',
  logo: asset('brand/logo.svg'),
  stickers: { free: 'Free, no sign-up', hand: 'Looks hand-written' },
  footer: { copyright: `© ${new Date().getFullYear()} Notehand`, note: 'Runs entirely in your browser' },
  defaultFileName: 'handwritten-assignment',
} as const;
