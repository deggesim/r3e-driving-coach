/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.r3ecoach.app',
  productName: 'R3E Coach',
  directories: {
    output: 'release',
  },
  win: {
    target: 'nsis',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  files: [
    'dist/**/*',
    'node_modules/**/*',
  ],
};
