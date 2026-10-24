(function() {
  var loadingEl = document.getElementById('loading-screen')
  var iframe = document.getElementById('app-iframe')
  var iframeReady = false

  function showIframe() {
    if (iframeReady) return
    iframeReady = true
    loadingEl.classList.remove('visible')
    iframe.classList.add('ready')
  }

  iframe.addEventListener('load', showIframe)

  // Fallback: show iframe after 1s even if not fully loaded
  setTimeout(function() {
    if (!iframeReady) showIframe()
  }, 1000)
})()
