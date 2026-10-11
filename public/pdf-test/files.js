// NimBooks download-in-Nimiq-Pay probe (round 2). Throwaway diagnostic page:
// can a CSV or backup file reach the phone's storage from inside the Pay
// WebView, and by which route? Pairs with /pdf-test/ (round 1).
;(function () {
  'use strict'
  var KEY = 'nimbooks:fileprobe:v1'
  var CSV_URL = new URL('sample.csv', location.href).href
  var JSON_URL = new URL('sample-backup.json', location.href).href
  var SITE = 'https://nimbooks.subimpact.net/pdf-test/files'
  var CSV_TEXT = '\ufeffdate,txHash,receivedNIM,note\n2026-10-11,abc123,1.5,NimBooks download test (made on the phone)\n'
  var state = load()

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { log: [], verdicts: {} }
    } catch (e) {
      return { log: [], verdicts: {} }
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch (e) {}
    var el = document.getElementById('log')
    if (el) el.textContent = state.log.join('\n')
  }
  function log(msg) {
    state.log.push(new Date().toISOString().slice(11, 23) + ' ' + msg)
    if (state.log.length > 300) state.log.shift()
    save()
  }

  var inPay = !!(window.nimiqPay || window.nimiq)
  var android = /Android/i.test(navigator.userAgent)
  var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)

  ;['visibilitychange', 'pagehide', 'pageshow', 'blur', 'focus'].forEach(function (ev) {
    window.addEventListener(ev, function () {
      log('event ' + ev + (ev === 'visibilitychange' ? ' ' + document.visibilityState : ''))
    })
  })
  window.addEventListener('error', function (e) {
    log('window error: ' + e.message)
  })

  var FILE = [
    'File saved (download notice, or it is in Downloads)',
    'My phone browser opened and saved it',
    'Opened and showed the text, no file saved',
    'Nothing happened',
    'Error or blank screen',
  ]

  function clickAnchor(href, opts) {
    var a = document.createElement('a')
    a.href = href
    if (opts.download) a.download = opts.download
    if (opts.blank) {
      a.target = '_blank'
      a.rel = 'noopener'
    }
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  var tests = [
    {
      id: 'open-csv',
      title: '1. Open a CSV download link',
      desc: 'Exactly what a one-tap "Save CSV" button in Pay would do: open our download link, which tells the phone to save it as a file.',
      answers: FILE,
      run: function () {
        var w = window.open(CSV_URL, '_blank')
        log('window.open(csv) returned ' + (w ? 'a window' : String(w)))
      },
    },
    {
      id: 'open-csv-late',
      title: '2. Same, after a short wait',
      desc: 'The real button has to create the link first (about a second). Phones sometimes block windows that open after a wait. Tap Try and wait 2 seconds.',
      answers: FILE,
      run: function () {
        setTimeout(function () {
          var w = window.open(CSV_URL, '_blank')
          log('late window.open(csv) returned ' + (w ? 'a window' : String(w)))
        }, 1500)
      },
    },
    {
      id: 'here-csv',
      title: '3. Download link in this page',
      desc: 'Same link, opened in place of this page instead of a new window.',
      answers: FILE,
      run: function () {
        location.href = CSV_URL
        log('location.href = csv')
      },
    },
    {
      id: 'anchor-blank',
      title: '4. Download link as a normal link',
      desc: 'A plain link to the file, opening in a new window.',
      answers: FILE,
      run: function () {
        clickAnchor(CSV_URL, { blank: true })
        log('anchor _blank csv clicked')
      },
    },
    {
      id: 'blob-csv',
      title: '5. Save a CSV made on the phone',
      desc: 'The file is created on the phone and saved directly. This is how the browser version saves CSVs today.',
      answers: FILE,
      run: function () {
        var url = URL.createObjectURL(new Blob([CSV_TEXT], { type: 'text/csv;charset=utf-8' }))
        clickAnchor(url, { download: 'nimbooks-test-phone.csv' })
        log('blob anchor download clicked')
        setTimeout(function () {
          URL.revokeObjectURL(url)
        }, 20000)
      },
    },
    {
      id: 'data-csv',
      title: '6. Save a CSV made on the phone (other method)',
      desc: 'Same idea, different technique.',
      answers: FILE,
      run: function () {
        clickAnchor('data:text/csv;charset=utf-8,' + encodeURIComponent(CSV_TEXT), { download: 'nimbooks-test-data.csv' })
        log('data: anchor download clicked')
      },
    },
    {
      id: 'open-json',
      title: '7. Open a backup file link',
      desc: 'Like test 1, but a backup file (nimbooks-backup-test.json).',
      answers: FILE,
      run: function () {
        var w = window.open(JSON_URL, '_blank')
        log('window.open(json) returned ' + (w ? 'a window' : String(w)))
      },
    },
    {
      id: 'clipboard',
      title: '8. Copy to clipboard',
      desc: 'Copies a line of text. Paste it anywhere (a chat, notes) to check.',
      answers: ['Pasted fine', 'Nothing was copied', 'Error'],
      run: function () {
        if (!navigator.clipboard || !navigator.clipboard.writeText) return log('clipboard api missing')
        navigator.clipboard.writeText('NimBooks clipboard test ' + new Date().toISOString()).then(function () {
          log('clipboard resolved')
        }, function (e) {
          log('clipboard rejected ' + (e && e.name) + ' ' + (e && e.message))
        })
      },
    },
  ]

  function renderEnv() {
    document.getElementById('env').textContent =
      (inPay ? 'Running inside Nimiq Pay' : 'Not inside Nimiq Pay') +
      ' | ' + (android ? 'Android' : ios ? 'iOS' : 'other')
    if (!inPay) {
      document.getElementById('openInPay').hidden = false
      document.getElementById('payLink').href = 'nimiqpay://miniapp?url=' + encodeURIComponent(SITE)
    }
  }

  function renderTests() {
    var root = document.getElementById('tests')
    tests.forEach(function (t) {
      var card = document.createElement('div')
      card.className = 'card'
      var h = document.createElement('h2')
      h.textContent = t.title
      var tag = document.createElement('span')
      tag.className = 'tag'
      h.appendChild(tag)
      var p = document.createElement('p')
      p.textContent = t.desc
      var run = document.createElement('button')
      run.className = 'btn'
      run.textContent = 'Try'
      run.onclick = function () {
        log('RUN ' + t.id)
        try {
          t.run(card)
        } catch (e) {
          log(t.id + ' threw ' + e)
        }
      }
      var ans = document.createElement('div')
      ans.className = 'ans'
      function paint() {
        var v = state.verdicts[t.id]
        tag.textContent = v ? '✓ answered' : ''
        Array.prototype.forEach.call(ans.children, function (b) {
          b.className = b.textContent === v ? 'on' : ''
        })
      }
      t.answers.forEach(function (a) {
        var b = document.createElement('button')
        b.textContent = a
        b.onclick = function () {
          state.verdicts[t.id] = a
          log('VERDICT ' + t.id + ': ' + a)
          paint()
        }
        ans.appendChild(b)
      })
      card.appendChild(h)
      card.appendChild(p)
      card.appendChild(run)
      card.appendChild(ans)
      root.appendChild(card)
      paint()
    })
  }

  document.getElementById('send').onclick = function () {
    var out = document.getElementById('sent')
    out.textContent = 'Sending…'
    var body = JSON.stringify({
      page: 'files',
      ua: navigator.userAgent,
      inPay: inPay,
      verdicts: state.verdicts,
      log: state.log.slice(-200),
    })
    fetch('/api/pdf-probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (r) {
        return r.json().then(function (j) {
          out.textContent = r.ok ? 'Sent. Reference ' + j.id + '. Thank you!' : 'Not sent (' + r.status + '). Open Log and screenshot it instead.'
        })
      })
      .catch(function (e) {
        out.textContent = 'Not sent (' + e + '). Open Log and screenshot it instead.'
      })
  }
  document.getElementById('reset').onclick = function () {
    state = { log: [], verdicts: {} }
    save()
    location.reload()
  }

  renderEnv()
  renderTests()
  save()
  log('loaded inPay=' + inPay + ' ua=' + navigator.userAgent)
})()
