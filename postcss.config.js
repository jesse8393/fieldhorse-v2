export default {
  plugins: {
    '@tailwindcss/postcss': {},
    // Wraps every bare `:hover` rule in `@media (hover: hover)` at build
    // time. Touch devices (iOS Safari especially) emulate mouse events on
    // tap, so unguarded hover styles "stick" — buttons light up as if
    // pressed and stay lit until the next touch. With this plugin, hover
    // styling only exists for devices that can actually hover.
    'postcss-hover-media-feature': {},
  },
}
