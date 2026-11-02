// The macOS menu bar shows the bundle name, so dev runs from a renamed Electron copy in .dev/.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const NAME = 'Sound Picker'
const env = { ...process.env }

if (process.platform === 'darwin') {
  const source = resolve('node_modules/electron/dist/Electron.app')
  const target = resolve('.dev', `${NAME}.app`)
  const stamp = resolve('.dev', 'electron-version')
  const version = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version
  if (!existsSync(target) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== version) {
    mkdirSync('.dev', { recursive: true })
    execFileSync('rm', ['-rf', target])
    execFileSync('cp', ['-cR', source, target])
    const plist = join(target, 'Contents', 'Info.plist')
    for (const [key, value] of [['CFBundleName', NAME], ['CFBundleDisplayName', NAME], ['CFBundleIdentifier', 'app.soundpicker.dev']]) {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist])
    }
    writeFileSync(stamp, version)
  }
  env.ELECTRON_EXEC_PATH = join(target, 'Contents', 'MacOS', 'Electron')
}

const bin = resolve('node_modules', '.bin', process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite')
const child = spawn(bin, ['dev', ...process.argv.slice(2)], { stdio: 'inherit', env, shell: process.platform === 'win32' })
child.on('exit', (code) => process.exit(code ?? 0))
