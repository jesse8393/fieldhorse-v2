// Metro config with NativeWind's withNativeWind wrapper. Points at the
// global stylesheet that holds the Tailwind directives.
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')
const path = require('node:path')

const config = getDefaultConfig(__dirname)
// This repository uses separate installs, not npm workspaces. Make the
// shared pure money/date/pagination helpers visible outside mobile's root.
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../src/lib')]

module.exports = withNativeWind(config, { input: './global.css' })
