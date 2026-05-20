// Metro config with NativeWind's withNativeWind wrapper. Points at the
// global stylesheet that holds the Tailwind directives.
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

module.exports = withNativeWind(config, { input: './global.css' })
