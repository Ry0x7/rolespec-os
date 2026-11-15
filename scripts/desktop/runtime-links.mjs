import { cpSync, lstatSync, readdirSync, realpathSync, renameSync, unlinkSync } from "node:fs"
import path from "node:path"

// Installers cannot preserve checkout links, including junctions left by copy overlays.
export function materializeRuntimeLinks(target) {
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()
    const stats = lstatSync(current)
    if (stats.isSymbolicLink()) {
      const temporary = `${current}.materialized`
      cpSync(realpathSync(current), temporary, {
        recursive: true, dereference: true, force: false, errorOnExist: true,
      })
      unlinkSync(current)
      renameSync(temporary, current)
    }
    if (lstatSync(current).isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(path.join(current, entry))
    }
  }
}
