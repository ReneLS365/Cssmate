function nextFrame () {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }
    Promise.resolve().then(resolve)
  })
}

function safeStringify (value) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export async function waitForExportReady (readState, options = {}) {
  const maxFrames = Number.isFinite(options.maxFrames) ? options.maxFrames : 120
  const stableFramesNeeded = Number.isFinite(options.stableFramesNeeded) ? options.stableFramesNeeded : 2
  if (typeof readState !== 'function') {
    throw new Error('waitForExportReady kræver en readState-funktion')
  }

  let previousSignature = ''
  let stableFrames = 0

  for (let frame = 0; frame < maxFrames; frame += 1) {
    const state = readState()
    const signature = safeStringify(state)
    const valid = Boolean(
      state?.jobLoaded === true &&
      state?.materialsLoaded === true &&
      state?.lonReady === true &&
      state?.calculationsStable === true
    )

    if (valid && signature && signature === previousSignature) {
      stableFrames += 1
      if (stableFrames >= stableFramesNeeded) return state
    } else {
      stableFrames = valid ? 1 : 0
      previousSignature = signature
    }

    await nextFrame()
  }

  throw new Error('Export-state blev ikke stabil i tide')
}
