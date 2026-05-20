// Expo + NativeWind babel config. The nativewind/babel preset compiles
// Tailwind className props to RN StyleSheet at build time.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel'
    ]
  }
}
