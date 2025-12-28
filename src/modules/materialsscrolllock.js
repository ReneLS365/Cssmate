/**
 * @purpose Prevent scroll chaining and rubber-band bounce in the materials list.
 * @inputs root: optional Element|Document to scope the container lookup.
 * @outputs void
 */
const initializedContainers = new WeakSet()

const SELECTORS = [
  '#materials .mat-scroll',
  '#materials-list',
  '.materials-scroll',
  '#materials',
  '.materials-v2__body'
]

function findMaterialsScrollContainer (root = document) {
  if (!root || typeof root.querySelector !== 'function') {
    return null
  }

  for (const selector of SELECTORS) {
    const found = root.querySelector(selector)
    if (found) {
      return found
    }
  }

  if (root !== document) {
    return findMaterialsScrollContainer(document)
  }

  return null
}

export function initMaterialsScrollLock (root = document) {
  const container = findMaterialsScrollContainer(root)
  if (!container || initializedContainers.has(container)) {
    return
  }

  const lockWithinBounds = () => {
    const max = Math.max(0, container.scrollHeight - container.clientHeight)
    if (container.scrollTop > max) {
      container.scrollTop = max
    }
  }

  const handleTouchStart = () => {
    const max = Math.max(0, container.scrollHeight - container.clientHeight)
    if (container.scrollTop <= 0 && max > 0) {
      container.scrollTop = 1
    } else if (container.scrollTop >= max && max > 0) {
      container.scrollTop = max - 1
    }
  }

  const handleResize = () => {
    lockWithinBounds()
  }

  if (!container.style.overscrollBehavior) {
    container.style.overscrollBehavior = 'contain'
  }
  if (!container.style.touchAction) {
    container.style.touchAction = 'pan-y'
  }

  container.addEventListener('touchstart', handleTouchStart, { passive: true })
  window.addEventListener('resize', handleResize)

  initializedContainers.add(container)
}
