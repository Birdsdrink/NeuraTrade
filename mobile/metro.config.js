const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .mjs to resolver extensions so lightweight-charts ESM bundle resolves
config.resolver.sourceExts.push('mjs');

module.exports = config;
