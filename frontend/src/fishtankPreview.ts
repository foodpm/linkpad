import { FishTankEngine } from './components/fishtank/fishtank3dEngine'
import type { FishConfig, FishSpecies, TankStyle } from './components/fishtank/fishtankEngine'

const mk = (species: FishSpecies, size = 1): FishConfig => ({ id: `${species}-${Math.random()}`, species, size })

const t1 = new FishTankEngine(document.getElementById('tank1')!, 'classic',
  [mk('goldfish', 1), mk('goldfish', 1.1), mk('koi'), mk('zebrafish')], 0)
const t2 = new FishTankEngine(document.getElementById('tank2')!, 'eco',
  [mk('angelfish'), mk('betta'), mk('guppy')], 0)
const t3 = new FishTankEngine(document.getElementById('tank3')!, 'sea',
  [mk('clownfish'), mk('clownfish', 0.9), mk('neon'), mk('neon', 0.8)], 0)

let added = 0
const add = () => {
  added++
  t1.setFish([...[mk('goldfish', 1), mk('goldfish', 1.1), mk('koi'), mk('zebrafish')], ...Array.from({ length: added }, () => mk('goldfish'))])
}
document.getElementById('feed')!.onclick = () => { t1.feed(); t2.feed(); t3.feed() }
const STYLES: TankStyle[] = ['classic', 'eco', 'sea']
let si = 0
document.getElementById('next')!.onclick = () => { si = (si + 1) % 3; t1.setStyle(STYLES[si]) }
document.getElementById('add')!.onclick = add

;(window as any).__eng = { t1, t2, t3 }
