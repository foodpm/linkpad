(function() {
  var loadingEl = document.getElementById('loading-screen')
  var iframe = document.getElementById('app-iframe')
  var iframeReady = false

  // Fallback: guarantee the iframe always has an explicit src. tracking.js
  // normally sets it (with the install id in the fragment); only fill in the
  // bare URL here when that did not happen, so the two never fight over src.
  if (iframe && !iframe.getAttribute('src')) {
    iframe.src = 'https://linkpad.site/'
  }

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
