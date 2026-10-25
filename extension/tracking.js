// LinkPad extension tracking. The install id is anonymous and generated locally.
(function () {
  var INSTALL_KEY = 'linkpad_install_id'
  var API = 'https://linkpad.site/api/extension/track'
  var VERSION = chrome.runtime.getManifest().version

  function getInstallId() {
    var id = localStorage.getItem(INSTALL_KEY)
    if (id && /^[A-Za-z0-9_-]{16,80}$/.test(id)) return id
    var bytes = crypto.getRandomValues(new Uint8Array(18))
    id = 'ext_' + Array.prototype.map.call(bytes, function (b) {
      return b.toString(16).padStart(2, '0')
    }).join('')
    localStorage.setItem(INSTALL_KEY, id)
    return id
  }

  function report(event) {
    return fetch(API, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ install_id: getInstallId(), event: event, version: VERSION }),
      keepalive: true
    }).catch(function () {})
  }

  // Report install once per browser profile, then report each new-tab use.
  if (!localStorage.getItem('linkpad_install_reported')) {
    localStorage.setItem('linkpad_install_reported', '1')
    // The marker prevents retry spam; the next use still updates this install.
    report('install')
  }
  report('use')

  // Pass the install id to the embedded app in the URL fragment. Fragments are
  // not sent to servers, so the id does not leak into access logs or referrers.
  var iframe = document.getElementById('app-iframe')
  if (iframe) {
    iframe.src = 'https://linkpad.site/#linkpad_install_id=' + encodeURIComponent(getInstallId())
  }
})()
