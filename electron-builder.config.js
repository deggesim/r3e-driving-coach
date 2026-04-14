/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.r3e-driving-coach.app",
  productName: "R3E Driving Coach",
  directories: {
    output: "release",
  },
  win: {
    target: "nsis",
    icon: "build/icon.png",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  files: ["dist/**/*", "node_modules/**/*"],
};
