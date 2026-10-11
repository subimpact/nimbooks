// NimBooks PDF-in-Nimiq-Pay probe. Throwaway diagnostic page: every way a web
// page can hand the user a PDF, run one at a time inside the Pay WebView, with
// the tester's own verdict recorded next to what JS could observe.
;(function () {
  'use strict'
  var KEY = 'nimbooks:pdfprobe:v1'
  var PDF_URL = new URL('sample.pdf', location.href).href
  var SITE = 'https://nimbooks.subimpact.net/pdf-test/'
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
    renderLog()
  }
  function log(msg) {
    state.log.push(new Date().toISOString().slice(11, 23) + ' ' + msg)
    if (state.log.length > 300) state.log.shift()
    save()
  }
  function renderLog() {
    var el = document.getElementById('log')
    if (el) el.textContent = state.log.join('\n')
  }

  var inPay = !!(window.nimiqPay || window.nimiq)
  var payUA = /NimiqPay/i.test(navigator.userAgent)
  var android = /Android/i.test(navigator.userAgent)
  var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)

  // Anything that takes the user out of the page (print dialog, external app,
  // share sheet, browser) shows up here even when the call itself says nothing.
  ;['visibilitychange', 'pagehide', 'pageshow', 'blur', 'focus', 'beforeprint', 'afterprint'].forEach(function (ev) {
    window.addEventListener(ev, function () {
      log('event ' + ev + (ev === 'visibilitychange' ? ' ' + document.visibilityState : ''))
    })
  })
  window.addEventListener('error', function (e) {
    log('window error: ' + e.message)
  })

  function getPdfBlob() {
    return fetch(PDF_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('fetch ' + r.status)
      return r.blob()
    }).then(function (b) {
      return new Blob([b], { type: 'application/pdf' })
    })
  }

  var COMMON = ['A PDF opened and I could read it', 'Something opened, but no PDF', 'Nothing happened', 'Error or blank screen']

  var tests = [
    {
      id: 'print',
      title: '1. Print dialog (Save as PDF)',
      desc: 'What the browser version uses today. Works if a print or Save as PDF screen appears.',
      answers: ['Print / Save as PDF screen appeared', 'Nothing happened', 'Error'],
      run: function () {
        var t0 = performance.now()
        try {
          window.print()
          log('print() returned after ' + Math.round(performance.now() - t0) + 'ms')
        } catch (e) {
          log('print() threw ' + e)
        }
      },
    },
    {
      id: 'share-file',
      title: '2. Share the PDF file',
      desc: 'Opens the phone share sheet with the PDF attached, so you can save it to Files or Drive, or send it.',
      answers: ['Share sheet with the PDF appeared', 'Share sheet without a file', 'Nothing happened', 'Error'],
      run: function () {
        if (!navigator.share) return log('share: navigator.share missing')
        getPdfBlob().then(function (blob) {
          var file = new File([blob], 'nimbooks-test.pdf', { type: 'application/pdf' })
          var data = { files: [file], title: 'NimBooks PDF test' }
          var can = navigator.canShare ? navigator.canShare(data) : 'no canShare'
          log('share-file canShare=' + can)
          return navigator.share(data)
        }).then(function () {
          log('share-file resolved')
        }, function (e) {
          log('share-file rejected ' + (e && e.name) + ' ' + (e && e.message))
        })
      },
    },
    {
      id: 'share-url',
      title: '3. Share a link to the PDF',
      desc: 'Share sheet with a link instead of the file.',
      answers: ['Share sheet appeared', 'Nothing happened', 'Error'],
      run: function () {
        if (!navigator.share) return log('share-url: navigator.share missing')
        navigator.share({ title: 'NimBooks PDF test', url: PDF_URL }).then(function () {
          log('share-url resolved')
        }, function (e) {
          log('share-url rejected ' + (e && e.name) + ' ' + (e && e.message))
        })
      },
    },
    {
      id: 'open-new',
      title: '4. Open the PDF in a new window',
      desc: 'Might open your phone browser or a PDF viewer.',
      answers: COMMON.concat(['My phone browser opened']),
      run: function () {
        var w = window.open(PDF_URL, '_blank')
        log('window.open(pdf,_blank) returned ' + (w ? 'a window' : String(w)))
      },
    },
    {
      id: 'blob-open',
      title: '5. Open a generated PDF (blob)',
      desc: 'The PDF is created on the phone, the way a real report would be.',
      answers: COMMON,
      run: function () {
        getPdfBlob().then(function (blob) {
          var url = URL.createObjectURL(blob)
          var w = window.open(url, '_blank')
          log('window.open(blob) returned ' + (w ? 'a window' : String(w)))
        }, function (e) {
          log('blob-open failed ' + e)
        })
      },
    },
    {
      id: 'download',
      title: '6. Download the PDF',
      desc: 'A normal file download. Works if you get a download notice or the file appears in Downloads or Files.',
      answers: ['File downloaded', 'Something opened, but no file', 'Nothing happened', 'Error'],
      run: function () {
        getPdfBlob().then(function (blob) {
          var url = URL.createObjectURL(blob)
          var a = document.createElement('a')
          a.href = url
          a.download = 'nimbooks-test.pdf'
          document.body.appendChild(a)
          a.click()
          a.remove()
          log('download click dispatched')
        }, function (e) {
          log('download failed ' + e)
        })
      },
    },
    {
      id: 'inline',
      title: '7. Show the PDF inside this page',
      desc: 'A box should appear below with the PDF in it.',
      answers: ['I can read the PDF in the box', 'Box is blank or grey', 'Box shows a download or open button'],
      run: function (card) {
        var old = card.querySelector('iframe')
        if (old) old.remove()
        var f = document.createElement('iframe')
        f.src = PDF_URL
        f.title = 'PDF preview'
        f.onload = function () {
          log('iframe load event')
        }
        card.appendChild(f)
        log('iframe inserted')
      },
    },
    {
      id: 'external',
      title: '8. Open in your phone browser',
      desc: android
        ? 'Asks Android to open the PDF outside Nimiq Pay.'
        : 'Tries to hand the PDF to Safari or Chrome outside Nimiq Pay.',
      answers: ['Browser or PDF viewer opened with the PDF', 'Opened, but no PDF', 'Nothing happened', 'Error'],
      run: function () {
        var target = android
          ? 'intent://' + PDF_URL.replace(/^https:\/\//, '') + '#Intent;scheme=https;action=android.intent.action.VIEW;end'
          : ios
            ? 'x-safari-' + PDF_URL
            : PDF_URL
        log('external -> ' + target.slice(0, 60))
        var a = document.createElement('a')
        a.href = target
        a.target = '_blank'
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
      },
    },
    {
      id: 'same-tab',
      title: '9. Open the PDF in place of this page (do this last)',
      desc: 'Leaves this page. If the screen goes blank, close and reopen this test page; your answers are kept.',
      answers: COMMON,
      run: function () {
        log('same-tab navigating')
        setTimeout(function () {
          location.href = PDF_URL
        }, 150)
      },
    },
  ]

  function renderEnv() {
    document.getElementById('env').textContent =
      (inPay ? 'Running inside Nimiq Pay' : payUA ? 'Nimiq Pay app (wallet not detected)' : 'Not inside Nimiq Pay') +
      ' | ' + (android ? 'Android' : ios ? 'iOS' : 'other') +
      ' | share: ' + (navigator.share ? 'yes' : 'no')
    if (!inPay && !payUA) {
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
      ua: navigator.userAgent,
      inPay: inPay,
      payUA: payUA,
      share: !!navigator.share,
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
  renderLog()
  log('loaded inPay=' + inPay + ' payUA=' + payUA + ' ua=' + navigator.userAgent)
})()
